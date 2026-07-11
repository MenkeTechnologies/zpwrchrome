// zpwrchrome — cyberpunk theme injector settings page.

import "../lib/page-nav.js";
import { buildThemeCss } from "../lib/cyber-theme-css.js";
import {
  COLOR_SCHEMES, SCHEME_IDS, DEFAULT_SCHEME, themeFor, themeFromVars,
  CUSTOM_EDIT_KEYS, buildCustomScheme,
} from "../lib/color-schemes.js";
import { UI_SCHEME_KEY, UI_LIGHT_KEY, UI_PALETTE_KEY } from "../lib/ui-scheme.js";

const STATE_KEY = "theme.injector";
// The saved custom-scheme LIBRARY, synced from ~/.zwire/global.toml by the host and
// mirrored here by background.js. An ordered array of { name, vars }; a scheme at
// index N is identified as 'custom-N' (matches zgui-core's colorscheme presets).
const UI_SCHEMES_KEY = "ui.schemes";
const $ = (id) => document.getElementById(id);

// The scheme dots shown on each picker button (the visually load-bearing tokens).
const DOT_VARS = ["--accent", "--cyan", "--magenta", "--green", "--yellow", "--orange"];

// Custom saved schemes synced from the fleet (populated from ui.schemes storage).
let customSchemes = [];
// The un-named live 'custom' edit's full var map (mirrors zgui-core customSchemeVars);
// persisted in the state bag so an in-progress edit survives a reload.
let liveCustomVars = {};

const state = {
  bag: {
    enabled:   false,
    mode:      "all",
    domains:   [],
    intensity: "medium",
    forceMono: false,
    scanlines: false,
    darkMode:  false,
    scheme:    DEFAULT_SCHEME,
    palette:   themeFor(DEFAULT_SCHEME),
    customVars: {},
  },
};

function setStatus(msg, cls = "") {
  const el = $("status");
  el.textContent = msg;
  el.className = cls ? `status ${cls}` : "dim";
  if (cls === "ok") setTimeout(() => { if (el.textContent === msg) el.textContent = "—"; }, 1500);
}

