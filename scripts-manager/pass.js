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
  $("ed-pw").value = generatePassword(24);
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

// ─── Misc ───────────────────────────────────────────────────────────
function generatePassword(len) {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*-_=+";
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < len; i++) out += charset[buf[i] % charset.length];
  return out;
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
  $("b-pw-gen").addEventListener("click", () => {
    $("ed-pw").value = generatePassword(24);
    markDirty();
  });
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
