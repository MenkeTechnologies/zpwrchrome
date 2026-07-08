// zpwrchrome — pass manager controller
//
// CRUD on the UNIX pass store. Talks to the SW (which talks to the
// zpwrchrome-host NM host). Left pane: store tree. Right pane:
// entry editor. No third-party deps; no SW state retained client-side.

import "../lib/page-nav.js";
import { formatEntry, validatePassPath, buildTree, derivePassPath } from "../lib/pass-entry.js";
import { fzfMatch, highlightWithIndices } from "../lib/fzf.js";

const $ = (id) => document.getElementById(id);

const state = {
  tree:       null,            // root tree node, see buildTree()
  paths:      [],              // flat list of relative paths (no .gpg)
  collapsed:  new Set(),       // dir paths the user has collapsed
  selected:   null,            // currently-selected relative path
  mode:       "view",          // "view" | "edit" | "new"
  loaded:     false,           // entry contents loaded for `selected`
  dirty:      false,           // editor has unsaved changes
  pwShown:    false,
  filter:     "",              // search box query (case-insensitive substring)
  rawView:    false,           // editor is in raw-textarea mode (bypass formatEntry)
  lastRaw:    "",              // raw bytes from the last fetch, for the raw view
  pathTouched: false,          // user has typed in the path field — stop auto-deriving
};

// ─── Bridge ──────────────────────────────────────────────────────────
function send(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message || "runtime error"));
      if (!resp || resp.ok === false) {
        return reject(new Error(resp?.err || "bridge error"));
      }
      resolve(resp);
    });
  });
}

const passList   = ()        => send({ kind: "pass.list" });
const passFetch  = (path)    => send({ kind: "pass.fetch", path });
const passSave   = (path, contents) => send({ kind: "pass.save",   path, contents });
const passDelete = (path)    => send({ kind: "pass.delete", path });
const passFill   = (path)    => send({ kind: "pass.fill",   path });

// ─── Footer status ──────────────────────────────────────────────────
function setFooter(text, cls = "") {
  const el = $("footer-status");
  el.textContent = text;
  el.className = cls || "dim";
}

function setEdStatus(text, cls = "") {
  const el = $("ed-status");
  el.textContent = text;
  el.className = "ed-status" + (cls ? ` ${cls}` : "");
  if (cls === "ok") setTimeout(() => { if (el.textContent === text) el.textContent = ""; }, 2200);
}

// ─── Tree loading ───────────────────────────────────────────────────
async function loadTree() {
  setFooter("loading entries…");
  try {
    const resp = await passList();
    state.paths = (resp.entries || []).map((e) => e.path).sort();
    state.tree  = buildTree(state.paths);
    state.loaded = false;
    renderTree();
    setFooter(`${state.paths.length} entries`);
  } catch (e) {
    state.paths = [];
    state.tree  = buildTree([]);
    renderTree();
    setFooter(`host error: ${e.message}`, "ed-status err");
    $("tree").innerHTML = `<div class="tree-err">${escapeHtml(e.message)}\n\nrun: cargo install zpwrchrome-host\n     zpwrchrome-host --install &lt;ext-id&gt;</div>`;
  }
}

