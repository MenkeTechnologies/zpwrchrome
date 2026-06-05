// zpwrchrome — cyberpunk theme injector settings page.

import "../lib/page-nav.js";
import { buildThemeCss } from "../lib/cyber-theme-css.js";

const STATE_KEY = "theme.injector";
const $ = (id) => document.getElementById(id);

const state = {
  bag: {
    enabled:   false,
    mode:      "all",
    domains:   [],
    intensity: "medium",
    forceMono: false,
    scanlines: false,
    darkMode:  false,
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

function render() {
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
  const bag = await chrome.storage.local.get(STATE_KEY);
  if (bag?.[STATE_KEY]) state.bag = { ...state.bag, ...bag[STATE_KEY] };
  render();
}

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