function parseDomains(text) {
  return String(text || "")
    .split(/[\n,]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// One picker button: label + description + colour dots. `vars` is the scheme's
// `--`-prefixed var map (built-in table or a custom scheme's synced map).
function schemeButton(id, label, desc, vars) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "scheme-btn";
  btn.dataset.scheme = id;

  const name = document.createElement("div");
  name.className = "scheme-name";
  name.textContent = label;

  const d0 = document.createElement("div");
  d0.className = "scheme-desc";
  d0.textContent = desc;

  const dots = document.createElement("div");
  dots.className = "scheme-dots";
  for (const v of DOT_VARS) {
    const dot = document.createElement("span");
    dot.className = "scheme-dot";
    dot.style.background = (vars && vars[v]) || "#888";
    dots.appendChild(dot);
  }

  btn.append(name, d0, dots);
  btn.addEventListener("click", () => selectScheme(id));
  return btn;
}

// Build the scheme picker: the 8 vendored built-ins, then every custom scheme
// synced from ~/.zwire/global.toml (ui.schemes). Clicking writes the UI-scheme key
// (recolors zpwrchrome's own pages) and the page-recolor palette; a custom pick also
// writes ui.palette so the whole fleet repaints via the background bridge.
function buildSchemeGrid() {
  const grid = $("scheme-grid");
  grid.textContent = "";
  for (const id of SCHEME_IDS) {
    const s = COLOR_SCHEMES[id];
    grid.appendChild(schemeButton(id, s.label, s.desc, s.vars));
  }
  customSchemes.forEach((s, i) => {
    if (!s || !s.vars) return;
    grid.appendChild(schemeButton("custom-" + i, s.name || "Custom " + (i + 1), "custom (shared)", s.vars));
  });
  markActiveScheme();
}

// A custom/edited scheme ('custom' / 'custom-N') has no vendored table entry.
function isCustomScheme(id) { return id === "custom" || (typeof id === "string" && id.startsWith("custom-")); }

// The raw var→hex map backing any scheme id: a saved preset's vars, the live
// 'custom' edit's vars, or a built-in table entry. Null for an unknown id.
function varsForScheme(id) {
  const m = /^custom-(\d+)$/.exec(id || "");
  if (m) return customSchemes[Number(m[1])]?.vars || null;
  if (id === "custom") return liveCustomVars;
  return COLOR_SCHEMES[id]?.vars || null;
}

// Resolve any scheme id → the page-recolor palette (built-in table or synced vars).
function paletteForScheme(id) {
  const v = varsForScheme(id);
  if (v && Object.keys(v).length) return themeFromVars(v);
  return themeFor(isCustomScheme(id) ? DEFAULT_SCHEME : id);
}

function markActiveScheme() {
  for (const btn of $("scheme-grid").querySelectorAll(".scheme-btn")) {
    btn.classList.toggle("active", btn.dataset.scheme === state.bag.scheme);
  }
}

function schemeLabel(id) {
  const m = /^custom-(\d+)$/.exec(id || "");
  if (m) return customSchemes[Number(m[1])]?.name || id;
  return COLOR_SCHEMES[id]?.label || id;
}

async function selectScheme(id) {
  state.bag.scheme = id;
  state.bag.palette = paletteForScheme(id);
  markActiveScheme();
  updatePreview();
  // One write drives both surfaces: ui.scheme for zpwrchrome's own pages,
  // theme.injector (with palette) for the page-recolor content script.
  const write = { [STATE_KEY]: state.bag, [UI_SCHEME_KEY]: id };
  // Always write the resolved var→hex map — for a built-in too, not just custom.
  // lib/ui-scheme.js only consumes it for custom schemes, but background.js forwards
  // it to the host, which projects it to ~/.zwire/hud-palette (the native chrome's
  // base colours). Projecting for built-ins keeps that projection in lockstep, so
  // switching from a custom scheme back to a built-in repaints the native tab/accent.
  write[UI_PALETTE_KEY] = varsForScheme(id) || {};
  await chrome.storage.local.set(write);
  if (typeof reseedEditor === "function") reseedEditor();
  renderPresetChips();
  setStatus("scheme: " + schemeLabel(id), "ok");
}

/* ── Custom-scheme editor + saved-preset library (port of zgui-core colorscheme.js
 *    buildEditor / buildPresetChips, standalone: chrome.storage instead of ZGui.prefs).
 *    All persistence rides ui.scheme / ui.palette / ui.schemes so background.js relays
 *    it to the host → ~/.zwire/global.toml → the whole zwire fleet. ───────────────── */

// The base hex values to seed the editor from: the active scheme's raw vars.
function currentBaseVars() { return varsForScheme(state.bag.scheme) || COLOR_SCHEMES[DEFAULT_SCHEME].vars; }
function pickerMap(root) {
  const m = {};
  root.querySelectorAll(".custom-color-input").forEach((i) => { m[i.dataset.var] = i.value; });
  return m;
}

// Apply an edit from the swatches: build the full scheme (auto glow/dim/bg). If a saved
// preset is active, overwrite it in place (its chip follows the colours live + Save/Update
// keep targeting it); otherwise fork to the un-named live 'custom' scheme.
async function applyCustomEdit(vars) {
  const m = /^custom-(\d+)$/.exec(state.bag.scheme);
  if (m && customSchemes[Number(m[1])]) {
    customSchemes[Number(m[1])].vars = vars;
    state.bag.palette = themeFromVars(vars);
    markActiveScheme(); updatePreview(); renderPresetChips();
    await chrome.storage.local.set({
      [STATE_KEY]: state.bag,
      [UI_PALETTE_KEY]: vars,
      [UI_SCHEMES_KEY]: customSchemes,
    });
  } else {
    liveCustomVars = vars;
    state.bag.customVars = vars;
    state.bag.scheme = "custom";
    state.bag.palette = themeFromVars(vars);
    markActiveScheme(); updatePreview(); renderPresetChips();
    await chrome.storage.local.set({
      [STATE_KEY]: state.bag,
      [UI_SCHEME_KEY]: "custom",
      [UI_PALETTE_KEY]: vars,
    });
  }
}

let reseedEditor = null;
// The swatch grid: one <input type=color> per editable base token, seeded from the
// active scheme. Editing any swatch rebuilds + applies the full scheme live.
function buildEditor() {
  const host = $("custom-editor");
  if (!host) return;
  host.className = "custom-color-grid";
  const seed = currentBaseVars();
  host.textContent = "";
  for (const k of CUSTOM_EDIT_KEYS) {
    const hex = (seed[k] && /^#[0-9a-fA-F]{6}$/.test(seed[k])) ? seed[k] : "#000000";
    const label = document.createElement("label");
    label.className = "custom-color-item";
    const span = document.createElement("span");
    span.className = "custom-color-label";
    span.textContent = k.replace("--", "");
    const input = document.createElement("input");
    input.type = "color";
    input.className = "custom-color-input";
    input.dataset.var = k;
    input.value = hex;
    label.append(span, input);
    host.appendChild(label);
  }
  host.addEventListener("input", (e) => {
    if (!e.target.closest || !e.target.closest(".custom-color-input")) return;
    applyCustomEdit(buildCustomScheme(pickerMap(host)));
  });
  reseedEditor = () => {
    const s = currentBaseVars();
    host.querySelectorAll(".custom-color-input").forEach((i) => { if (s[i.dataset.var]) i.value = s[i.dataset.var]; });
  };
}

function activePresetIdx() {
  const m = /^custom-(\d+)$/.exec(state.bag.scheme || "");
  return m ? Number(m[1]) : -1;
}

// Persist the library + (optionally) the active scheme/palette in one write so
// background.js relays a single consistent state to the host.
async function writeLibrary(extra) {
  await chrome.storage.local.set(Object.assign({ [STATE_KEY]: state.bag, [UI_SCHEMES_KEY]: customSchemes }, extra || {}));
}

async function savePreset() {
  const nameEl = $("custom-presets").querySelector(".custom-preset-name");
  const name = (nameEl?.value || "").trim() || ("Custom " + (customSchemes.length + 1));
  const vars = currentBaseVars();
  customSchemes.push({ name, vars: buildCustomScheme(Object.assign({}, vars)) });
  const idx = customSchemes.length - 1;
  state.bag.scheme = "custom-" + idx;
  state.bag.palette = themeFromVars(customSchemes[idx].vars);
  buildSchemeGrid(); updatePreview(); renderPresetChips();
  await writeLibrary({ [UI_SCHEME_KEY]: "custom-" + idx, [UI_PALETTE_KEY]: customSchemes[idx].vars });
  setStatus("saved scheme: " + name, "ok");
}

async function updatePresetActive() {
  const ai = activePresetIdx();
  if (ai < 0) return;
  const nameEl = $("custom-presets").querySelector(".custom-preset-name");
  const name = (nameEl?.value || "").trim() || customSchemes[ai].name;
  customSchemes[ai] = { name, vars: currentBaseVars() };
  buildSchemeGrid(); renderPresetChips();
  await writeLibrary();
  setStatus("updated scheme: " + name, "ok");
}

async function deleteAllPresets() {
  customSchemes = [];
  buildSchemeGrid(); renderPresetChips();
  await writeLibrary();
  setStatus("deleted all custom schemes", "ok");
}

// Delete one preset; reindex the active 'custom-N' marker so it keeps pointing at the
// same scheme (or drops to the un-named live 'custom' when the active one is removed).
async function deletePreset(idx) {
  if (idx < 0 || idx >= customSchemes.length) return;
  customSchemes.splice(idx, 1);
  const ai = activePresetIdx();
  if (ai === idx) state.bag.scheme = "custom";
  else if (ai > idx) state.bag.scheme = "custom-" + (ai - 1);
  buildSchemeGrid(); renderPresetChips();
  await writeLibrary({ [UI_SCHEME_KEY]: state.bag.scheme });
  setStatus("deleted custom scheme", "ok");
}

// Load (apply) a saved preset — same path as picking its button in the grid.
function loadPreset(idx) {
  if (idx < 0 || idx >= customSchemes.length) return;
  selectScheme("custom-" + idx);
}

// The name+Save/Update/Delete-all toolbar over the saved-scheme chip row.
function renderPresetChips() {
  const host = $("custom-presets");
  if (!host) return;
  host.className = "custom-scheme-saved";
  const ai = activePresetIdx();
  const activeName = ai >= 0 && customSchemes[ai] ? customSchemes[ai].name : "";
  host.textContent = "";

  const bar = document.createElement("div");
  bar.className = "custom-preset-bar";
  const name = document.createElement("input");
  name.className = "custom-preset-name";
  name.type = "text";
  name.placeholder = "Scheme name";
  name.maxLength = 40;
  name.value = activeName;
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); savePreset(); } });
  const save = document.createElement("button");
  save.type = "button"; save.className = "custom-preset-save"; save.textContent = "Save";
  save.title = "Save current colors as a new scheme";
  save.addEventListener("click", () => savePreset());
  bar.append(name, save);
  if (ai >= 0) {
    const upd = document.createElement("button");
    upd.type = "button"; upd.className = "custom-preset-update"; upd.textContent = "Update";
    upd.title = "Rename / overwrite the active scheme";
    upd.addEventListener("click", () => updatePresetActive());
    bar.appendChild(upd);
  }
  if (customSchemes.length) {
    const clr = document.createElement("button");
    clr.type = "button"; clr.className = "custom-preset-clear"; clr.textContent = "Delete all";
    clr.title = "Delete all saved schemes";
    clr.addEventListener("click", () => deleteAllPresets());
    bar.appendChild(clr);
  }
  host.appendChild(bar);

  const chips = document.createElement("div");
  chips.className = "custom-preset-chips";
  customSchemes.forEach((p, i) => {
    const chip = document.createElement("span");
    chip.className = "custom-preset-chip" + (i === ai ? " active" : "");
    chip.title = p.name;
    const dots = document.createElement("span");
    dots.className = "custom-preset-chip-dots";
    for (const v of ["--accent", "--cyan", "--magenta"]) {
      const d = document.createElement("span");
      d.className = "custom-preset-chip-dot";
      d.style.background = (p.vars && p.vars[v]) || "#888";
      dots.appendChild(d);
    }
    const nm = document.createElement("span");
    nm.className = "custom-preset-chip-name";
    nm.textContent = p.name;
    const del = document.createElement("span");
    del.className = "custom-preset-del";
    del.textContent = "×";
    del.title = "Delete this scheme";
    del.addEventListener("click", (e) => { e.stopPropagation(); deletePreset(i); });
    chip.append(dots, nm, del);
    chip.addEventListener("click", () => loadPreset(i));
    chips.appendChild(chip);
  });
  host.appendChild(chips);
}