// ─── Tree render ────────────────────────────────────────────────────
function renderTree() {
  const tree = $("tree");
  if (!state.tree) { tree.innerHTML = ""; return; }
  const filter = state.filter.trim();

  const matches = (path) => !filter || !!fzfMatch(filter, path);
  const dirHasMatch = (node) => {
    if (node.entries.some((e) => matches(e.path))) return true;
    return node.dirs.some(dirHasMatch);
  };
  const hl = (name) => {
    if (!filter) return escapeHtml(name);
    const m = fzfMatch(filter, name);
    return m ? highlightWithIndices(name, m.indices, escapeHtml) : escapeHtml(name);
  };

  const renderNode = (node, isRoot) => {
    let html = "";
    for (const dir of node.dirs) {
      if (filter && !dirHasMatch(dir)) continue;
      const collapsed = !filter && state.collapsed.has(dir.path);
      const caret = collapsed ? "▶" : "▼";
      html += `<div class="tnode dir${collapsed ? " collapsed" : ""}" data-dir="${escapeHtml(dir.path)}">
        <div class="twrap">
          <span class="tcaret">${caret}</span>
          <span class="ticon">📁</span>
          <span class="tname">${hl(dir.name)}</span>
        </div>
        <div class="tchildren">${renderNode(dir, false)}</div>
      </div>`;
    }
    for (const entry of node.entries) {
      if (!matches(entry.path)) continue;
      const isSel = state.selected === entry.path;
      html += `<div class="tnode file${isSel ? " selected" : ""}" data-path="${escapeHtml(entry.path)}">
        <div class="twrap">
          <span class="tcaret"> </span>
          <span class="ticon">⛀</span>
          <span class="tname">${hl(entry.name)}</span>
        </div>
      </div>`;
    }
    return html;
  };

  const html = renderNode(state.tree, true);
  tree.innerHTML = html || `<div class="tree-empty">${filter ? "no entries match filter" : "no entries in store"}</div>`;
  $("tree-count").textContent = `${state.paths.length} entries`;

  tree.querySelectorAll(".tnode.dir > .twrap").forEach((el) => {
    el.addEventListener("click", () => {
      const dir = el.parentElement.getAttribute("data-dir");
      if (state.collapsed.has(dir)) state.collapsed.delete(dir);
      else state.collapsed.add(dir);
      renderTree();
    });
  });
  tree.querySelectorAll(".tnode.file > .twrap").forEach((el) => {
    el.addEventListener("click", () => {
      const path = el.parentElement.getAttribute("data-path");
      pickEntry(path);
    });
  });
}

// ─── Entry pick / load ──────────────────────────────────────────────
async function pickEntry(path) {
  if (state.dirty && !confirm("Discard unsaved changes?")) return;
  state.selected = path;
  state.mode = "view";
  state.dirty = false;
  state.loaded = false;
  // Reset auto-derive gate so URL / login edits on the existing entry
  // also re-derive the path. The path field stays user-editable so the
  // user can override the derived value or rename the entry by hand.
  state.pathTouched = false;
  renderTree();
  showForm(true);
  $("ed-mode").textContent = "loading…";
  $("ed-mode").className = "ed-mode";
  $("ed-path").value = path;
  $("ed-path").disabled = false;
  // Clear fields while loading so stale data doesn't flash.
  $("ed-pw").value = "";
  $("ed-login").value = "";
  $("ed-url").value = "";
  $("ed-otp").value = "";
  $("ed-notes").value = "";
  renderExtraFields({});
  try {
    const resp  = await passFetch(path);
    const entry = resp.data || {};
    // Diagnostic — opening devtools on this page shows what the bridge
    // returned, so a mis-parsed URL / username can be spotted at a glance.
    console.log("[pass-mgr] fetched", path, entry);
    state.lastRaw = String(entry.raw || "");
    $("ed-raw").value = state.lastRaw;
    $("ed-pw").value    = entry.password || "";
    $("ed-login").value = entry.username || "";
    $("ed-url").value   = entry.url      || "";
    $("ed-otp").value   = entry.otpUrl   || "";
    $("ed-notes").value = Array.isArray(entry.notes) ? entry.notes.join("\n") : (entry.notes || "");
    // Strip synonyms covered by the dedicated rows so the editor doesn't show
    // them twice; everything else lands in the kv-list.
    const HIDDEN = new Set([
      "login","username","user","email","mail",
      "url","link","website","web","site","uri","launch","homepage","host","hostname","domain",
    ]);
    const extras = {};
    for (const [k, v] of Object.entries(entry.fields || {})) {
      if (!HIDDEN.has(k)) extras[k] = v;
    }
    renderExtraFields(extras);
    state.loaded = true;
    state.dirty = false;
    $("ed-mode").textContent = "view";
    $("ed-mode").className = "ed-mode";
    setEdStatus("");
  } catch (e) {
    $("ed-mode").textContent = "error";
    $("ed-mode").className = "ed-mode";
    setEdStatus(e.message, "err");
  }
}

function showForm(visible) {
  $("ed-form").hidden = !visible;
  $("ed-empty").hidden = visible;
}

