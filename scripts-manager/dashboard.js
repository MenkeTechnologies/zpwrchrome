// zpwrchrome — dashboard hub.
//
// A prepopulated, categorized, searchable grid of every zpwrchrome tool, settings page and info
// screen, rendered as clickable tiles. Launcher pattern ported from Audio-Haxor's dashboard.js
// (itself from traderview's launcher.js) and zreq's tile grid: filter box, per-category grid,
// drag-to-reorder with persisted order, keyboard navigation. Restyled onto the zpwrchrome HUD.
//
// Each tile is an <a href> to another scripts-manager page, so plain click navigates this tab and
// ⌘/Ctrl/middle-click opens it in a new tab via the browser's native anchor handling.

"use strict";

// ---------------------------------------------------------------- catalog
// id           : stable key used for drag-order persistence + tile identity
// page         : scripts-manager/*.html target
// badge/hot    : optional corner tag
const SECTIONS = [
  {
    cat: "tools",
    label: "Tools",
    tiles: [
      { id: "downloads",   page: "downloads.html",      glyph: "📥", label: "Download Manager",   desc: "Segmented, resumable downloads that take over Chrome's default — queue, categories, trash.", badge: "core" },
      { id: "scripts",     page: "manager.html",         glyph: "📜", label: "Userscripts",         desc: "Tampermonkey-equivalent engine: install, edit and run @match userscripts with the GM.* API." },
      { id: "pass",        page: "pass.html",             glyph: "🔑", label: "Pass",                desc: "browserpass-compatible UNIX pass integration — browse, edit and autofill your store." },
      { id: "find",        page: "find-all.html",         glyph: "🔍", label: "Find in All Tabs",     desc: "Full-text fuzzy search across every open tab, then jump straight to the match." },
      { id: "reader",      page: "reader-mode.html",      glyph: "📖", label: "Reader Mode",          desc: "Strip a page to its article and read it in a strykelang HUD overlay with tunable typography." },
      { id: "lights",      page: "lights-off.html",       glyph: "🌙", label: "Lights Off",           desc: "Cinema dimmer — near-black overlay behind the video for distraction-free viewing." },
      { id: "theme",       page: "theme-injector.html",   glyph: "🎨", label: "Cyberpunk Theme",      desc: "Inject the neon page-theme onto any site — per-host on/off and intensity." },
      { id: "modheader",   page: "modheader.html",        glyph: "🧬", label: "ModHeader",            desc: "ModHeader-style request/response header rules with per-profile enable." },
      { id: "ua",          page: "ua-switcher.html",      glyph: "🕵", label: "User-Agent Switcher",  desc: "Spoof the User-Agent per host from a curated preset list, or roll your own." },
    ],
  },
  {
    cat: "downloads",
    label: "Download Manager Settings",
    tiles: [
      { id: "dl-settings",  page: "dl-settings.html",     glyph: "⚙",  label: "Settings",             desc: "Concurrency, segments, default folder, takeover behavior and every core preference." },
      { id: "dl-rules",     page: "dl-rules.html",         glyph: "⚖",  label: "Rule System",          desc: "Route downloads by URL / type / referrer into folders and apply per-match options." },
      { id: "dl-extfilter", page: "dl-extfilter.html",     glyph: "🧯", label: "Extension Filter",     desc: "Whitelist / blacklist which file extensions zpwrchrome captures vs. leaves to Chrome." },
      { id: "dl-post",      page: "dl-postcommands.html",  glyph: "⌨",  label: "Post-Download Commands", desc: "Run a shell command after a file finishes — unzip, notify, move, transcode." },
      { id: "dl-interface", page: "dl-interface.html",     glyph: "🖥", label: "Interface",            desc: "Tune the download UI — columns, details drawer, strip and popup behavior." },
    ],
  },
  {
    cat: "info",
    label: "Diagnostics & Help",
    tiles: [
      { id: "dl-diag",  page: "dl-diag.html",  glyph: "⚠",  label: "Diagnostics",  desc: "Service-worker + native-host log, connection state and error trail." },
      { id: "dl-help",  page: "dl-help.html",  glyph: "❔", label: "Help",          desc: "How the downloader, native host and takeover work — setup and troubleshooting." },
      { id: "dl-about", page: "dl-about.html", glyph: "ℹ",  label: "About",         desc: "Version, credits, license and links for zpwrchrome." },
    ],
  },
];

const ORDER_KEY = "zpc.dash.order.";   // + cat  → JSON array of tile ids
const esc = (s) => { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; };
const $grid = document.getElementById("grid");
const $search = document.getElementById("search");
const $count = document.getElementById("count");

let query = "";

// ---------------------------------------------------------------- persisted per-category order
function orderedTiles(sec) {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(ORDER_KEY + sec.cat) || "[]"); } catch { saved = []; }
  const byId = new Map(sec.tiles.map((t) => [t.id, t]));
  const out = [];
  for (const id of saved) { if (byId.has(id)) { out.push(byId.get(id)); byId.delete(id); } }
  for (const t of sec.tiles) { if (byId.has(t.id)) out.push(t); }  // new/unsaved tiles keep catalog order at the end
  return out;
}
function saveOrder(cat, ids) {
  try { localStorage.setItem(ORDER_KEY + cat, JSON.stringify(ids)); } catch { /* private mode */ }
}

// ---------------------------------------------------------------- render
function matches(tile, q) {
  if (!q) return true;
  return `${tile.label} ${tile.desc} ${tile.id}`.toLowerCase().includes(q);
}

