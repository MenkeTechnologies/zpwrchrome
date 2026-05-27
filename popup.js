// zpwrchrome — popup. Mirrors modal/content.js but runs in extension
// context, so we can use chrome.* directly without WAR + relative font URLs.

import { fzfMatch, highlightWithIndices } from "./lib/fzf.js";
import { buildTabTree, flattenTree, domainHueFor } from "./lib/util.js";

const $q    = document.querySelector(".search");
const $cats = document.getElementById("cats");
const $list = document.getElementById("list");

const CATEGORIES = [
  { id: "all",     label: "All Tabs",          key: "⌘1" },
  { id: "current", label: "Current Window",    key: "⌘2" },
  { id: "pinned",  label: "Pinned",            key: "⌘3" },
  { id: "audible", label: "Audible",           key: "⌘4" },
  { id: "muted",   label: "Muted",             key: "⌘5" },
  { id: "closed",  label: "Recently Closed",   key: "⌘6" },
  { id: "scenes",  label: "Scenes",            key: "⌘7" },
  { id: "tree",    label: "Tree (by opener)",  key: "⌘8" },
  { id: "minimap", label: "Minimap",           key: "⌘9" },
  { id: "history", label: "History",           key: "⌘0" }
];

// Browsing-history fetch ceiling. chrome.history.search() with text:""
// returns up to maxResults entries ordered by lastVisitTime desc — chosen
// large enough that fzf has room to match obscure typed terms but bounded
// so the popup doesn't stall scoring 100k rows.
const HISTORY_MAX_RESULTS = 5000;