function render() {
  markActiveScheme();
  $("enabled").checked = !!state.bag.enabled;
  $("toggle-label").textContent = state.bag.enabled ? "on" : "off";
  for (const r of document.querySelectorAll('input[name="intensity"]')) {
    r.checked = r.value === (state.bag.intensity || "medium");
  }
  for (const r of document.querySelectorAll('input[name="mode"]')) {
    r.checked = r.value === (state.bag.mode || "all");
  }
  $("forceMono").checked = !!state.bag.forceMono;
  $("scanlines").checked = !!state.bag.scanlines;
  $("darkMode").checked  = !!state.bag.darkMode;
  $("domains").value     = (state.bag.domains || []).join("\n");
  $("domains-lbl").textContent = state.bag.mode === "allowlist"
    ? "Allowlist (one host per line)"
    : "Blocklist (one host per line)";
  updatePreview();
}

function updatePreview() {
  const css = state.bag.enabled
    ? buildThemeCss({
        intensity: state.bag.intensity,
        forceMono: state.bag.forceMono,
        scanlines: state.bag.scanlines,
        darkMode:  state.bag.darkMode,
        palette:   state.bag.palette,
      })
    : "";
  // Scope every selector under #preview-body so the page's own chrome
  // isn't restyled by the preview.
  const scoped = css.replace(/(^|\})\s*([^{}]+)\s*\{/g, (_, brace, selectors) => {
    if (!brace) brace = "";
    const scopedSelectors = selectors.split(",")
      .map((s) => s.trim())
      .map((s) => {
        if (s.startsWith("@") || s.startsWith("html") || s === "*" || s.startsWith("::-webkit-scrollbar")) return s;
        return `#preview-body ${s}`;
      })
      .join(", ");
    return `${brace} ${scopedSelectors} {`;
  });
  $("zpwr-cyber-theme-preview").textContent = scoped;
}

