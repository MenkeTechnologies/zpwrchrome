// zpwrchrome — find-in-all-tabs controller.
//
// On load: scan every open http(s) tab's innerText via the SW
// (`find.scanAllTabs`). As the user types, filter the scanned tabs by
// case-insensitive substring (with extractSnippet showing 80 chars of
// context around the first match per tab). Enter on a result triggers
// `find.scrollToMatch` which activates the tab and runs window.find()
// on the page so the match scrolls into view + gets highlighted.

import "../lib/page-nav.js";
import { extractSnippet, countOccurrences } from "../lib/find-snippet.js";

const $    = (id) => document.getElementById(id);
const $q   = $("q");
const $st  = $("status");
const $lst = $("list");
const $ct  = $("counts");

const state = {
  tabs:    [],     // [{ tabId, windowId, title, url, host, text, bytes, active }]
  filter:  "",
  rows:    [],     // current filtered rows: [{ tab, snippet, hits, score }]
  rowIdx:  0,
  scanning: true,
};

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function setStatus(text, cls = "") {
  $st.textContent = text;
  $st.className = "status" + (cls ? ` ${cls}` : "");
}

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

async function scanAllTabs() {
  setStatus("scanning…");
  try {
    const resp = await send({ kind: "find.scanAllTabs" });
    state.tabs = resp.tabs || [];
    state.scanning = false;
    const totalBytes = state.tabs.reduce((s, t) => s + (t.bytes || 0), 0);
    setStatus(`${state.tabs.length} tabs · ${(totalBytes / 1024).toFixed(1)} KB indexed`, "ok");
  } catch (e) {
    state.scanning = false;
    setStatus(`scan failed: ${e.message}`, "err");
  }
  render();
}

function renderEmpty(msg) {
  $lst.innerHTML = `<div class="empty">${escapeHtml(msg)}</div>`;
}

function render() {
  const q = state.filter.trim();
  if (!q) {
    state.rows = [];
    renderEmpty(state.scanning ? "scanning all tabs…" : `type a query to search ${state.tabs.length} tabs`);
    $ct.textContent = state.scanning ? "—" : `${state.tabs.length} tabs indexed`;
    return;
  }
  // Build filtered rows with snippets + hit counts.
  const rows = [];
  for (const tab of state.tabs) {
    const snip = extractSnippet(tab.text || "", q);
    if (!snip) continue;
    const hits = countOccurrences(tab.text || "", q);
    rows.push({ tab, snip, hits });
  }
  // Sort: active tab last (so cross-tab hits surface first), then by hit
  // count desc, then by title asc.
  rows.sort((a, b) => {
    if (a.tab.active !== b.tab.active) return a.tab.active ? 1 : -1;
    if (a.hits !== b.hits)             return b.hits - a.hits;
    return (a.tab.title || a.tab.url).localeCompare(b.tab.title || b.tab.url);
  });
  state.rows = rows;
  if (!rows.length) {
    renderEmpty(`no matches for "${q}" across ${state.tabs.length} tabs`);
    $ct.textContent = `0 / ${state.tabs.length}`;
    return;
  }
  if (state.rowIdx >= rows.length) state.rowIdx = rows.length - 1;
  if (state.rowIdx < 0)            state.rowIdx = 0;
  $lst.innerHTML = rows.map((row, i) => renderRow(row, i)).join("");
  $ct.textContent = `${rows.length} / ${state.tabs.length} tabs`;
  wireRows();
  const sel = $lst.querySelector(".row.sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}

function renderRow(row, i) {
  const { tab, snip, hits } = row;
  const host = hostOf(tab.url);
  const fav  = tab.favIconUrl
    ? `<img class="favicon" src="${escapeHtml(tab.favIconUrl)}" alt="">`
    : `<span class="favicon">📄</span>`;
  // Highlight the hit within the snippet.
  const before = escapeHtml(snip.snippet.slice(0, snip.hitStart));
  const hit    = escapeHtml(snip.snippet.slice(snip.hitStart, snip.hitEnd));
  const after  = escapeHtml(snip.snippet.slice(snip.hitEnd));
  const leftElide  = snip.leftElide  ? "…" : "";
  const rightElide = snip.rightElide ? "…" : "";
  const activeCls  = tab.active ? " active-tab" : "";
  const badge = hits > 1
    ? `<span class="badge">${hits}</span>`
    : `<span class="badge muted">1</span>`;
  return `
    <div class="row${i === state.rowIdx ? " sel" : ""}${activeCls}"
         data-idx="${i}" data-tab-id="${tab.tabId}">
      ${fav}
      <div class="title-col">
        <span class="name">${escapeHtml(tab.title || tab.url)}</span>
        <span class="snippet"><span class="host">${escapeHtml(host)} ·</span>${leftElide}${before}<mark>${hit}</mark>${after}${rightElide}</span>
      </div>
      ${badge}
    </div>
  `;
}

function wireRows() {
  $lst.querySelectorAll(".row").forEach((el) => {
    el.addEventListener("mouseenter", () => {
      state.rowIdx = Number(el.dataset.idx);
      $lst.querySelectorAll(".row.sel").forEach((r) => r.classList.remove("sel"));
      el.classList.add("sel");
    });
    el.addEventListener("click", () => {
      state.rowIdx = Number(el.dataset.idx);
      activateSelected();
    });
  });
}

async function activateSelected() {
  const row = state.rows[state.rowIdx];
  if (!row) return;
  await send({ kind: "find.scrollToMatch", tabId: row.tab.tabId, query: state.filter.trim() });
  // Leave this tab open so the user can keep searching.
}

$q.addEventListener("input", (ev) => {
  state.filter = ev.target.value || "";
  state.rowIdx = 0;
  render();
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    if (state.filter) { $q.value = ""; state.filter = ""; state.rowIdx = 0; render(); }
    ev.preventDefault();
    return;
  }
  if (ev.key === "ArrowDown") {
    if (state.rowIdx + 1 < state.rows.length) { state.rowIdx++; render(); }
    ev.preventDefault();
    return;
  }
  if (ev.key === "ArrowUp") {
    if (state.rowIdx > 0) { state.rowIdx--; render(); }
    ev.preventDefault();
    return;
  }
  if (ev.key === "Enter") {
    activateSelected();
    ev.preventDefault();
    return;
  }
});

scanAllTabs();