const state = {
  catIdx: 0,
  rowIdx: 0,
  filter: "",
  mru: [],
  closed: [],
  scenes: [],
  history: [],
  historyLoaded: false,
  currentWindowId: null,
  // JetBrains-style: on first render, select the row right after the
  // active tab so a single Enter switches back to the previous tab.
  firstRender: true,
  // Tree view: collapsed subtree ids kept in-memory per popup session.
  collapsedTreeIds: new Set(),
  // Processes: lazily fetched when the user enters a category that uses
  // them. { available, perTab: { tabId: { cpu, memoryBytes } } }.
  proc: { available: false, perTab: {} }
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
  } else if (cat.id === "scenes") {
    // Scenes have name+slug, not URL+title — bypass the fzf scorer and
    // use plain substring matching against the scene metadata.
    const f = state.filter.toLowerCase();
    return state.scenes
      .filter((s) => !f || s.name.toLowerCase().includes(f) || s.slug.includes(f))
      .map((s) => ({
        kind: "scene",
        slug: s.slug,
        name: s.name,
        title: s.name,
        url: `scene://${s.slug}`,
        tabCount: s.tabs?.length || 0,
        updated_at: s.updated_at,
      }));
  } else if (cat.id === "tree") {
    // Tree rows must preserve parent→child ordering — bypass fzf reshape.
    const f = state.filter.toLowerCase();
    const matchesLite = (t) => !f
      || (t.title || "").toLowerCase().includes(f)
      || (t.url   || "").toLowerCase().includes(f)
      || host(t.url || "").toLowerCase().includes(f);
    const { roots } = buildTabTree(state.mru);
    const flat = flattenTree(roots, state.collapsedTreeIds);
    return flat
      .filter((n) => matchesLite(n.tab))
      .map((n) => ({
        ...n.tab,
        kind: "tree",
        _depth: n.depth,
        _hasChildren: n.hasChildren,
        _collapsed: n.collapsed,
      }));
  } else if (cat.id === "history") {
    // Browsing history. Pre-scored against fzf — but chrome.history's own
    // text-match is cheaper for the no-filter case, so we leave the rows
    // raw when filter is empty (already lastVisitTime-desc).
    items = state.history.map((h) => ({
      kind: "history",
      url: h.url,
      title: h.title,
      lastVisitTime: h.lastVisitTime,
      visitCount: h.visitCount,
    }));
  } else if (cat.id === "minimap") {
    // Minimap doesn't render titles; filter still helps when user types.
    const f = state.filter.toLowerCase();
    const matchesLite = (t) => !f
      || (t.title || "").toLowerCase().includes(f)
      || (t.url   || "").toLowerCase().includes(f)
      || host(t.url || "").toLowerCase().includes(f);
    return state.mru
      .filter(matchesLite)
      .map((t) => ({ ...t, kind: "minimap" }));
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
  const cat = CATEGORIES[state.catIdx];
  const isScenes  = cat.id === "scenes";
  const isMinimap = cat.id === "minimap";
  const items = currentList();

  if (isMinimap) {
    renderMinimap(items);
    return;
  }

  const saveForm = isScenes ? `
    <div class="scene-save-form">
      <input class="scene-name" type="text" placeholder="name this scene (e.g. 'research', 'client-x')"
             maxlength="48" autocomplete="off">
      <button class="scene-save-btn">Save current window</button>
      <span class="scene-save-status muted small"></span>
    </div>
  ` : "";

  if (!items.length) {
    $list.innerHTML = saveForm + `<div class="empty">${isScenes ? "no scenes saved yet" : "no matches"}</div>`;
    if (isScenes) wireSceneForm();
    return;
  }
  if (state.rowIdx >= items.length) state.rowIdx = items.length - 1;
  if (state.rowIdx < 0) state.rowIdx = 0;

  $list.innerHTML = saveForm + items.map((t, i) => {
    if (t.kind === "scene") {
      const when = t.updated_at ? new Date(t.updated_at).toLocaleString() : "";
      return `
        <div class="row scene-row${i === state.rowIdx ? " sel" : ""}"
             data-idx="${i}" data-kind="scene" data-slug="${escapeHtml(t.slug)}">
          <span class="favicon scene-glyph">⌬</span>
          <div class="title-col">
            <span class="name">${escapeHtml(t.name)}</span>
            <span class="path">${t.tabCount} tab${t.tabCount === 1 ? "" : "s"} · ${escapeHtml(when)} · slug: ${escapeHtml(t.slug)}</span>
          </div>
          <div class="badges">
            <button class="badge scene-restore-btn" data-slug="${escapeHtml(t.slug)}">restore</button>
            <button class="badge scene-delete-btn"  data-slug="${escapeHtml(t.slug)}">delete</button>
          </div>
        </div>
      `;
    }
    const h = host(t.url || "");
    const titleText = t.title || t.url || "(untitled)";
    const titleHtml = t._titleHl?.length ? highlightWithIndices(titleText, t._titleHl, escapeHtml) : escapeHtml(titleText);
    const hostHtml  = t._hostHl?.length  ? highlightWithIndices(h,         t._hostHl,  escapeHtml) : escapeHtml(h);
    const badges = [];
    if (t.pinned)            badges.push(`<span class="badge pinned">pin</span>`);
    if (t.audible)           badges.push(`<span class="badge audible">audio</span>`);
    if (t.mutedInfo?.muted)  badges.push(`<span class="badge muted">muted</span>`);
    if (t.kind === "history" && t.lastVisitTime) {
      badges.push(`<span class="badge muted" title="${escapeHtml(new Date(t.lastVisitTime).toLocaleString())}">${escapeHtml(timeAgo(t.lastVisitTime))}</span>`);
    }
    const fav = t.favIconUrl ? `<img class="favicon" src="${escapeHtml(t.favIconUrl)}" referrerpolicy="no-referrer">` : `<span class="favicon"></span>`;
    const isTree = t.kind === "tree";
    const indent = isTree ? `style="padding-left:${8 + t._depth * 14}px;"` : "";
    const toggle = isTree && t._hasChildren
      ? `<button class="tree-toggle" data-tid="${t.id}" title="${t._collapsed ? "expand" : "collapse"} branch">${t._collapsed ? "▶" : "▼"}</button>`
      : (isTree ? `<span class="tree-toggle ghost"></span>` : "");
    const proc = state.proc.perTab[t.id];
    const procCol = state.proc.available
      ? `<span class="proc-col" title="memory · CPU %">${proc ? fmtMb(proc.memoryBytes) : "—"}<br><span class="muted">${proc ? proc.cpu.toFixed(1) + "%" : "—"}</span></span>`
      : "";
    return `
      <div class="row${i === state.rowIdx ? " sel" : ""}${t.active ? " active-tab" : ""}${isTree ? " tree-row" : ""}"
           data-idx="${i}" data-kind="${t.kind}"
           data-tab-id="${t.id ?? ""}"
           data-session-id="${t.sessionId ?? ""}"
           ${indent}>
        ${toggle}
        ${fav}
        <div class="title-col">
          <span class="name">${titleHtml}</span>
          <span class="path">${hostHtml}</span>
        </div>
        ${procCol}
        <div class="badges">${badges.join("")}</div>
      </div>
    `;
  }).join("");

  $list.querySelectorAll(".row img.favicon").forEach((img) => {
    img.addEventListener("error", () => { img.style.visibility = "hidden"; });
  });
  // mouseenter fires on scroll-induced position shifts too. Only honor it
  // when the user actually moved the mouse — otherwise scrollIntoView
  // clobbers keyboard nav (ArrowDown apparently broken with many items).
  if (!$list._mouseMoveBound) {
    $list.addEventListener("mousemove", () => { state.lastMouseMove = Date.now(); }, { passive: true });
    $list._mouseMoveBound = true;
  }
  $list.querySelectorAll(".row").forEach((el) => {
    el.addEventListener("click", (ev) => {
      // Don't activate when clicking the per-row buttons.
      if (ev.target.closest(".scene-restore-btn") || ev.target.closest(".scene-delete-btn")) return;
      activate(Number(el.dataset.idx));
    });
    el.addEventListener("mouseenter", () => {
      if (!state.lastMouseMove || Date.now() - state.lastMouseMove > 100) return;
      state.rowIdx = Number(el.dataset.idx);
      $list.querySelectorAll(".row").forEach((r) =>
        r.classList.toggle("sel", Number(r.dataset.idx) === state.rowIdx));
    });
  });
  $list.querySelectorAll(".scene-restore-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ kind: "scenes-restore", slug: btn.dataset.slug }, () => window.close());
    });
  });
  $list.querySelectorAll(".scene-delete-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ kind: "scenes-delete", slug: btn.dataset.slug }, refresh);
    });
  });
  // Don't trigger row activate when clicking a button — also catch tree-toggle.
  $list.querySelectorAll(".tree-toggle").forEach((btn) => {
    if (btn.classList.contains("ghost")) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const tid = Number(btn.dataset.tid);
      if (!Number.isFinite(tid)) return;
      if (state.collapsedTreeIds.has(tid)) state.collapsedTreeIds.delete(tid);
      else state.collapsedTreeIds.add(tid);
      renderList();
    });
  });
  if (isScenes) wireSceneForm();
  const sel = $list.querySelector(".row.sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}

function fmtMb(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const mb = bytes / (1024 * 1024);
  return mb < 100 ? mb.toFixed(0) + "M" : (mb / 1024).toFixed(2) + "G";
}

function timeAgo(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60)     return sec + "s ago";
  if (sec < 3600)   return Math.floor(sec / 60) + "m ago";
  if (sec < 86400)  return Math.floor(sec / 3600) + "h ago";
  if (sec < 604800) return Math.floor(sec / 86400) + "d ago";
  return Math.floor(sec / 604800) + "w ago";
}