// ─── New entry flow ─────────────────────────────────────────────────
function startNew() {
  if (state.dirty && !confirm("Discard unsaved changes?")) return;
  state.selected = null;
  state.mode = "new";
  state.dirty = true;
  state.loaded = false;
  state.lastRaw = "";
  state.pathTouched = false;
  if (state.rawView) toggleRawView();  // form view for new entries
  renderTree();
  showForm(true);
  $("ed-mode").textContent = "new";
  $("ed-mode").className = "ed-mode new";
  $("ed-path").value = "";
  $("ed-path").disabled = false;
  $("ed-pw").value = generatePassword(24).value;
  $("ed-login").value = "";
  $("ed-url").value = "";
  $("ed-otp").value = "";
  $("ed-notes").value = "";
  $("ed-raw").value = "";
  renderExtraFields({});
  setEdStatus("");
  // Focus URL first — typical entry-creation order. Path auto-fills as
  // the user types URL + login until they manually edit the path.
  $("ed-url").focus();
}

// ─── Templates ──────────────────────────────────────────────────────
// Profile + credit-card entries follow a conventional schema. The
// template buttons drop empty kv-rows for each schema key so the user
// only has to type values — keys are pre-populated. Friendly synonym
// names are used (city / state / zipcode / cvv) — the recognizer
// resolves them through TOKEN_SYNONYMS in lib/identity-tokens.js.
const PROFILE_TEMPLATE_KEYS = [
  "given-name", "family-name", "email", "phone",
  "address", "city", "state", "zipcode", "country",
];
const CARD_TEMPLATE_KEYS = [
  "cc-name", "cc-number", "cc-exp-month", "cc-exp-year", "cvv",
];

// startNewFromTemplate(opts) — runs the standard new-entry reset and
// then pre-seeds the form for one of the canonical schemas:
//   - url   = opts.url     (first path segment — e.g. "profile")
//   - login = opts.login   (second path segment — e.g. "personal")
//   - path  = derived from url + login → "profile/personal"
//   - kv    = one empty row per opts.keys (friendly schema names)
// Path stays in sync with url + login via the existing auto-derive
// — retyping the login from "personal" to "work" rewrites the path
// to "profile/work" automatically.
function startNewFromTemplate(opts) {
  startNew();
  $("ed-url").value   = opts.url   || "";
  $("ed-login").value = opts.login || "";
  // Let derivePassPath compute path from url + login. Same code path as
  // the regular auto-derive, so retyping the login (e.g. personal →
  // work) keeps path in lockstep.
  maybeAutoDerivePath();
  // Focus the login row with its default value text-selected, so one
  // keystroke replaces it.
  $("ed-login").focus();
  try { $("ed-login").setSelectionRange(0, ($("ed-login").value || "").length); } catch {}
  // Profile / card entries don't really have a single "password" on
  // line 1 — clear the auto-generated one so the file starts with a
  // free-form label the user can type, or leaves blank.
  $("ed-pw").value = "";
  $("ed-pw").type  = "text";          // show what they type — it's not secret
  state.pwShown    = true;
  // Pre-seed the kv-list with one empty row per template key.
  const list = $("kv-list");
  list.innerHTML = "";
  for (const k of opts.keys) list.appendChild(makeKvRow(k, ""));
}

function startNewProfileTemplate() {
  // URL row = first path segment, login row = second.
  // Path stays auto-derived so editing URL or login keeps the path
  // in sync (e.g. login "personal" → "work" rewrites path to
  // profile/work).
  startNewFromTemplate({
    url:   "profile",
    login: "personal",
    keys:  PROFILE_TEMPLATE_KEYS,
  });
}
function startNewCardTemplate() {
  startNewFromTemplate({
    url:   "creditcard",
    login: "visa",
    keys:  CARD_TEMPLATE_KEYS,
  });
}

// Auto-derive the entry path from URL + login while the user is typing.
// Works for both new entries AND edits of existing entries — editing
// the URL or login of an existing entry will redrive the path, and on
// save the manager treats a changed path as a rename (write new file,
// delete old). Stops as soon as the user manually edits the path field
// — we never fight a path the user has typed by hand.
function maybeAutoDerivePath() {
  if (state.pathTouched) return;
  const derived = derivePassPath({
    url:   $("ed-url").value,
    login: $("ed-login").value,
  });
  if (derived) $("ed-path").value = derived;
}

// ─── Extra fields ───────────────────────────────────────────────────
function renderExtraFields(extras) {
  const list = $("kv-list");
  list.innerHTML = "";
  for (const [k, v] of Object.entries(extras || {})) {
    list.appendChild(makeKvRow(k, v));
  }
}

