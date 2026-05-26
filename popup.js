// zpwrchrome — popup. Mirrors modal/content.js but runs in extension
// context, so we can use chrome.* directly without WAR + relative font URLs.

import { fzfMatch, highlightWithIndices } from "./lib/fzf.js";

const $q    = document.querySelector(".search");
const $cats = document.getElementById("cats");
const $list = document.getElementById("list");

const CATEGORIES = [
  { id: "all",     label: "All Tabs",          key: "⌘1" },
  { id: "current", label: "Current Window",    key: "⌘2" },
  { id: "pinned",  label: "Pinned",            key: "⌘3" },
  { id: "audible", label: "Audible",           key: "⌘4" },
  { id: "muted",   label: "Muted",             key: "⌘5" },
  { id: "closed",  label: "Recently Closed",   key: "⌘6" }
];

const state = {
  catIdx: 0,
  rowIdx: 0,
  filter: "",
  mru: [],
  closed: [],
  currentWindowId: null,
  // JetBrains-style: on first render, select the row right after the
  // active tab so a single Enter switches back to the previous tab.
  firstRender: true
};

function host(u) { try { return new URL(u).hostname; } catch { return ""; } }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function renderCats() {
  $cats.innerHTML = CATEGORIES.map((c, i) => `
    <div class="cat${i === state.catIdx ? " sel" : ""}" data-idx="${i}">
      <span>${c.label}</span><span class="key">${c.key}</span>
    </div>
  `).join("");
  $cats.querySelectorAll(".cat").forEach((el) => {
    el.addEventListener("click", () => {
      state.catIdx = Number(el.dataset.idx);
      state.rowIdx = 0;
      render();
    });
  });
}

function currentList() {
  const cat = CATEGORIES[state.catIdx];

  let items;
  if (cat.id === "closed") {
    items = state.closed.map((s) => {
      const t = s.tab || s.window?.tabs?.[0];
      return t && { ...t, kind: "closed", sessionId: s.tab?.sessionId || s.window?.sessionId };
    }).filter(Boolean);
  } else {
    items = state.mru.map((t) => ({ ...t, kind: "open" }));
    if      (cat.id === "current") items = items.filter((t) => t.windowId === state.currentWindowId);
    else if (cat.id === "pinned")  items = items.filter((t) => t.pinned);
    else if (cat.id === "audible") items = items.filter((t) => t.audible);
    else if (cat.id === "muted")   items = items.filter((t) => t.mutedInfo?.muted);
  }

  if (!state.filter) return items;

  // fzf score against title and host; keep the better one. Sort desc.
  const scored = [];
  for (const t of items) {
    const titleText = t.title || t.url || "";
    const hostText  = host(t.url || "");
    const tm = fzfMatch(state.filter, titleText);
    const hm = fzfMatch(state.filter, hostText);
    if (!tm && !hm) continue;
    scored.push({
      ...t,
      _score:   Math.max(tm?.score ?? -Infinity, hm?.score ?? -Infinity),
      _titleHl: tm?.indices || [],
      _hostHl:  hm?.indices || []
    });
  }
  scored.sort((a, b) => b._score - a._score);
  return scored;
}