function tileHTML(t) {
  const badge = t.badge
    ? `<span class="tile-badge${t.hot ? " hot" : ""}">${esc(t.badge)}</span>`
    : "";
  return `<a class="tile" href="${esc(t.page)}" data-id="${esc(t.id)}" draggable="true" title="${esc(t.desc)}">
      ${badge}
      <span class="tile-glyph">${t.glyph}</span>
      <span class="tile-body">
        <span class="tile-label">${esc(t.label)}</span>
        <span class="tile-desc">${esc(t.desc)}</span>
      </span>
    </a>`;
}

function render() {
  const q = query;
  let shown = 0, total = 0;
  let html = "";
  for (const sec of SECTIONS) {
    const tiles = orderedTiles(sec);
    total += tiles.length;
    const vis = tiles.filter((t) => matches(t, q));
    shown += vis.length;
    if (!vis.length) continue;
    html += `<section class="cat" data-cat="${esc(sec.cat)}">
        <h2 class="cat-head">${esc(sec.label)} <span class="cat-n">${vis.length}</span></h2>
        <div class="tiles" data-cat="${esc(sec.cat)}">${vis.map(tileHTML).join("")}</div>
      </section>`;
  }
  $grid.innerHTML = html || `<div class="empty">nothing matches “${esc(q)}”.</div>`;
  $count.textContent = q ? `${shown} of ${total}` : `${total} tiles`;

  // Drag-reorder is only wired when unfiltered, so a saved order is never computed from a partial list.
  if (!q) {
    $grid.querySelectorAll(".tiles[data-cat]").forEach(wireDrag);
  }
}

// ---------------------------------------------------------------- drag reorder (HTML5, self-contained)
function wireDrag(container) {
  let dragEl = null;

  container.addEventListener("dragstart", (e) => {
    const t = e.target.closest(".tile");
    if (!t) return;
    dragEl = t;
    t.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", t.dataset.id); } catch { /* firefox needs data set */ }
  });

  container.addEventListener("dragend", () => {
    if (dragEl) dragEl.classList.remove("dragging");
    container.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
    dragEl = null;
  });

  container.addEventListener("dragover", (e) => {
    if (!dragEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const over = e.target.closest(".tile");
    container.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
    if (!over || over === dragEl) return;
    over.classList.add("drop-target");
    const box = over.getBoundingClientRect();
    const after = (e.clientY - box.top) > box.height / 2 || (e.clientX - box.left) > box.width / 2;
    container.insertBefore(dragEl, after ? over.nextSibling : over);
  });

  container.addEventListener("drop", (e) => {
    e.preventDefault();
    container.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
    const ids = [...container.querySelectorAll(".tile")].map((el) => el.dataset.id);
    saveOrder(container.dataset.cat, ids);
  });
}

// ---------------------------------------------------------------- keyboard nav
function tilesInDom() { return [...$grid.querySelectorAll(".tile")]; }

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== $search) {
    e.preventDefault(); $search.focus(); $search.select(); return;
  }
  if (e.key === "Escape") {
    if (query) { query = ""; $search.value = ""; render(); }
    else $search.blur();
    return;
  }
  const focused = document.activeElement;
  const isTile = focused && focused.classList && focused.classList.contains("tile");
  if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
  if (focused === $search && e.key !== "ArrowDown") return;

  const tiles = tilesInDom();
  if (!tiles.length) return;
  e.preventDefault();

  if (!isTile) { tiles[0].focus(); return; }

  const cols = colCount(focused);
  const i = tiles.indexOf(focused);
  let n = i;
  if (e.key === "ArrowRight") n = i + 1;
  else if (e.key === "ArrowLeft") n = i - 1;
  else if (e.key === "ArrowDown") n = i + cols;
  else if (e.key === "ArrowUp") n = i - cols;
  if (n >= 0 && n < tiles.length) tiles[n].focus();
  else if (e.key === "ArrowUp" && i - cols < 0) $search.focus();
});

// Number of tiles per row in the focused tile's grid, for vertical arrow stepping.
function colCount(tile) {
  const row = tile.parentElement;
  if (!row) return 1;
  const style = getComputedStyle(row);
  const cols = style.gridTemplateColumns.split(" ").filter(Boolean).length;
  return Math.max(1, cols);
}

// ---------------------------------------------------------------- search
$search.addEventListener("input", () => { query = $search.value.trim().toLowerCase(); render(); });

// ---------------------------------------------------------------- live stats + version
try { document.getElementById("ver").textContent = "v" + chrome.runtime.getManifest().version; }
catch { document.getElementById("ver").textContent = "v?"; }

function countTiles() {
  return SECTIONS.reduce((n, s) => n + s.tiles.length, 0);
}
document.getElementById("stat-tools").textContent = String(countTiles());

function ask(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; resolve(r); });
    } catch { resolve(null); }
  });
}

(async () => {
  const s = await ask({ kind: "scripts.list" });
  const el = document.getElementById("stat-scripts");
  if (s && Array.isArray(s.scripts)) el.textContent = String(s.scripts.length);
})();

(async () => {
  const d = await ask({ kind: "dl.list" });
  const el = document.getElementById("stat-dl");
  if (d && d.ok && Array.isArray(d.jobs)) {
    const active = d.jobs.filter((j) => j.status === "active").length;
    el.textContent = active ? `${active}/${d.jobs.length}` : String(d.jobs.length);
  }
})();

// ---------------------------------------------------------------- go
render();