function makeKvRow(key, value) {
  const row = document.createElement("div");
  row.className = "kv-row";
  row.innerHTML = `
    <input class="key"   type="text" placeholder="key"   spellcheck="false" autocomplete="off">
    <input class="value" type="text" placeholder="value" spellcheck="false" autocomplete="off">
    <button class="kv-del" type="button" title="Remove field">✕</button>
  `;
  row.querySelector(".key").value   = key || "";
  row.querySelector(".value").value = value || "";
  row.querySelectorAll("input").forEach((i) => i.addEventListener("input", markDirty));
  row.querySelector(".kv-del").addEventListener("click", () => {
    row.remove();
    markDirty();
  });
  return row;
}

function collectExtraFields() {
  const out = {};
  $("kv-list").querySelectorAll(".kv-row").forEach((row) => {
    const k = row.querySelector(".key").value.trim().toLowerCase();
    const v = row.querySelector(".value").value;
    if (!k || k.includes(" ")) return;        // invalid keys silently dropped
    if (v == null || v === "") return;
    out[k] = v;
  });
  return out;
}

// ─── Dirty tracking ─────────────────────────────────────────────────
function markDirty() {
  if (!state.dirty) {
    state.dirty = true;
    $("ed-mode").textContent = state.mode === "new" ? "new" : "modified";
    $("ed-mode").className = "ed-mode " + (state.mode === "new" ? "new" : "dirty");
  }
}

// ─── Raw-view toggle ────────────────────────────────────────────────
function toggleRawView() {
  state.rawView = !state.rawView;
  if (state.rawView) {
    // Switching INTO raw — build raw text from current form fields when
    // there are edits, otherwise reuse the original bytes the fetch
    // returned. This way the raw view is always the truth.
    if (state.dirty || state.mode === "new") {
      $("ed-raw").value = buildRawFromForm();
    } else {
      $("ed-raw").value = state.lastRaw;
    }
    $("ed-raw").hidden = false;
    $("ed-grid").style.display = "none";
    $("b-view-raw").classList.add("active");
  } else {
    $("ed-raw").hidden = true;
    $("ed-grid").style.display = "";
    $("b-view-raw").classList.remove("active");
  }
}

function buildRawFromForm() {
  const entry = {
    password: $("ed-pw").value,
    username: $("ed-login").value.trim(),
    url:      $("ed-url").value.trim(),
    otpUrl:   $("ed-otp").value.trim(),
    fields:   collectExtraFields(),
    notes:    $("ed-notes").value ? $("ed-notes").value.split("\n") : [],
  };
  return formatEntry(entry);
}

// ─── Save / Delete / Reload ─────────────────────────────────────────
async function doSave(ev) {
  ev?.preventDefault?.();
  const path = $("ed-path").value.trim();
  const err = validatePassPath(path);
  if (err) { setEdStatus(err, "err"); return; }

  // When the raw view is active, ship the textarea bytes verbatim —
  // bypassing formatEntry. This is the escape hatch when the user has a
  // schema my parser doesn't understand.
  const text = state.rawView
    ? $("ed-raw").value
    : buildRawFromForm();

  $("b-save").disabled = true;
  // Detect a rename: existing entry whose path changed since it was
  // loaded. Write the new file first; if that succeeds, delete the old
  // one. Failing the rename mid-flight leaves the OLD entry intact and
  // surfaces the error — we never end up with neither file on disk.
  const wasNew = state.mode === "new";
  const isRename = !wasNew && state.selected && state.selected !== path;
  setEdStatus(isRename ? `renaming → ${path}…` : "saving…");
  try {
    await passSave(path, text);
    if (isRename) {
      try {
        await passDelete(state.selected);
      } catch (delErr) {
        // New file is in place; warn but don't pretend it failed.
        setEdStatus(`saved at new path but failed to delete old (${delErr.message})`, "err");
        state.dirty = false;
        state.mode = "view";
        state.selected = path;
        await loadTree();
        return;
      }
    }
    setEdStatus(isRename ? "renamed" : "saved", "ok");
    state.dirty = false;
    state.mode = "view";
    state.selected = path;
    $("ed-mode").textContent = "view";
    $("ed-mode").className = "ed-mode";
    // Refresh the tree on any structural change (new entry or rename)
    // so the sidebar reflects the new path; in-place edits just rerender.
    if (wasNew || isRename) await loadTree();
    else                    renderTree();
  } catch (e) {
    setEdStatus(e.message, "err");
  } finally {
    $("b-save").disabled = false;
  }
}

