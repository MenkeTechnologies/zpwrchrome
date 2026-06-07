// zpwrchrome — diagnostics page. Reads the SW's diag ring buffer + can
// ping the native host to verify end-to-end transport.

import "../lib/page-nav.js";
import { fzfMatch, highlightWithIndices } from "../lib/fzf.js";
const $list    = document.getElementById("list");
const $filter  = document.getElementById("filter");
const $alive   = document.getElementById("alive");
const $count   = document.getElementById("count");
const $ping    = document.getElementById("ping");
const $refresh = document.getElementById("refresh");
const $clear   = document.getElementById("clear");

const state = { entries: [], filter: "" };

function classify(label) {
  if (/_err|_throw|failed|host_err|empty/.test(label))  return "bad";
  if (/skip|takeover|warn/.test(label))                 return "warn";
  return "ok";
}

function bodyText(entry) {
  const { ts: _ts, label: _label, ...rest } = entry;
  return Object.entries(rest).map(([k, v]) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return `${k}=${s}`;
  }).join(" ");
}

function fmt(entry, q) {
  const { ts, label } = entry;
  const lvl = classify(label);
  const body = bodyText(entry);
  return `<div class="diag-row lvl-${lvl}">
    <span class="ts">${escapeHtml(ts || "")}</span>
    <span class="label">${fzfHl(label || "", q)}</span>
    <span class="body">${fzfHl(body, q)}</span>
  </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

function fzfHl(text, query) {
  const t = String(text ?? "");
  if (!query) return escapeHtml(t);
  const m = fzfMatch(query, t);
  return m ? highlightWithIndices(t, m.indices, escapeHtml) : escapeHtml(t);
}

function render() {
  const f = state.filter.trim();
  let entries = state.entries;
  if (f) {
    entries = entries.filter((e) => !!fzfMatch(f, e.label || "") || !!fzfMatch(f, bodyText(e)));
  }
  entries = entries.slice().reverse();   // newest first
  $list.innerHTML = entries.length
    ? entries.map((e) => fmt(e, f)).join("")
    : `<div class="diag-row"><span class="ts"></span><span class="label">empty</span><span class="body">no diagnostic entries yet — try a download or click "Ping host"</span></div>`;
  $count.textContent = `${entries.length} line${entries.length === 1 ? "" : "s"}`;
}

async function refresh() {
  const r = await chrome.runtime.sendMessage({ kind: "diag.read" });
  state.entries = r?.entries || [];
  render();
}

async function ping() {
  $alive.className = "pill warn";
  $alive.textContent = "pinging…";
  const r = await chrome.runtime.sendMessage({ kind: "diag.ping", from: "dl-diag" });
  if (r?.ok && r.alive) {
    $alive.className = "pill ok";
    $alive.textContent = "host alive";
  } else {
    $alive.className = "pill bad";
    $alive.textContent = `host: ${r?.err || "no response"}`;
  }
  await refresh();
}

$filter.addEventListener("input", () => { state.filter = $filter.value; render(); });
$refresh.addEventListener("click", refresh);
$ping.addEventListener("click", ping);
$clear.addEventListener("click", async () => {
  if (!confirm("Clear the SW diagnostic log?")) return;
  await chrome.runtime.sendMessage({ kind: "diag.clear" });
  state.entries = [];
  render();
});

// Auto-refresh every 2s so live actions appear.
setInterval(refresh, 2000);
refresh();
ping();
