// zpwrchrome — lights-off settings page.

import "../lib/page-nav.js";
import { DEFAULTS, clampOpacity } from "../lib/lights-off-css.js";

const STATE_KEY = "lights.off";
const $ = (id) => document.getElementById(id);

const state = {
  bag: { enabled: true, ...DEFAULTS },
};

function setStatus(msg, cls = "") {
  const el = $("status");
  if (!el) return;
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
  $("enabled").checked       = !!state.bag.enabled;
  $("toggle-label").textContent = state.bag.enabled ? "on" : "off";
  $("opacity").value         = String(clampOpacity(state.bag.opacity));
  $("opacity-val").textContent = Number(state.bag.opacity).toFixed(2);
  $("fadeMs").value          = String(state.bag.fadeMs);
  $("color").value           = state.bag.color || "#000000";
  $("autoOn").checked        = !!state.bag.autoOn;
  $("liftPlayer").checked    = state.bag.liftPlayer !== false;
  for (const r of document.querySelectorAll('input[name="mode"]')) {
    r.checked = r.value === (state.bag.mode || "all");
  }
  $("domains").value         = (state.bag.domains || []).join("\n");
  $("domains-lbl").textContent = state.bag.mode === "allowlist"
    ? "Allowlist (one host per line)"
    : "Blocklist (one host per line)";
  updatePreview();
}

let previewOn = false;
function updatePreview() {
  const ov = $("preview-overlay");
  if (!ov) return;
  ov.style.setProperty("--preview-opacity", String(clampOpacity(state.bag.opacity)));
  ov.style.backgroundColor = state.bag.color || "#000";
  ov.style.transitionDuration = `${Math.max(0, Math.min(60000, Number(state.bag.fadeMs) || 0))}ms`;
  if (previewOn) ov.classList.add("on"); else ov.classList.remove("on");
}

async function save() {
  await chrome.storage.local.set({ [STATE_KEY]: state.bag });
  setStatus("saved", "ok");
}

async function load() {
  const bag = await chrome.storage.local.get(STATE_KEY);
  if (bag?.[STATE_KEY]) state.bag = { enabled: true, ...DEFAULTS, ...bag[STATE_KEY] };
  render();
}

// ─── Wire up ────────────────────────────────────────────────────────
$("enabled").addEventListener("change", (ev) => {
  state.bag.enabled = !!ev.target.checked;
  render(); save();
});
$("opacity").addEventListener("input", (ev) => {
  state.bag.opacity = clampOpacity(ev.target.value);
  $("opacity-val").textContent = state.bag.opacity.toFixed(2);
  updatePreview();
});
$("opacity").addEventListener("change", () => save());
$("fadeMs").addEventListener("change", (ev) => {
  state.bag.fadeMs = Math.max(0, Math.min(60000, Number(ev.target.value) || 0));
  updatePreview(); save();
});
$("color").addEventListener("change", (ev) => {
  state.bag.color = ev.target.value || "#000000";
  updatePreview(); save();
});
$("autoOn").addEventListener("change", (ev) => {
  state.bag.autoOn = !!ev.target.checked; save();
});
$("liftPlayer").addEventListener("change", (ev) => {
  state.bag.liftPlayer = !!ev.target.checked; save();
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
$("domains").addEventListener("change", (ev) => {
  state.bag.domains = parseDomains(ev.target.value); save();
});
$("preview-toggle").addEventListener("click", () => {
  previewOn = !previewOn;
  updatePreview();
});
$("preview-overlay").addEventListener("click", () => {
  previewOn = false;
  updatePreview();
});

load();