async function doDelete() {
  const path = state.selected || $("ed-path").value.trim();
  if (!path) return;
  const ok = await confirmDialog({
    title: "Delete entry?",
    body:  `Permanently delete  pass/${path}  from the store?`,
    confirmLabel: "Delete",
  });
  if (!ok) return;

  setEdStatus("deleting…");
  try {
    await passDelete(path);
    setEdStatus("deleted", "ok");
    state.selected = null;
    state.mode = "view";
    state.dirty = false;
    state.loaded = false;
    showForm(false);
    await loadTree();
  } catch (e) {
    setEdStatus(e.message, "err");
  }
}

async function doReload() {
  if (!state.selected) return;
  state.dirty = false;
  await pickEntry(state.selected);
}

async function doFill() {
  const path = state.selected;
  if (!path) { setEdStatus("save the entry first to fill", "err"); return; }
  setEdStatus("filling active tab…");
  try {
    const resp = await passFill(path);
    if (resp.ok) setEdStatus("fill sent", "ok");
    else         setEdStatus("fill returned false", "err");
  } catch (e) {
    setEdStatus(e.message, "err");
  }
}

// ─── Clipboard / open URL ───────────────────────────────────────────
async function copyToClipboard(text, label) {
  if (!text) { setEdStatus(`nothing to copy (${label})`, "err"); return; }
  try {
    await navigator.clipboard.writeText(text);
    setEdStatus(`${label} copied`, "ok");
  } catch (e) {
    setEdStatus(`clipboard: ${e.message}`, "err");
  }
}

async function copyOtpCode() {
  const path = state.selected;
  if (!path) { setEdStatus("save the entry first to fetch OTP", "err"); return; }
  try {
    const resp = await send({ kind: "pass.otp", path });
    if (!resp.otp) { setEdStatus("no OTP available", "err"); return; }
    await navigator.clipboard.writeText(resp.otp);
    setEdStatus("otp code copied", "ok");
  } catch (e) {
    setEdStatus(e.message, "err");
  }
}

function openUrl() {
  const url = $("ed-url").value.trim();
  if (!url) return;
  chrome.tabs.create({ url });
}

// ─── Password / passphrase generator ─────────────────────────────────
// Draws are UNBIASED via rejection sampling. The old `buf[i] % charset.length`
// skewed toward the first (2^32 mod N) characters; randInt() rejects the
// non-uniform tail so every character/word is equiprobable.
const GEN_SETS = {
  lower:   "abcdefghijklmnopqrstuvwxyz",
  upper:   "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits:  "0123456789",
  symbols: "!@#$%^&*-_=+?.,:;",
};
const GEN_AMBIGUOUS = "Il1O0o5S2Z8B|`'\"{}[]()/\\";
// Curated memorable word list for passphrases; entropy is computed from its
// actual length (log2), so this can grow without changing the math.
const GEN_WORDS = ("able acid aged also apex arch army atom aunt away baby back bald band bank barn base bath beam bean bear belt bird blue boat bold bone book boot born both bowl brave bread brick brisk calm camp cane card cargo cave cell chef city clay clip club coal coat code coin cold cool coral core corn crab crew crop cube curl dawn deep deer desk dial diet dish dock door dose dove drum dune dusk duty each earn east easy echo edge exit face fact fair fern film fire fish five flag flame flask fleet flint foam fold folk food fork fort four fuel gate gaze gear gift girl glad glow goat gold golf good grid grip half hand hawk haze herb hero hill hint hive hold hook horn host hour hunt icon iris iron item ivy jade jazz jump keen kelp kind king kite knot lace lake lamp land lava leaf left lens lime line link lion lock loft loom luck lung lynx mage main mango maple mask mast maze mesh mint mist moon moss moth nest node noon oak oath oats onyx opal oval owl palm park path peak pear pine plum pond pony pool port puma quilt raft rail rain ramp reef reid rice ridge ring river road robe rock root rose ruby rush sage sail salt sand seal seed ship shoe silk slate snow soap sofa solar song spare spark spice star stem stone surf swan tank teal tent tide tile tone tribe tulip tuna vale vane vase vast veil vine wave wolf wood yarn zinc zone").split(/\s+/);

