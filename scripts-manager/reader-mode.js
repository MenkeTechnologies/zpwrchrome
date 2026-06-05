// zpwrchrome — reader-mode settings page with live preview.

import "../lib/page-nav.js";
import { DEFAULTS, buildReaderCss, clampFontSize, clampLineWidth, clampLineHeight } from "../lib/reader-mode-css.js";

const STATE_KEY = "reader.mode";
const $ = (id) => document.getElementById(id);

const state = { bag: { ...DEFAULTS } };

function setStatus(msg, cls = "") {
  const el = $("status");
  if (!el) return;
  el.textContent = msg;
  el.className = cls ? `status ${cls}` : "dim";
  if (cls === "ok") setTimeout(() => { if (el.textContent === msg) el.textContent = "—"; }, 1500);
}

function render() {
  for (const r of document.querySelectorAll('input[name="theme"]')) r.checked = r.value === state.bag.theme;
  for (const r of document.querySelectorAll('input[name="font"]'))  r.checked = r.value === state.bag.font;
  $("fontSize").value      = String(clampFontSize(state.bag.fontSize));
  $("fontSize-val").textContent  = String(clampFontSize(state.bag.fontSize));
  $("lineWidth").value     = String(clampLineWidth(state.bag.lineWidth));
  $("lineWidth-val").textContent = String(clampLineWidth(state.bag.lineWidth));
  $("lineHeight").value    = String(clampLineHeight(state.bag.lineHeight));
  $("lineHeight-val").textContent= clampLineHeight(state.bag.lineHeight).toFixed(2);
  $("scanlines").checked   = !!state.bag.scanlines;
  updatePreview();
}

function updatePreview() {
  // Scope the reader CSS to #preview-stage so it doesn't restyle the
  // surrounding settings UI. Replace every selector that starts with
  // `#zpwr-reader-mode` with `#preview-stage #zpwr-reader-mode` (no-op
  // when it already matches our scoped preview, but defensive against
  // any future buildReaderCss changes).
  const css = buildReaderCss(state.bag)
    .replace(/(\#zpwr-reader-mode)/g, "#preview-stage $1");
  $("zpwr-reader-mode-style").textContent = css;
}

async function save() {
  await chrome.storage.local.set({ [STATE_KEY]: state.bag });
  setStatus("saved", "ok");
}

async function load() {
  const bag = await chrome.storage.local.get(STATE_KEY);
  if (bag?.[STATE_KEY]) state.bag = { ...DEFAULTS, ...bag[STATE_KEY] };
  render();
}

// ─── Wire up ────────────────────────────────────────────────────────
document.querySelectorAll('input[name="theme"]').forEach((r) => {
  r.addEventListener("change", () => {
    if (!r.checked) return;
    state.bag.theme = r.value;
    updatePreview(); save();
  });
});
document.querySelectorAll('input[name="font"]').forEach((r) => {
  r.addEventListener("change", () => {
    if (!r.checked) return;
    state.bag.font = r.value;
    updatePreview(); save();
  });
});
$("fontSize").addEventListener("input", (ev) => {
  state.bag.fontSize = clampFontSize(ev.target.value);
  $("fontSize-val").textContent = String(state.bag.fontSize);
  updatePreview();
});
$("fontSize").addEventListener("change", () => save());
$("lineWidth").addEventListener("input", (ev) => {
  state.bag.lineWidth = clampLineWidth(ev.target.value);
  $("lineWidth-val").textContent = String(state.bag.lineWidth);
  updatePreview();
});
$("lineWidth").addEventListener("change", () => save());
$("lineHeight").addEventListener("input", (ev) => {
  state.bag.lineHeight = clampLineHeight(ev.target.value);
  $("lineHeight-val").textContent = state.bag.lineHeight.toFixed(2);
  updatePreview();
});
$("lineHeight").addEventListener("change", () => save());
$("scanlines").addEventListener("change", (ev) => {
  state.bag.scanlines = !!ev.target.checked;
  updatePreview(); save();
});

load();