function renderList() {
  const items = currentList();
  if (!items.length) {
    $list.innerHTML = `<div class="empty">no matches</div>`;
    return;
  }
  if (state.rowIdx >= items.length) state.rowIdx = items.length - 1;
  if (state.rowIdx < 0) state.rowIdx = 0;

  $list.innerHTML = items.map((t, i) => {
    const h = host(t.url || "");
    const titleText = t.title || t.url || "(untitled)";
    const titleHtml = t._titleHl?.length ? highlightWithIndices(titleText, t._titleHl, escapeHtml) : escapeHtml(titleText);
    const hostHtml  = t._hostHl?.length  ? highlightWithIndices(h,         t._hostHl,  escapeHtml) : escapeHtml(h);
    const badges = [];
    if (t.pinned)            badges.push(`<span class="badge pinned">pin</span>`);
    if (t.audible)           badges.push(`<span class="badge audible">audio</span>`);
    if (t.mutedInfo?.muted)  badges.push(`<span class="badge muted">muted</span>`);
    const fav = t.favIconUrl ? `<img class="favicon" src="${escapeHtml(t.favIconUrl)}" referrerpolicy="no-referrer">` : `<span class="favicon"></span>`;
    return `
      <div class="row${i === state.rowIdx ? " sel" : ""}${t.active ? " active-tab" : ""}"
           data-idx="${i}" data-kind="${t.kind}"
           data-tab-id="${t.id ?? ""}"
           data-session-id="${t.sessionId ?? ""}">
        ${fav}
        <div class="title-col">
          <span class="name">${titleHtml}</span>
          <span class="path">${hostHtml}</span>
        </div>
        <div class="badges">${badges.join("")}</div>
      </div>
    `;
  }).join("");

  $list.querySelectorAll(".row img.favicon").forEach((img) => {
    img.addEventListener("error", () => { img.style.visibility = "hidden"; });
  });
  $list.querySelectorAll(".row").forEach((el) => {
    el.addEventListener("click", () => activate(Number(el.dataset.idx)));
    el.addEventListener("mouseenter", () => {
      state.rowIdx = Number(el.dataset.idx);
      $list.querySelectorAll(".row").forEach((r) =>
        r.classList.toggle("sel", Number(r.dataset.idx) === state.rowIdx));
    });
  });
  const sel = $list.querySelector(".row.sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}

function render() {
  renderCats();
  renderList();
}

function activate(idx) {
  const items = currentList();
  const t = items[idx];
  if (!t) return;
  if (t.kind === "closed") {
    chrome.runtime.sendMessage({ kind: "restore", sessionId: t.sessionId }, () => window.close());
  } else {
    chrome.runtime.sendMessage({ kind: "activate", tabId: t.id }, () => window.close());
  }
}

function cycle(delta) {
  const items = currentList();
  if (!items.length) return;
  state.rowIdx = (state.rowIdx + delta + items.length) % items.length;
  renderList();
}

function refresh() {
  chrome.runtime.sendMessage({ kind: "list" }, (data) => {
    if (!data) return;
    state.mru = data.mru || [];
    state.closed = data.closed || [];
    state.currentWindowId = state.mru.find((t) => t.active)?.windowId
                          ?? state.mru[0]?.windowId
                          ?? null;
    if (state.firstRender) {
      const items = currentList();
      const i = items.findIndex((t) => t.active);
      state.rowIdx = i >= 0 && i + 1 < items.length ? i + 1 : 0;
      state.firstRender = false;
    }
    render();
  });
}

$q.addEventListener("input", (e) => {
  state.filter = e.target.value;
  state.rowIdx = 0;
  renderList();
});

document.addEventListener("keydown", (e) => {
  // Cmd/Ctrl+1..6 → category jump.
  if ((e.metaKey || e.ctrlKey) && /^[1-6]$/.test(e.key)) {
    e.preventDefault();
    state.catIdx = parseInt(e.key, 10) - 1;
    state.rowIdx = 0;
    render();
    return;
  }
  if (e.key === "ArrowDown")  { e.preventDefault(); cycle(+1); return; }
  if (e.key === "ArrowUp")    { e.preventDefault(); cycle(-1); return; }
  if (e.key === "Enter")      { e.preventDefault(); activate(state.rowIdx); return; }
  if (e.key === "Delete" || e.key === "Backspace") {
    // Plain Backspace closes the highlighted tab — unless the search input
    // is focused and non-empty (then it deletes a char as expected).
    if (e.key === "Backspace" && document.activeElement === $q && $q.value) {
      return;
    }
    const items = currentList();
    const t = items[state.rowIdx];
    if (t?.kind === "open") {
      e.preventDefault();
      chrome.runtime.sendMessage({ kind: "close-tab", tabId: t.id }, refresh);
    }
    return;
  }
  if (e.key === "Escape") {
    if ($q.value) { $q.value = ""; state.filter = ""; state.rowIdx = 0; renderList(); }
    else window.close();
  }
});

// Dashboard link in the header
document.getElementById("open-scripts").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("scripts-manager/manager.html") });
  window.close();
});

refresh();