function randInt(n) {
  if (n <= 0) return 0;
  const limit = Math.floor(0x100000000 / n) * n;   // largest multiple of n ≤ 2^32
  const buf = new Uint32Array(1);
  let x;
  do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
  return x % n;
}
function genPool(opts) {
  let pool = "";
  if (opts.lower   !== false) pool += GEN_SETS.lower;
  if (opts.upper   !== false) pool += GEN_SETS.upper;
  if (opts.digits  !== false) pool += GEN_SETS.digits;
  if (opts.symbols !== false) pool += GEN_SETS.symbols;
  if (opts.avoidAmbiguous) pool = [...pool].filter((c) => !GEN_AMBIGUOUS.includes(c)).join("");
  return pool || (GEN_SETS.lower + GEN_SETS.upper + GEN_SETS.digits);
}
// generatePassword(24) still works; generatePassword({length, lower, upper, digits, symbols, avoidAmbiguous}).
function generatePassword(opts) {
  if (typeof opts === "number") opts = { length: opts };
  opts = opts || {};
  const length = Math.max(4, Math.min(256, opts.length || 24));
  const pool = genPool(opts);
  // guarantee ≥1 char from each enabled class, then fill from the pool + shuffle
  const out = [];
  for (const k of ["lower", "upper", "digits", "symbols"]) {
    if (opts[k] === false || out.length >= length) continue;
    let s = GEN_SETS[k];
    if (opts.avoidAmbiguous) s = [...s].filter((c) => !GEN_AMBIGUOUS.includes(c)).join("");
    if (s) out.push(s[randInt(s.length)]);
  }
  while (out.length < length) out.push(pool[randInt(pool.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = randInt(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return { value: out.join(""), bits: Math.round(length * Math.log2(pool.length)) };
}
function generatePassphrase(opts) {
  opts = opts || {};
  const n = Math.max(2, Math.min(12, opts.words || 5));
  const sep = opts.separator == null ? "-" : opts.separator;
  const words = [];
  for (let i = 0; i < n; i++) {
    let w = GEN_WORDS[randInt(GEN_WORDS.length)];
    if (opts.capitalize) w = w[0].toUpperCase() + w.slice(1);
    words.push(w);
  }
  let phrase = words.join(sep);
  let bits = Math.round(n * Math.log2(GEN_WORDS.length));
  if (opts.number) { phrase += sep + randInt(100); bits += Math.round(Math.log2(100)); }
  return { value: phrase, bits };
}

// Generator popover — mode (password / passphrase) + options + live preview,
// anchored under the ⚙ button. "use" writes the result into the password field.
let genPop = null, genOutside = null, genEsc = null;
function closeGenerator() {
  if (genOutside) document.removeEventListener("mousedown", genOutside);
  if (genEsc) document.removeEventListener("keydown", genEsc);
  genOutside = genEsc = null;
  if (genPop) genPop.remove();
  genPop = null;
}
function openGenerator(anchor) {
  if (genPop) { closeGenerator(); return; }
  const opts = { mode: "password", length: 24, lower: true, upper: true, digits: true, symbols: true,
                 avoidAmbiguous: false, words: 5, separator: "-", capitalize: false, number: true };
  const pop = document.createElement("div");
  pop.className = "pw-gen-pop";
  pop.innerHTML = `
    <div class="pw-gen-tabs">
      <button type="button" class="pw-gen-tab active" data-mode="password">Password</button>
      <button type="button" class="pw-gen-tab" data-mode="passphrase">Passphrase</button>
    </div>
    <div class="pw-gen-preview">
      <input id="pw-gen-out" class="mono" readonly>
      <button type="button" id="pw-gen-re" title="Regenerate">↻</button>
    </div>
    <div class="pw-gen-bits" id="pw-gen-bits"></div>
    <div class="pw-gen-body" data-for="password">
      <label class="pw-gen-range">length <b id="pw-gen-lenv">24</b><input type="range" id="pw-gen-len" min="8" max="64" value="24"></label>
      <label><input type="checkbox" id="pw-gen-lower" checked> a–z</label>
      <label><input type="checkbox" id="pw-gen-upper" checked> A–Z</label>
      <label><input type="checkbox" id="pw-gen-digits" checked> 0–9</label>
      <label><input type="checkbox" id="pw-gen-symbols" checked> !@#$</label>
      <label><input type="checkbox" id="pw-gen-ambig"> avoid ambiguous (Il1O0…)</label>
    </div>
    <div class="pw-gen-body hidden" data-for="passphrase">
      <label class="pw-gen-range">words <b id="pw-gen-wordsv">5</b><input type="range" id="pw-gen-words" min="3" max="8" value="5"></label>
      <label>separator <input type="text" id="pw-gen-sep" value="-" maxlength="3" class="pw-gen-sep"></label>
      <label><input type="checkbox" id="pw-gen-cap"> Capitalize words</label>
      <label><input type="checkbox" id="pw-gen-num" checked> append number</label>
    </div>
    <div class="pw-gen-actions">
      <button type="button" class="pw-gen-btn" id="pw-gen-cancel">cancel</button>
      <button type="button" class="pw-gen-btn pw-gen-btn-primary" id="pw-gen-use">use ↵</button>
    </div>`;
  document.body.appendChild(pop);
  genPop = pop;
  const r = anchor.getBoundingClientRect();
  pop.style.top = (r.bottom + 6) + "px";
  pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8)) + "px";

  const out = pop.querySelector("#pw-gen-out");
  const bitsEl = pop.querySelector("#pw-gen-bits");
  const q = (id) => pop.querySelector("#" + id);
  function read() {
    opts.length = +q("pw-gen-len").value;
    opts.lower = q("pw-gen-lower").checked;
    opts.upper = q("pw-gen-upper").checked;
    opts.digits = q("pw-gen-digits").checked;
    opts.symbols = q("pw-gen-symbols").checked;
    opts.avoidAmbiguous = q("pw-gen-ambig").checked;
    opts.words = +q("pw-gen-words").value;
    opts.separator = q("pw-gen-sep").value;
    opts.capitalize = q("pw-gen-cap").checked;
    opts.number = q("pw-gen-num").checked;
    q("pw-gen-lenv").textContent = opts.length;
    q("pw-gen-wordsv").textContent = opts.words;
  }
  function regen() {
    read();
    const res = opts.mode === "passphrase" ? generatePassphrase(opts) : generatePassword(opts);
    out.value = res.value;
    const tier = res.bits >= 90 ? "very strong" : res.bits >= 70 ? "strong" : res.bits >= 50 ? "ok" : "weak";
    bitsEl.textContent = "≈ " + res.bits + " bits · " + tier;
    bitsEl.className = "pw-gen-bits " + (res.bits >= 70 ? "good" : res.bits >= 50 ? "mid" : "low");
  }
  pop.querySelectorAll(".pw-gen-tab").forEach((t) => t.addEventListener("click", () => {
    opts.mode = t.dataset.mode;
    pop.querySelectorAll(".pw-gen-tab").forEach((x) => x.classList.toggle("active", x === t));
    pop.querySelectorAll(".pw-gen-body").forEach((b) => b.classList.toggle("hidden", b.dataset.for !== opts.mode));
    regen();
  }));
  pop.addEventListener("input", regen);
  q("pw-gen-re").addEventListener("click", (e) => { e.preventDefault(); regen(); });
  q("pw-gen-cancel").addEventListener("click", closeGenerator);
  q("pw-gen-use").addEventListener("click", () => { $("ed-pw").value = out.value; markDirty(); closeGenerator(); });
  genOutside = (e) => { if (genPop && !genPop.contains(e.target) && e.target !== anchor) closeGenerator(); };
  genEsc = (e) => { if (e.key === "Escape") { e.preventDefault(); closeGenerator(); } else if (e.key === "Enter" && genPop && genPop.contains(document.activeElement)) { e.preventDefault(); $("ed-pw").value = out.value; markDirty(); closeGenerator(); } };
  setTimeout(() => { document.addEventListener("mousedown", genOutside); document.addEventListener("keydown", genEsc); }, 0);
  regen();
}

function togglePwVisibility() {
  state.pwShown = !state.pwShown;
  $("ed-pw").type = state.pwShown ? "text" : "password";
}

function confirmDialog({ title, body, confirmLabel = "OK", danger = true }) {
  return new Promise((resolve) => {
    const scrim = document.createElement("div");
    scrim.className = "confirm-scrim";
    scrim.innerHTML = `
      <div class="confirm-box" role="dialog" aria-modal="true">
        <div class="ctitle">${escapeHtml(title)}</div>
        <div class="cbody">${escapeHtml(body)}</div>
        <div class="crow">
          <button class="btn ghost" data-act="cancel">Cancel</button>
          <button class="btn ${danger ? "danger" : "primary"}" data-act="ok">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(scrim);
    const cleanup = (v) => { scrim.remove(); resolve(v); };
    scrim.addEventListener("click", (ev) => {
      if (ev.target === scrim) cleanup(false);
    });
    scrim.querySelector('[data-act="cancel"]').addEventListener("click", () => cleanup(false));
    scrim.querySelector('[data-act="ok"]').addEventListener("click", () => cleanup(true));
    scrim.querySelector('[data-act="ok"]').focus();
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ─── Wire up ────────────────────────────────────────────────────────
function wire() {
  $("t-new").addEventListener("click", startNew);
  $("t-new-profile").addEventListener("click", startNewProfileTemplate);
  $("t-new-card").addEventListener("click",    startNewCardTemplate);
  $("t-refresh").addEventListener("click", loadTree);
  $("t-expand").addEventListener("click", () => { state.collapsed.clear(); renderTree(); });
  $("t-collapse").addEventListener("click", () => {
    state.collapsed.clear();
    // Collapse every dir node by walking the tree.
    const walk = (node) => {
      for (const d of node.dirs) { state.collapsed.add(d.path); walk(d); }
    };
    if (state.tree) walk(state.tree);
    renderTree();
  });

  $("search").addEventListener("input", (ev) => {
    state.filter = ev.target.value || "";
    renderTree();
  });

  $("ed-form").addEventListener("submit", doSave);
  $("b-save").addEventListener("click", doSave);
  $("b-delete").addEventListener("click", doDelete);
  $("b-reload").addEventListener("click", doReload);
  $("b-fill").addEventListener("click", doFill);

  $("b-pw-toggle").addEventListener("click", togglePwVisibility);
  $("b-pw-copy").addEventListener("click", () => copyToClipboard($("ed-pw").value, "password"));
  $("b-pw-gen").addEventListener("click", (e) => openGenerator(e.currentTarget));
  $("b-login-copy").addEventListener("click", () => copyToClipboard($("ed-login").value, "login"));
  $("b-url-open").addEventListener("click", openUrl);
  $("b-otp-copy").addEventListener("click", copyOtpCode);

  $("b-add-kv").addEventListener("click", () => {
    $("kv-list").appendChild(makeKvRow("", ""));
    markDirty();
  });

  $("b-view-raw").addEventListener("click", toggleRawView);
  $("ed-raw").addEventListener("input", markDirty);

  ["ed-pw", "ed-login", "ed-url", "ed-otp", "ed-notes", "ed-path"].forEach((id) => {
    $(id).addEventListener("input", markDirty);
  });

  // Auto-derive entry path from URL + login while creating a new entry.
  // The path field flips to "user-edited" the moment they type into it
  // by hand, after which we stop overwriting it.
  $("ed-url").addEventListener("input",   maybeAutoDerivePath);
  $("ed-login").addEventListener("input", maybeAutoDerivePath);
  $("ed-path").addEventListener("input",  () => { state.pathTouched = true; });

  window.addEventListener("keydown", (ev) => {
    if (ev.target && /^(INPUT|TEXTAREA)$/.test(ev.target.tagName)) return;
    if (ev.key === "n" && !ev.metaKey && !ev.ctrlKey) { startNew(); ev.preventDefault(); }
    else if (ev.key === "r" && !ev.metaKey && !ev.ctrlKey) { loadTree(); ev.preventDefault(); }
    else if (ev.key === "/" && !ev.metaKey && !ev.ctrlKey) { $("search").focus(); ev.preventDefault(); }
  });

  window.addEventListener("beforeunload", (ev) => {
    if (state.dirty) {
      ev.preventDefault();
      ev.returnValue = "";
    }
  });
}

wire();
loadTree();
