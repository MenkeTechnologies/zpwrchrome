// zpwrchrome — cyberpunk theme injector settings page.

import "../lib/page-nav.js";
import { buildThemeCss } from "../lib/cyber-theme-css.js";
import { COLOR_SCHEMES, SCHEME_IDS, DEFAULT_SCHEME, themeFor } from "../lib/color-schemes.js";
import { UI_SCHEME_KEY } from "../lib/ui-scheme.js";

const STATE_KEY = "theme.injector";
const $ = (id) => document.getElementById(id);

// The scheme dots shown on each picker button (the visually load-bearing tokens).
const DOT_VARS = ["--accent", "--cyan", "--magenta", "--green", "--yellow", "--orange"];

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

// Build the 8-button scheme picker once; clicking writes both the UI-scheme
// key (recolors zpwrchrome's own pages) and the page-recolor palette.
function buildSchemeGrid() {
  const grid = $("scheme-grid");
  grid.textContent = "";
  for (const id of SCHEME_IDS) {
    const s = COLOR_SCHEMES[id];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "scheme-btn";
    btn.dataset.scheme = id;

    const name = document.createElement("div");
    name.className = "scheme-name";
    name.textContent = s.label;

    const desc = document.createElement("div");
    desc.className = "scheme-desc";
    desc.textContent = s.desc;

    const dots = document.createElement("div");
    dots.className = "scheme-dots";
    for (const v of DOT_VARS) {
      const d = document.createElement("span");
      d.className = "scheme-dot";
      d.style.background = s.vars[v] || "#888";
      dots.appendChild(d);
    }

    btn.append(name, desc, dots);
    btn.addEventListener("click", () => selectScheme(id));
    grid.appendChild(btn);
  }
}

function markActiveScheme() {
  for (const btn of $("scheme-grid").querySelectorAll(".scheme-btn")) {
    btn.classList.toggle("active", btn.dataset.scheme === state.bag.scheme);
  }
}

async function selectScheme(id) {
  state.bag.scheme = id;
  state.bag.palette = themeFor(id);
  markActiveScheme();
  updatePreview();
  // One write drives both surfaces: ui.scheme for zpwrchrome's own pages,
  // theme.injector (with palette) for the page-recolor content script.
  await chrome.storage.local.set({ [STATE_KEY]: state.bag, [UI_SCHEME_KEY]: id });
  setStatus("scheme: " + (COLOR_SCHEMES[id]?.label || id), "ok");
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
  const bag = await chrome.storage.local.get([STATE_KEY, UI_SCHEME_KEY]);
  if (bag?.[STATE_KEY]) state.bag = { ...state.bag, ...bag[STATE_KEY] };
  // ui.scheme is the source of truth for the chosen scheme; recompute the
  // palette from the id so a vendored-color change can never serve stale hex.
  state.bag.scheme = bag?.[UI_SCHEME_KEY] || state.bag.scheme || DEFAULT_SCHEME;
  state.bag.palette = themeFor(state.bag.scheme);
  render();
}

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