async function save() {
  await chrome.storage.local.set({ [STATE_KEY]: state.bag });
  setStatus("saved", "ok");
}

async function load() {
  const bag = await chrome.storage.local.get([STATE_KEY, UI_SCHEME_KEY, UI_LIGHT_KEY, UI_SCHEMES_KEY, UI_PALETTE_KEY]);
  if (bag?.[STATE_KEY]) state.bag = { ...state.bag, ...bag[STATE_KEY] };
  customSchemes = Array.isArray(bag?.[UI_SCHEMES_KEY]) ? bag[UI_SCHEMES_KEY] : [];
  // ui.scheme is the source of truth for the chosen scheme; recompute the
  // palette from the id so a vendored-color change can never serve stale hex.
  state.bag.scheme = bag?.[UI_SCHEME_KEY] || state.bag.scheme || DEFAULT_SCHEME;
  // Restore the un-named live 'custom' edit: prefer the host's resolved palette,
  // else the bag's remembered vars, so the editor + preview seed from real colours.
  liveCustomVars = (bag?.[UI_PALETTE_KEY] && Object.keys(bag[UI_PALETTE_KEY]).length)
    ? bag[UI_PALETTE_KEY]
    : (state.bag.customVars || {});
  state.bag.palette = paletteForScheme(state.bag.scheme);
  const lt = $("lightMode"); if (lt) lt.checked = !!bag?.[UI_LIGHT_KEY];
  buildSchemeGrid();   // rebuild with the freshly-loaded custom schemes
  buildEditor();       // swatch grid seeded from the active scheme
  renderPresetChips(); // saved-scheme library toolbar + chips
  render();
}

