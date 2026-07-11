// zpwrchrome — cyberpunk theme injector settings page.

import "../lib/page-nav.js";
import { buildThemeCss } from "../lib/cyber-theme-css.js";
import { COLOR_SCHEMES, SCHEME_IDS, DEFAULT_SCHEME, themeFor, themeFromVars } from "../lib/color-schemes.js";
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

// Resolve any scheme id → the page-recolor palette (built-in table or synced vars).
function paletteForScheme(id) {
  const m = /^custom-(\d+)$/.exec(id || "");
  if (m) {
    const s = customSchemes[Number(m[1])];
    if (s && s.vars) return themeFromVars(s.vars);
  }
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
  // A custom scheme has no vendored colours, so lib/ui-scheme.js renders it from
  // ui.palette. Write the resolved var→hex map; background.js forwards it to the
  // host so the whole fleet repaints. Clear it for a built-in (name is enough).
  const m = /^custom-(\d+)$/.exec(id);
  write[UI_PALETTE_KEY] = m ? (customSchemes[Number(m[1])]?.vars || {}) : {};
  await chrome.storage.local.set(write);
  setStatus("scheme: " + schemeLabel(id), "ok");
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
  const bag = await chrome.storage.local.get([STATE_KEY, UI_SCHEME_KEY, UI_LIGHT_KEY, UI_SCHEMES_KEY]);
  if (bag?.[STATE_KEY]) state.bag = { ...state.bag, ...bag[STATE_KEY] };
  customSchemes = Array.isArray(bag?.[UI_SCHEMES_KEY]) ? bag[UI_SCHEMES_KEY] : [];
  // ui.scheme is the source of truth for the chosen scheme; recompute the
  // palette from the id so a vendored-color change can never serve stale hex.
  state.bag.scheme = bag?.[UI_SCHEME_KEY] || state.bag.scheme || DEFAULT_SCHEME;
  state.bag.palette = paletteForScheme(state.bag.scheme);
  const lt = $("lightMode"); if (lt) lt.checked = !!bag?.[UI_LIGHT_KEY];
  buildSchemeGrid();   // rebuild with the freshly-loaded custom schemes
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
  // fleet surface) — rebuild the picker so it always mirrors ~/.zwire/global.toml.
  if (changes[UI_SCHEMES_KEY]) {
    customSchemes = Array.isArray(changes[UI_SCHEMES_KEY].newValue) ? changes[UI_SCHEMES_KEY].newValue : [];
    buildSchemeGrid();
  }
  // The active scheme changed elsewhere (HUD, newtab, another zpwrchrome page) —
  // keep the picker highlight + preview in sync without a reload.
  if (changes[UI_SCHEME_KEY] && changes[UI_SCHEME_KEY].newValue) {
    state.bag.scheme = changes[UI_SCHEME_KEY].newValue;
    state.bag.palette = paletteForScheme(state.bag.scheme);
    markActiveScheme();
    updatePreview();
  }
});

buildSchemeGrid();

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
