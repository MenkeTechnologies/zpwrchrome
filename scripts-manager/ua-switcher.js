// zpwrchrome — UA switcher controller.

import "../lib/page-nav.js";

const $ = (id) => document.getElementById(id);

const state = {
  state:    null,            // persisted bag from the SW
  presets:  [],
  groups:   [],
  resolved: null,
};

function send(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message || "runtime error"));
      if (!resp || resp.ok === false) return reject(new Error(resp?.err || "bridge error"));
      resolve(resp);
    });
  });
}

function setStatus(text, cls = "") {
  const el = $("status");
  el.textContent = text;
  el.className = cls || "dim";
  if (cls === "ok") setTimeout(() => { if (el.textContent === text) el.textContent = "—"; }, 1800);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderHeader() {
  const enabled = !!state.state?.enabled;
  $("enabled").checked = enabled;
  $("toggle-label").textContent = enabled ? "on" : "off";
  // Current panel
  if (!enabled) {
    $("cur-status").textContent = "off";
    $("cur-status").className = "val off";
    $("cur-mode").textContent  = "—";
    $("cur-mode").className     = "val off";
    $("cur-ua").textContent     = "(no override)";
    $("cur-ua").className       = "val ua off";
    return;
  }
  $("cur-status").textContent = "active";
  $("cur-status").className = "val";
  $("cur-mode").textContent  = state.state.mode === "custom"
    ? "custom"
    : `preset · ${state.state.presetId || "?"}`;
  $("cur-mode").className = "val";
  $("cur-ua").textContent = state.resolved || "(empty)";
  $("cur-ua").className   = "val ua";
}

function renderPresets() {
  const out = [];
  for (const group of state.groups) {
    const items = state.presets.filter((p) => p.group === group);
    if (!items.length) continue;
    out.push(`<div class="group"><h3>${escapeHtml(group)}</h3>`);
    for (const p of items) {
      const active = state.state?.enabled
                  && state.state?.mode !== "custom"
                  && state.state?.presetId === p.id;
      out.push(`
        <div class="preset${active ? " active" : ""}" data-id="${escapeHtml(p.id)}">
          <span class="label">${escapeHtml(p.label)}</span>
          <span class="ua" title="${escapeHtml(p.ua)}">${escapeHtml(p.ua)}</span>
          <span class="pick">${active ? "● active" : "click to use"}</span>
        </div>
      `);
    }
    out.push("</div>");
  }
  $("presets").innerHTML = out.join("");
  $("presets").querySelectorAll(".preset").forEach((el) => {
    el.addEventListener("click", () => pickPreset(el.dataset.id));
  });
}

function renderCustom() {
  $("custom").value = state.state?.customUA || "";
}

function render() {
  renderHeader();
  renderPresets();
  renderCustom();
}

// ─── Actions ────────────────────────────────────────────────────────
async function refresh() {
  const r = await send({ kind: "ua.get" });
  state.state    = r.state;
  state.presets  = r.presets || [];
  state.groups   = r.groups  || [];
  state.resolved = r.resolved;
  render();
}

async function setEnabled(v) {
  try {
    const r = await send({ kind: "ua.set", patch: { enabled: !!v } });
    state.state    = r.state;
    state.resolved = r.resolved;
    render();
    setStatus(v ? "enabled" : "disabled", "ok");
  } catch (e) {
    setStatus(e.message, "err");
  }
}

async function pickPreset(id) {
  try {
    const r = await send({ kind: "ua.set", patch: { enabled: true, mode: "preset", presetId: id } });
    state.state    = r.state;
    state.resolved = r.resolved;
    render();
    setStatus(`spoofing as ${id}`, "ok");
  } catch (e) {
    setStatus(e.message, "err");
  }
}

async function useCustom() {
  const ua = $("custom").value.trim();
  if (!ua) { setStatus("custom UA is empty", "err"); return; }
  try {
    const r = await send({ kind: "ua.set", patch: { enabled: true, mode: "custom", customUA: ua } });
    state.state    = r.state;
    state.resolved = r.resolved;
    render();
    setStatus("custom UA applied", "ok");
  } catch (e) {
    setStatus(e.message, "err");
  }
}

async function clearOverride() {
  try {
    const r = await send({ kind: "ua.clear" });
    state.state    = r.state;
    state.resolved = null;
    render();
    setStatus("override cleared", "ok");
  } catch (e) {
    setStatus(e.message, "err");
  }
}

// ─── Wire up ────────────────────────────────────────────────────────
$("enabled").addEventListener("change", (ev) => setEnabled(ev.target.checked));
$("b-custom").addEventListener("click", useCustom);
$("b-clear").addEventListener("click",  clearOverride);

refresh();
