// zpwrchrome — JetBrains-style "Recent Files" modal, served by an in-page
// content script. Shadow DOM keeps host-page styles from leaking in.
//
// Trigger: background.js sends { kind: "open-modal" } when the user fires the
// `recent-modal` command (default Cmd+E on Mac, Ctrl+E elsewhere). While the
// modal is open the content script handles its own keyboard nav. The user
// can hold the modifier and tap E again to cycle MRU forward (like
// JetBrains); shift+E cycles backward; release closes and activates.

(() => {
  const MODAL_ID = "zpwrchrome-modal-host-0a1b";
  if (window[MODAL_ID + "-installed"]) return; // idempotent injection
  window[MODAL_ID + "-installed"] = true;

  // Cyberpunk fonts inlined as base64 data: URIs so strict host-page CSP
  // (font-src) can't block them. Network fetches via chrome.runtime.getURL
  // ARE subject to the host page's CSP — data: URIs are not. scripts/
  // build-modal.sh substitutes the %%STM%% / %%ORB%% markers below with
  // the base64 of fonts/ShareTechMono-Regular.woff2 and fonts/Orbitron.woff2.
  const FONT_STM = "%%STM%%";
  const FONT_ORB = "%%ORB%%";

  // FZF fuzzy-match algorithm inlined from lib/fzf.js — content scripts
  // can't ES-import, so build-modal.sh substitutes the marker on the next
  // line with lib/fzf.js's FZF_INLINE_START/END block, `export ` stripped.
%%FZF%%

  // Shared tab helpers (hostnameOf, buildTabTree, flattenTree, domainHueFor)
  // inlined from lib/util.js's UTIL_INLINE_START/END block — same trick as
  // fzf above. Single source of truth is lib/util.js; the build script
  // substitutes here.
%%UTIL%%

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

  // chrome.history fetch ceiling — see popup.js comment.
  const HISTORY_MAX_RESULTS = 5000;

  const CSS = `
    @font-face {
      font-family: 'Share Tech Mono';
      font-style: normal; font-weight: 400; font-display: swap;
      src: url(data:font/woff2;base64,${FONT_STM}) format('woff2');
    }
    @font-face {
      font-family: 'Orbitron';
      font-style: normal; font-weight: 600; font-display: swap;
      src: url(data:font/woff2;base64,${FONT_ORB}) format('woff2');
    }
    @font-face {
      font-family: 'Orbitron';
      font-style: normal; font-weight: 900; font-display: swap;
      src: url(data:font/woff2;base64,${FONT_ORB}) format('woff2');
    }
    /* "all: initial !important" expands to "font-family: initial !important"
       and every other longhand. Without !important on font-family below,
       the !important initial wins the cascade and the body text falls back
       to the user-agent default (Times New Roman). Mark both !important.
       (Bare backticks in comments terminate this template literal — see
       v0.2.4 regression — keep quotes inside template-literal CSS.) */
    :host {
      all: initial !important;
      font-family: 'Share Tech Mono', 'SF Mono', monospace !important;
      color: #e0f0ff !important;
    }
    /* Belt-and-suspenders: descendants set font-family explicitly too so
       even pathological host-page rules can't pierce the shadow boundary. */
    .overlay, .modal, .header, .body, .cats, .cat, .list, .row, .footer,
    .name, .path, .badge, .empty, .hint, .search {
      font-family: 'Share Tech Mono', 'SF Mono', monospace;
    }
    .overlay {
      position: fixed; inset: 0;
      background: rgba(5, 5, 10, 0.72);
      backdrop-filter: blur(8px);
      z-index: 2147483647;
      display: flex; align-items: flex-start; justify-content: center;
      padding-top: 72px;
    }
    .modal {
      width: min(960px, 92vw);
      height: min(640px, 80vh);
      background: #0d0d1a;
      border: 1px solid #05d9e8;
      border-radius: 4px;
      box-shadow: 0 0 60px rgba(5, 217, 232, 0.45), 0 24px 80px rgba(0, 0, 0, 0.6);
      display: grid; grid-template-rows: auto 1fr;
      overflow: hidden; color: #e0f0ff;
      animation: pop 120ms ease-out;
    }
    @keyframes pop { from { transform: translateY(-8px); opacity: 0; } to { transform: none; opacity: 1; } }
    .header {
      display: grid; grid-template-columns: auto 1fr auto;
      align-items: center; gap: 14px;
      padding: 12px 16px;
      border-bottom: 1px solid #1a1a3e;
      background: linear-gradient(180deg, #070714, #0a0a14);
    }
    .title {
      font-family: 'Orbitron', 'Share Tech Mono', monospace;
      font-size: 11px; font-weight: 900; letter-spacing: 3px; text-transform: uppercase;
      background: linear-gradient(90deg, #05d9e8, #fff, #ff2a6d, #05d9e8);
      background-size: 300% 100%;
      -webkit-background-clip: text; background-clip: text;
      color: transparent;
      animation: shimmer 6s linear infinite;
    }
    .search {
      padding: 6px 10px;
      background: #0a0a14;
      border: 1px solid #05d9e8;
      color: #e0f0ff;
      font-family: inherit; font-size: 12px;
      outline: none; border-radius: 2px;
      box-shadow: 0 0 8px rgba(5, 217, 232, 0.15);
      width: 100%;
    }
    .search::placeholder { color: #3d4f6a; }
    .search:focus {
      border-color: #ff2a6d;
      box-shadow: 0 0 12px rgba(255, 42, 109, 0.35);
    }
    .hint { font-size: 9.5px; color: #3d4f6a; letter-spacing: 1.5px; white-space: nowrap; }
    .hint-link {
      color: #05d9e8;
      text-decoration: none;
      border-bottom: 1px solid transparent;
      cursor: pointer;
    }
    .hint-link:hover {
      color: #ff2a6d;
      border-bottom-color: #ff2a6d;
      text-shadow: 0 0 6px rgba(255, 42, 109, 0.45);
    }
    .body {
      display: grid; grid-template-columns: 240px 1fr;
      overflow: hidden;
    }
    .cats {
      border-right: 1px solid #1a1a3e;
      overflow-y: auto;
      background: #0a0a14;
      padding: 6px 0;
    }
    .cat {
      padding: 7px 14px 7px 17px;
      font-size: 12px; color: #7a8ba8;
      cursor: pointer;
      display: flex; justify-content: space-between; align-items: center;
      border-left: 3px solid transparent;
    }
    .cat:hover { background: #12122a; color: #e0f0ff; }
    .cat.sel {
      background: rgba(5, 217, 232, 0.1);
      color: #05d9e8;
      border-left-color: #05d9e8;
    }
    .cat .key { font-size: 10px; color: #3d4f6a; letter-spacing: 1px; }
    .cat.sel .key { color: #05d9e8; }
    .list { overflow-y: auto; padding: 4px 0; }
    .row {
      display: grid;
      grid-template-columns: 18px 1fr auto;
      gap: 10px; align-items: center;
      padding: 5px 16px;
      font-size: 13px; color: #e0f0ff;
      cursor: pointer;
      border-left: 3px solid transparent;
    }
    .row:hover { background: #12122a; }
    .row.sel {
      background: rgba(255, 42, 109, 0.08);
      border-left-color: #ff2a6d;
    }
    .row.active-tab .name { color: #39ff14; }
    .favicon { width: 16px; height: 16px; }
    .title-col { display: flex; gap: 10px; align-items: baseline; min-width: 0; }
    .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .path { font-size: 11px; color: #7a8ba8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .badges { display: flex; gap: 4px; flex-shrink: 0; }
    .badge {
      font-size: 9px; letter-spacing: 1px; text-transform: uppercase;
      color: #3d4f6a; padding: 1px 5px;
      border: 1px solid #1a1a3e; border-radius: 2px;
    }
    .badge.pinned  { color: #ff2a6d; border-color: #ff2a6d; }
    .badge.audible { color: #39ff14; border-color: #39ff14; }
    .badge.muted   { color: #7a8ba8; border-color: #7a8ba8; }
    .empty { padding: 24px; color: #3d4f6a; font-style: italic; text-align: center; font-size: 12px; }
    /* fzf match highlight — same selector as audio-haxor for visual parity */
    mark.fzf-hl {
      background: rgba(5, 217, 232, 0.18);
      color: #05d9e8;
      border-bottom: 1px solid #05d9e8;
      padding: 0;
      border-radius: 0;
      font-weight: inherit;
    }
    .footer {
      display: flex; gap: 16px;
      padding: 6px 16px;
      border-top: 1px solid #1a1a3e;
      background: #0a0a14;
      font-size: 10px; color: #3d4f6a; letter-spacing: 1px;
    }
    .footer kbd {
      color: #05d9e8;
      background: #070714;
      border: 1px solid #1a1a3e;
      padding: 1px 5px;
      border-radius: 2px;
      margin-right: 4px;
    }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: #05050a; }
    ::-webkit-scrollbar-thumb { background: linear-gradient(180deg, #05d9e8, #d300c5); border-radius: 3px; }
    @keyframes shimmer { 0% { background-position: 0% 0%; } 100% { background-position: 300% 0%; } }

    /* Tree view */
    .row.tree-row { grid-template-columns: 16px 16px 1fr auto; }
    .tree-toggle {
      width: 14px; height: 14px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 9px; color: #7a8ba8;
      background: transparent; border: none; cursor: pointer; padding: 0;
    }
    .tree-toggle:hover { color: #05d9e8; }
    .tree-toggle.ghost { cursor: default; visibility: hidden; }

    /* Scenes */
    .scene-save-form {
      display: flex; gap: 8px; padding: 10px 16px;
      border-bottom: 1px solid #1a1a3e; background: #0a0a14;
      align-items: center;
    }
    .scene-name {
      flex: 1; min-width: 0;
      padding: 5px 9px;
      background: #070714;
      color: #e0f0ff;
      border: 1px solid #1a1a3e;
      font: inherit; font-size: 12px;
      border-radius: 2px;
      outline: none;
    }
    .scene-name:focus { border-color: #05d9e8; box-shadow: 0 0 6px rgba(5, 217, 232, 0.35); }
    .scene-save-btn {
      padding: 5px 10px;
      background: transparent; color: #ff2a6d;
      border: 1px solid #ff2a6d; border-radius: 2px;
      font: inherit; font-size: 11px; letter-spacing: 1px; text-transform: uppercase;
      cursor: pointer;
    }
    .scene-save-btn:hover { background: rgba(255, 42, 109, 0.1); box-shadow: 0 0 8px rgba(255, 42, 109, 0.35); }
    .scene-save-status { font-size: 10px; color: #7a8ba8; }
    .scene-glyph { color: #d300c5; font-size: 14px; line-height: 16px; text-align: center; }
    .scene-restore-btn, .scene-delete-btn {
      font: inherit; cursor: pointer;
      background: transparent;
    }
    .scene-restore-btn { color: #05d9e8; border-color: #05d9e8; }
    .scene-restore-btn:hover { background: rgba(5, 217, 232, 0.1); }
    .scene-delete-btn  { color: #7a8ba8; border-color: #7a8ba8; }
    .scene-delete-btn:hover { color: #ff073a; border-color: #ff073a; background: rgba(255, 7, 58, 0.06); }

    /* Minimap */
    .minimap { padding: 10px 16px; display: flex; flex-direction: column; gap: 14px; }
    .mm-window { display: flex; flex-direction: column; gap: 4px; }
    .mm-window-label {
      font-size: 9.5px; letter-spacing: 1.5px; text-transform: uppercase;
      color: #7a8ba8;
    }
    .mm-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(18px, 1fr));
      gap: 3px;
    }
    .mm-cell {
      height: 18px; border-radius: 2px;
      cursor: pointer;
      border: 1px solid transparent;
    }
    .mm-cell:hover { transform: scale(1.15); }
    .mm-pinned { border-color: #ff2a6d; }
    .mm-active { box-shadow: 0 0 0 2px #fff; }
  `;

  let state = null;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.kind === "open-modal")  openModal();
    if (msg?.kind === "close-modal") closeModal();
  });

  function openModal() {
    if (state) {
      // Already open — interpret repeat as "cycle next".
      cycle(+1);
      return;
    }
    const host = document.createElement("div");
    host.id = MODAL_ID;
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>${CSS}</style>` + html();

    // Focus sink — a real <input> in document.body (outside the shadow) so
    // Vimium/cVim and similar key-grabbing extensions detect "insert mode"
    // (they check document.activeElement.tagName === "INPUT") and stop
    // intercepting keystrokes. Without this, closed shadow DOM hides our
    // visible search input — document.activeElement returns the host div
    // (not an input) — Vimium grabs single-char keys like d, j, k.
    const sink = document.createElement("input");
    sink.type = "text";
    sink.setAttribute("aria-hidden", "true");
    sink.setAttribute("tabindex", "0");
    sink.id = MODAL_ID + "-sink";
    sink.style.cssText = [
      "position:fixed !important",
      "top:0 !important",
      "left:0 !important",
      "width:1px !important",
      "height:1px !important",
      "padding:0 !important",
      "margin:0 !important",
      "border:0 !important",
      "opacity:0 !important",
      "z-index:2147483646 !important",
      "pointer-events:none !important"
    ].join(";");
    document.documentElement.appendChild(sink);

    state = {
      host, shadow, sink,
      catIdx: 0, rowIdx: 0,
      filter: "",
      mru: [], closed: [], scenes: [], history: [],
      historyLoaded: false,
      collapsedTreeIds: new Set(),
      currentWindowId: null,
      firstRender: true
    };
    wire();
    refresh();
  }

  function closeModal() {
    if (!state) return;
    try { window.removeEventListener("keydown", state.kd, true); } catch {}
    try { window.removeEventListener("keyup",   state.ku, true); } catch {}
    try { document.removeEventListener("focusin",  state.fi, true); } catch {}
    try { state.host.remove(); } catch {}
    try { state.sink.remove(); } catch {}
    state = null;
  }

  function html() {
    return `
      <div class="overlay">
        <div class="modal" role="dialog" aria-modal="true" aria-label="Recent Tabs">
          <div class="header">
            <div class="title">zpwrchrome // recent</div>
            <input class="search" type="search" placeholder="filter // url, title, host" autocomplete="off">
            <div class="hint">
              <a class="hint-link" data-act="open-scripts" href="#">scripts ▸</a> ·
              ${navigator.platform.includes("Mac") ? "⌘E" : "Ctrl+E"} cycle · Esc close
            </div>
          </div>
          <div class="body">
            <div class="cats">
              ${CATEGORIES.map((c, i) => `
                <div class="cat${i === 0 ? " sel" : ""}" data-idx="${i}" data-id="${c.id}">
                  <span>${c.label}</span><span class="key">${c.key}</span>
                </div>
              `).join("")}
            </div>
            <div class="list" id="list"><div class="empty">loading…</div></div>
          </div>
          <div class="footer">
            <span><kbd>↑↓</kbd>nav</span>
            <span><kbd>Enter</kbd>switch</span>
            <span><kbd>⌘1–0</kbd>category</span>
            <span><kbd>←→</kbd>tree</span>
            <span><kbd>⌫</kbd>close tab</span>
            <span><kbd>Esc</kbd>cancel</span>
          </div>
        </div>
      </div>
    `;
  }

  function wire() {
    const { shadow, sink } = state;

    // The visible search input mirrors the sink. It's display-only;
    // pointer-events disabled so clicks don't move focus off the sink.
    const search = shadow.querySelector(".search");
    search.readOnly = true;
    search.tabIndex = -1;
    search.style.pointerEvents = "none";

    shadow.querySelectorAll(".cat").forEach((el) => {
      el.addEventListener("click", () => {
        state.catIdx = Number(el.dataset.idx);
        state.rowIdx = 0;
        render();
        sink.focus();
      });
    });

    shadow.querySelector(".overlay").addEventListener("mousedown", (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    // "scripts" link in the header → open dashboard via background.
    const scriptsLink = shadow.querySelector('[data-act="open-scripts"]');
    if (scriptsLink) {
      scriptsLink.addEventListener("click", (e) => {
        e.preventDefault();
        // Callback form swallows lastError if the SW is mid-restart.
        chrome.runtime.sendMessage(
          { kind: "open-scripts-manager" },
          () => { void chrome.runtime.lastError; }
        );
        closeModal();
      });
    }

    state.kd = (e) => handleKey(e);
    state.ku = (e) => handleKeyUp(e);
    state.fi = (e) => {
      // If focus leaves the sink (host page steals focus, click on a row),
      // pull it back so Vimium keeps seeing "input is focused" → backs off.
      if (state && e.target !== state.sink) {
        // Skip if focus moved into our own host element (e.g., a click on a row).
        // We still want our sink focused so the next keystroke goes to us.
        queueMicrotask(() => { if (state) state.sink.focus(); });
      }
    };
    window.addEventListener("keydown", state.kd, true);
    window.addEventListener("keyup",   state.ku, true);
    document.addEventListener("focusin", state.fi, true);

    // Focus the sink last so it grabs initial focus.
    setTimeout(() => sink.focus(), 0);
  }

  function refresh() {
    chrome.runtime.sendMessage({ kind: "list" }, (data) => {
      if (!state || !data) return;
      state.mru = data.mru || [];
      state.closed = data.closed || [];
      // Current window = the window containing the active tab (which is index 0 of MRU).
      state.currentWindowId = state.mru.find((t) => t.active)?.windowId
                            ?? state.mru[0]?.windowId
                            ?? null;
      chrome.runtime.sendMessage({ kind: "scenes-list" }, (sd) => {
        if (!state) return;
        state.scenes = sd?.scenes || [];
        chrome.runtime.sendMessage(
          { kind: "history-list", maxResults: HISTORY_MAX_RESULTS },
          (hd) => {
            if (!state) return;
            state.history = hd?.history || [];
            state.historyLoaded = true;
            if (state.firstRender) {
              const items = currentList();
              const i = items.findIndex((t) => t.active);
              state.rowIdx = i >= 0 && i + 1 < items.length ? i + 1 : 0;
              state.firstRender = false;
            }
            render();
          }
        );
      });
    });
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

  function hostOf(url) { try { return new URL(url).hostname; } catch { return ""; } }

  function currentList() {
    const cat = CATEGORIES[state.catIdx];

    // 1) Get tabs for the category (no filter yet).
    let items;
    if (cat.id === "closed") {
      items = state.closed.map((s) => {
        const t = s.tab || s.window?.tabs?.[0];
        return t && { ...t, kind: "closed", sessionId: s.tab?.sessionId || s.window?.sessionId };
      }).filter(Boolean);
    } else if (cat.id === "scenes") {
      // Scenes — plain substring match (not fzf — name+slug, not URL+title).
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
      // Tree rows preserve parent→child ordering — bypass fzf reshape.
      const f = state.filter.toLowerCase();
      const matchesLite = (t) => !f
        || (t.title || "").toLowerCase().includes(f)
        || (t.url   || "").toLowerCase().includes(f)
        || hostOf(t.url || "").toLowerCase().includes(f);
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
    } else if (cat.id === "minimap") {
      const f = state.filter.toLowerCase();
      const matchesLite = (t) => !f
        || (t.title || "").toLowerCase().includes(f)
        || (t.url   || "").toLowerCase().includes(f)
        || hostOf(t.url || "").toLowerCase().includes(f);
      return state.mru
        .filter(matchesLite)
        .map((t) => ({ ...t, kind: "minimap" }));
    } else if (cat.id === "history") {
      items = state.history.map((h) => ({
        kind: "history",
        url: h.url,
        title: h.title,
        lastVisitTime: h.lastVisitTime,
        visitCount: h.visitCount,
      }));
    } else {
      items = state.mru.map((t) => ({ ...t, kind: "open" }));
      if      (cat.id === "current") items = items.filter((t) => t.windowId === state.currentWindowId);
      else if (cat.id === "pinned")  items = items.filter((t) => t.pinned);
      else if (cat.id === "audible") items = items.filter((t) => t.audible);
      else if (cat.id === "muted")   items = items.filter((t) => t.mutedInfo?.muted);
    }

    // 2) No filter → return in MRU order.
    if (!state.filter) return items;

    // 3) Filter + score via fzf. Match against title and host separately;
    //    keep the higher score. Both index sets are stashed on the row for
    //    the renderer to highlight matched characters.
    const scored = [];
    for (const t of items) {
      const titleText = t.title || t.url || "";
      const hostText  = hostOf(t.url || "");
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

  function render() {
    if (!state) return;
    const { shadow } = state;
    const cat = CATEGORIES[state.catIdx];
    const isScenes  = cat.id === "scenes";
    const isMinimap = cat.id === "minimap";
    shadow.querySelectorAll(".cat").forEach((el, i) => {
      el.classList.toggle("sel", i === state.catIdx);
    });
    const list = shadow.querySelector(".list");
    const items = currentList();

    if (isMinimap) { renderMinimap(list, items); return; }

    const saveForm = isScenes ? `
      <div class="scene-save-form">
        <input class="scene-name" type="text" placeholder="name this scene (e.g. 'research', 'client-x')"
               maxlength="48" autocomplete="off">
        <button class="scene-save-btn">Save current window</button>
        <span class="scene-save-status muted small"></span>
      </div>
    ` : "";

    if (!items.length) {
      list.innerHTML = saveForm + `<div class="empty">${isScenes ? "no scenes saved yet" : "no matches"}</div>`;
      if (isScenes) wireSceneForm();
      return;
    }
    if (state.rowIdx >= items.length) state.rowIdx = items.length - 1;
    if (state.rowIdx < 0) state.rowIdx = 0;
    list.innerHTML = saveForm + items.map((t, i) => row(t, i, i === state.rowIdx)).join("");
    list.querySelectorAll(".row img.favicon").forEach((img) => {
      img.addEventListener("error", () => { img.style.visibility = "hidden"; });
    });
    // Track real mouse movement on the list. mouseenter alone fires on
    // scroll (when scrollIntoView shifts a row under a stationary cursor)
    // — without this guard, every ArrowDown press jumps selection back to
    // whatever row happens to be under the mouse.
    if (!list._mouseMoveBound) {
      list.addEventListener("mousemove", () => { state.lastMouseMove = Date.now(); }, { passive: true });
      list._mouseMoveBound = true;
    }
    list.querySelectorAll(".row").forEach((el) => {
      el.addEventListener("click", (ev) => {
        if (ev.target.closest(".scene-restore-btn") || ev.target.closest(".scene-delete-btn")) return;
        activate(Number(el.dataset.idx));
      });
      el.addEventListener("mouseenter", () => {
        // Only honor mouseenter if the user actually moved the mouse just
        // now — not if scroll-into-view shifted the row under the cursor.
        if (!state.lastMouseMove || Date.now() - state.lastMouseMove > 100) return;
        state.rowIdx = Number(el.dataset.idx);
        list.querySelectorAll(".row").forEach((r) =>
          r.classList.toggle("sel", Number(r.dataset.idx) === state.rowIdx));
      });
    });
    list.querySelectorAll(".scene-restore-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ kind: "scenes-restore", slug: btn.dataset.slug }, () => closeModal());
      });
    });
    list.querySelectorAll(".scene-delete-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ kind: "scenes-delete", slug: btn.dataset.slug }, () => refresh());
      });
    });
    list.querySelectorAll(".tree-toggle").forEach((btn) => {
      if (btn.classList.contains("ghost")) return;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const tid = Number(btn.dataset.tid);
        if (!Number.isFinite(tid)) return;
        if (state.collapsedTreeIds.has(tid)) state.collapsedTreeIds.delete(tid);
        else state.collapsedTreeIds.add(tid);
        render();
      });
    });
    if (isScenes) wireSceneForm();
    const sel = list.querySelector(".row.sel");
    if (sel) sel.scrollIntoView({ block: "nearest" });
  }

  function renderMinimap(list, items) {
    if (!items.length) { list.innerHTML = `<div class="empty">no tabs</div>`; return; }
    const grouped = new Map();
    for (const t of items) {
      const winId = t.windowId ?? 0;
      if (!grouped.has(winId)) grouped.set(winId, []);
      grouped.get(winId).push(t);
    }
    const winRows = [...grouped.entries()].map(([winId, tabs]) => {
      const cells = tabs.map((t) => {
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
    list.innerHTML = `<div class="minimap">${winRows}</div>`;
    list.querySelectorAll(".mm-cell").forEach((el) => {
      el.addEventListener("click", () => activate(Number(el.dataset.idx)));
    });
  }

  function wireSceneForm() {
    const list = state.shadow.querySelector(".list");
    const nameInput = list.querySelector(".scene-name");
    const saveBtn   = list.querySelector(".scene-save-btn");
    const status    = list.querySelector(".scene-save-status");
    if (!nameInput || !saveBtn) return;
    // The scene-name input is a real <input> — let it own keyboard focus so
    // the user can type. handleKey's window-level catch still works for
    // Cmd+1..0 since input doesn't stop those when filter is empty here.
    nameInput.addEventListener("keydown", (e) => e.stopPropagation());
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
    nameInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function row(t, idx, selected) {
    if (t.kind === "scene") {
      const when = t.updated_at ? new Date(t.updated_at).toLocaleString() : "";
      return `
        <div class="row scene-row${selected ? " sel" : ""}"
             data-idx="${idx}" data-kind="scene" data-slug="${escapeHtml(t.slug)}">
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
    const host = hostOf(t.url || "");
    const titleText = t.title || t.url || "(untitled)";
    const titleHtml = t._titleHl?.length ? highlightWithIndices(titleText, t._titleHl, escapeHtml) : escapeHtml(titleText);
    const hostHtml  = t._hostHl?.length  ? highlightWithIndices(host,      t._hostHl,  escapeHtml) : escapeHtml(host);
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
    return `
      <div class="row${selected ? " sel" : ""}${t.active ? " active-tab" : ""}${isTree ? " tree-row" : ""}"
           data-idx="${idx}"
           data-kind="${t.kind}"
           data-tab-id="${t.id ?? ""}"
           data-session-id="${t.sessionId ?? ""}"
           ${indent}>
        ${toggle}
        ${fav}
        <div class="title-col">
          <span class="name">${titleHtml}</span>
          <span class="path">${hostHtml}</span>
        </div>
        <div class="badges">${badges.join("")}</div>
      </div>
    `;
  }

  function activate(idx) {
    const items = currentList();
    const t = items[idx];
    if (!t) return;
    const swallow = () => { void chrome.runtime.lastError; };
    if (t.kind === "closed") {
      chrome.runtime.sendMessage({ kind: "restore", sessionId: t.sessionId }, swallow);
    } else if (t.kind === "scene") {
      chrome.runtime.sendMessage({ kind: "scenes-restore", slug: t.slug }, swallow);
    } else if (t.kind === "history") {
      // Content scripts can't call chrome.tabs.create directly; route through
      // background. We piggyback on the gm:openInTab handler that's already
      // wired for userscripts — same behavior (new active tab).
      chrome.runtime.sendMessage({ kind: "gm:openInTab", url: t.url, active: true }, swallow);
    } else {
      chrome.runtime.sendMessage({ kind: "activate", tabId: t.id }, swallow);
    }
    closeModal();
  }

  function cycle(delta) {
    if (!state) return;
    const items = currentList();
    if (!items.length) return;
    state.rowIdx = (state.rowIdx + delta + items.length) % items.length;
    render();
  }

  function setFilter(next) {
    const search = state.shadow.querySelector(".search");
    search.value = next;
    state.sink.value = next;
    state.filter = next;
    state.rowIdx = 0;
    render();
  }

  function handleKey(e) {
    if (!state) return;
    // Lone modifier presses (Shift, Cmd held down) — ignore.
    if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;

    // Cmd/Ctrl + 1..9 + Cmd/Ctrl + 0 → category jump (0 = History, 10th slot).
    if ((e.metaKey || e.ctrlKey) && /^[0-9]$/.test(e.key)) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const n = parseInt(e.key, 10);
      const idx = n === 0 ? 9 : n - 1;
      if (idx < CATEGORIES.length) { state.catIdx = idx; state.rowIdx = 0; render(); }
      return;
    }
    // Cmd/Ctrl + E → cycle MRU.
    if ((e.metaKey || e.ctrlKey) && (e.key === "e" || e.key === "E")) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      cycle(e.shiftKey ? -1 : +1);
      return;
    }
    // Any other modifier combo (Cmd+C, Cmd+A, Cmd+V, etc.) — let the
    // browser / OS handle it. We don't block clipboard or system shortcuts.
    if (e.metaKey || e.ctrlKey) return;

    // Past this point the modal owns the key. Stop every other extension
    // (Vimium, custom hotkeys) from acting on it.
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (e.key === "Escape")    { e.preventDefault(); closeModal(); return; }
    // Tree-view: ← / → collapse / expand the current branch.
    if (CATEGORIES[state.catIdx].id === "tree" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const cur = currentList()[state.rowIdx];
      if (cur && cur._hasChildren) {
        e.preventDefault();
        if (e.key === "ArrowLeft")  state.collapsedTreeIds.add(cur.id);
        if (e.key === "ArrowRight") state.collapsedTreeIds.delete(cur.id);
        render();
        return;
      }
    }
    if (e.key === "ArrowDown") { e.preventDefault(); cycle(+1); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); cycle(-1); return; }
    if (e.key === "Enter")     { e.preventDefault(); activate(state.rowIdx); return; }

    if (e.key === "Backspace") {
      // If filter has content, trim a character. Otherwise act on the row:
      //   open → close tab, history → delete URL from history.
      e.preventDefault();
      if (state.filter.length > 0) {
        setFilter(state.filter.slice(0, -1));
      } else {
        const t = currentList()[state.rowIdx];
        if (t?.kind === "open") {
          chrome.runtime.sendMessage({ kind: "close-tab", tabId: t.id }, () => refresh());
        } else if (t?.kind === "history" && t.url) {
          const url = t.url;
          chrome.runtime.sendMessage({ kind: "history-delete", url }, () => {
            state.history = state.history.filter((h) => h.url !== url);
            render();
          });
        }
      }
      return;
    }
    if (e.key === "Delete") {
      // Fn+Backspace on Mac, real Del elsewhere. Closes highlighted tab,
      // or deletes a history entry when in the History category.
      e.preventDefault();
      const t = currentList()[state.rowIdx];
      if (t?.kind === "open") {
        chrome.runtime.sendMessage({ kind: "close-tab", tabId: t.id }, () => refresh());
      } else if (t?.kind === "history" && t.url) {
        const url = t.url;
        chrome.runtime.sendMessage({ kind: "history-delete", url }, () => {
          state.history = state.history.filter((h) => h.url !== url);
          render();
        });
      }
      return;
    }

    // Any printable single-char key → append to filter. e.key is the rendered
    // character (respects shift, layout). We never let it bubble.
    if (e.key.length === 1) {
      e.preventDefault();
      setFilter(state.filter + e.key);
      return;
    }
  }

  function handleKeyUp(e) {
    // No-op for now. Could be wired to JetBrains-style "release modifier =
    // activate" behavior, but plain Enter already covers it without ambiguity.
  }
})();