function renderMinimap(items) {
  if (!items.length) {
    $list.innerHTML = `<div class="empty">no tabs</div>`;
    return;
  }
  const grouped = new Map();
  for (const t of items) {
    const winId = t.windowId ?? 0;
    if (!grouped.has(winId)) grouped.set(winId, []);
    grouped.get(winId).push(t);
  }
  const winRows = [...grouped.entries()].map(([winId, tabs]) => {
    const cells = tabs.map((t, i) => {
      const hue = domainHueFor(t.url || "");
      const sel = t.windowId === state.currentWindowId && t.active;
      return `<div class="mm-cell${t.pinned ? " mm-pinned" : ""}${sel ? " mm-active" : ""}"
                    data-idx="${items.indexOf(t)}" data-tab-id="${t.id}"
                    style="background:hsl(${hue},75%,45%);"
                    title="${escapeHtml((t.title || t.url || "").slice(0, 80))}"></div>`;
    }).join("");
    return `<div class="mm-window">
      <div class="mm-window-label">win ${winId === state.currentWindowId ? "★" : ""} · ${tabs.length}</div>
      <div class="mm-grid">${cells}</div>
    </div>`;
  }).join("");
  $list.innerHTML = `<div class="minimap">${winRows}</div>`;
  $list.querySelectorAll(".mm-cell").forEach((el) => {
    el.addEventListener("click", () => activate(Number(el.dataset.idx)));
  });
}

function wireSceneForm() {
  const nameInput = $list.querySelector(".scene-name");
  const saveBtn   = $list.querySelector(".scene-save-btn");
  const status    = $list.querySelector(".scene-save-status");
  if (!nameInput || !saveBtn) return;
  const submit = () => {
    const name = nameInput.value.trim();
    if (!name) { status.textContent = "name required"; return; }
    status.textContent = "saving…";
    chrome.runtime.sendMessage({ kind: "scenes-save", name }, (resp) => {
      if (!resp?.ok) {
        status.textContent = "error: " + (resp?.error || "no tabs to save");
        return;
      }
      status.textContent = `saved ${resp.scene?.tabs?.length || 0} tabs`;
      nameInput.value = "";
      refresh();
    });
  };
  saveBtn.addEventListener("click", submit);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
  });
}