// Light mode is a global HUD setting mirrored into ui.light. Writing it here
// recolors every zpwrchrome page (lib/ui-scheme.js) AND tells the HUD to flip
// the whole browser (background.js → zb-ui-set). Keep the toggle in sync when
// it's changed from the HUD or another page.
$("lightMode")?.addEventListener("change", (ev) => {
  chrome.storage.local.set({ [UI_LIGHT_KEY]: !!ev.target.checked });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[UI_LIGHT_KEY]) {
    const t = $("lightMode"); if (t) t.checked = !!changes[UI_LIGHT_KEY].newValue;
  }
  // The shared custom-scheme library changed (saved/renamed/deleted on another
  // fleet surface) — rebuild the picker + chips so they mirror ~/.zwire/global.toml.
  if (changes[UI_SCHEMES_KEY]) {
    customSchemes = Array.isArray(changes[UI_SCHEMES_KEY].newValue) ? changes[UI_SCHEMES_KEY].newValue : [];
    buildSchemeGrid();
    renderPresetChips();
  }
  // The active scheme changed elsewhere (HUD, newtab, another zpwrchrome page) —
  // keep the picker highlight, editor swatches, chips + preview in sync, no reload.
  if (changes[UI_SCHEME_KEY] && changes[UI_SCHEME_KEY].newValue) {
    state.bag.scheme = changes[UI_SCHEME_KEY].newValue;
    state.bag.palette = paletteForScheme(state.bag.scheme);
    markActiveScheme();
    if (typeof reseedEditor === "function") reseedEditor();
    renderPresetChips();
    updatePreview();
  }
  // A custom scheme's resolved palette changed elsewhere — follow the colours in the
  // editor swatches + preview (the live 'custom' edit backs off ui.palette).
  if (changes[UI_PALETTE_KEY] && changes[UI_PALETTE_KEY].newValue && isCustomScheme(state.bag.scheme)) {
    const pal = changes[UI_PALETTE_KEY].newValue;
    if (state.bag.scheme === "custom") liveCustomVars = pal;
    state.bag.palette = themeFromVars(pal);
    if (typeof reseedEditor === "function") reseedEditor();
    updatePreview();
  }
});

buildSchemeGrid();
buildEditor();
renderPresetChips();

// ─── Wire up ────────────────────────────────────────────────────────
$("enabled").addEventListener("change", (ev) => {
  state.bag.enabled = !!ev.target.checked;
  render(); save();
});
document.querySelectorAll('input[name="intensity"]').forEach((r) => {
  r.addEventListener("change", () => {
    if (!r.checked) return;
    state.bag.intensity = r.value;
    updatePreview(); save();
  });
});
document.querySelectorAll('input[name="mode"]').forEach((r) => {
  r.addEventListener("change", () => {
    if (!r.checked) return;
    state.bag.mode = r.value;
    $("domains-lbl").textContent = state.bag.mode === "allowlist"
      ? "Allowlist (one host per line)"
      : "Blocklist (one host per line)";
    save();
  });
});
$("forceMono").addEventListener("change", (ev) => { state.bag.forceMono = !!ev.target.checked; updatePreview(); save(); });
$("scanlines").addEventListener("change", (ev) => { state.bag.scanlines = !!ev.target.checked; updatePreview(); save(); });
$("darkMode").addEventListener("change",  (ev) => { state.bag.darkMode  = !!ev.target.checked; updatePreview(); save(); });
$("domains").addEventListener("change", (ev) => { state.bag.domains = parseDomains(ev.target.value); save(); });

load();