function render() {
  renderCats();
  renderList();
  const killBtn = document.getElementById("killHeaviest");
  if (killBtn) killBtn.classList.toggle("hidden", !state.proc.available);
}

function activate(idx) {
  const items = currentList();
  const t = items[idx];
  if (!t) return;
  if (t.kind === "closed") {
    chrome.runtime.sendMessage({ kind: "restore", sessionId: t.sessionId }, () => window.close());
  } else if (t.kind === "scene") {
    chrome.runtime.sendMessage({ kind: "scenes-restore", slug: t.slug }, () => window.close());
  } else if (t.kind === "history") {
    chrome.tabs.create({ url: t.url, active: true }, () => window.close());
  } else {
    // "open", "tree", "minimap" — all wrap an open Tab.
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
    chrome.runtime.sendMessage({ kind: "scenes-list" }, (sd) => {
      state.scenes = sd?.scenes || [];
      // Best-effort processes snapshot. No-op on stable Chrome.
      chrome.runtime.sendMessage({ kind: "processes-snapshot" }, (pd) => {
        state.proc = pd && pd.available ? pd : { available: false, perTab: {} };
        loadHistory(() => {
          if (state.firstRender) {
            // open-history (Cmd+Y) writes pendingCategory before openPopup;
            // pick it up exactly once.
            chrome.storage.session.get("pendingCategory", (bag) => {
              const pending = bag?.pendingCategory;
              if (pending) {
                const idx = CATEGORIES.findIndex((c) => c.id === pending);
                if (idx >= 0) state.catIdx = idx;
                chrome.storage.session.remove("pendingCategory");
              }
              const items = currentList();
              const i = items.findIndex((t) => t.active);
              state.rowIdx = i >= 0 && i + 1 < items.length ? i + 1 : 0;
              state.firstRender = false;
              render();
            });
          } else {
            render();
          }
        });
      });
    });
  });
}

function loadHistory(done) {
  if (!chrome.history) { state.historyLoaded = true; return done(); }
  // text:"" returns everything ordered by lastVisitTime desc.
  // startTime:0 is the documented way to ask for the full window.
  chrome.history.search(
    { text: "", maxResults: HISTORY_MAX_RESULTS, startTime: 0 },
    (results) => {
      state.history = results || [];
      state.historyLoaded = true;
      done();
    }
  );
}

$q.addEventListener("input", (e) => {
  state.filter = e.target.value;
  state.rowIdx = 0;
  renderList();
});

document.getElementById("killHeaviest")?.addEventListener("click", () => {
  chrome.runtime.sendMessage({ kind: "kill-heaviest" }, (r) => {
    if (!r?.ok) alert("kill-heaviest: " + (r?.error || "no candidate"));
    refresh();
  });
});

document.addEventListener("keydown", (e) => {
  // Cmd/Ctrl+1..9 + Cmd/Ctrl+0 (10th slot → History).
  if ((e.metaKey || e.ctrlKey) && /^[0-9]$/.test(e.key)) {
    // 1..9 map to indices 0..8; 0 maps to index 9 (History).
    const n = parseInt(e.key, 10);
    const idx = n === 0 ? 9 : n - 1;
    if (idx < CATEGORIES.length) {
      e.preventDefault();
      state.catIdx = idx;
      state.rowIdx = 0;
      render();
      return;
    }
  }
  // Tree-view: ← / → collapse / expand the current branch.
  if (CATEGORIES[state.catIdx].id === "tree" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    const items = currentList();
    const cur = items[state.rowIdx];
    if (cur && cur._hasChildren) {
      e.preventDefault();
      if (e.key === "ArrowLeft")  state.collapsedTreeIds.add(cur.id);
      if (e.key === "ArrowRight") state.collapsedTreeIds.delete(cur.id);
      renderList();
      return;
    }
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
    } else if (t?.kind === "history" && t.url) {
      // chrome.history.deleteUrl removes ALL visits to this URL — that's
      // what the user wants for an fzf-history sweep (one stroke = gone).
      e.preventDefault();
      chrome.history.deleteUrl({ url: t.url }, () => {
        state.history = state.history.filter((h) => h.url !== t.url);
        renderList();
      });
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
