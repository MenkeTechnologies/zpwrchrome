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

  const CATEGORIES = [
    { id: "all",     label: "All Tabs",          key: "⌘1" },
    { id: "current", label: "Current Window",    key: "⌘2" },
    { id: "pinned",  label: "Pinned",            key: "⌘3" },
    { id: "audible", label: "Audible",           key: "⌘4" },
    { id: "muted",   label: "Muted",             key: "⌘5" },
    { id: "closed",  label: "Recently Closed",   key: "⌘6" }
  ];

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
    /* `all: initial !important` expands to `font-family: initial !important`
       and every other longhand. Without !important on font-family below,
       the !important initial wins the cascade and the body text falls back
       to the user-agent default (Times New Roman). Mark both !important. */
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
    state = {
      host, shadow,
      catIdx: 0, rowIdx: 0,
      filter: "",
      mru: [], closed: [],
      currentWindowId: null,
      // JetBrains-style: pre-select the row right after the active tab on
      // first render, so a single Enter switches back. Once user nav
      // happens (arrows / Cmd+E cycle / click / filter input), respect it.
      firstRender: true
    };
    wire();
    refresh();
  }

  function closeModal() {
    if (!state) return;
    try { document.removeEventListener("keydown", state.kd, true); } catch {}
    try { document.removeEventListener("keyup",   state.ku, true); } catch {}
    try { state.host.remove(); } catch {}
    state = null;
  }

  function html() {
    return `
      <div class="overlay">
        <div class="modal" role="dialog" aria-modal="true" aria-label="Recent Tabs">
          <div class="header">
            <div class="title">zpwrchrome // recent</div>
            <input class="search" type="search" placeholder="filter // url, title, host" autocomplete="off">
            <div class="hint">${navigator.platform.includes("Mac") ? "⌘E" : "Ctrl+E"} cycle · Esc close</div>
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
            <span><kbd>⌘1–6</kbd>category</span>
            <span><kbd>⌫</kbd>close tab</span>
            <span><kbd>Esc</kbd>cancel</span>
          </div>
        </div>
      </div>
    `;
  }

  function wire() {
    const { shadow } = state;
    const search = shadow.querySelector(".search");
    search.addEventListener("input", (e) => {
      state.filter = e.target.value;
      state.rowIdx = 0;
      render();
    });
    // Stop the host page from stealing focus while typing.
    search.addEventListener("keydown", (e) => e.stopPropagation());
    setTimeout(() => search.focus(), 0);

    shadow.querySelectorAll(".cat").forEach((el) => {
      el.addEventListener("click", () => {
        state.catIdx = Number(el.dataset.idx);
        state.rowIdx = 0;
        render();
      });
    });

    shadow.querySelector(".overlay").addEventListener("mousedown", (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    state.kd = (e) => handleKey(e);
    state.ku = (e) => handleKeyUp(e);
    document.addEventListener("keydown", state.kd, true);
    document.addEventListener("keyup",   state.ku, true);
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
      if (state.firstRender) {
        const items = currentList();
        const i = items.findIndex((t) => t.active);
        state.rowIdx = i >= 0 && i + 1 < items.length ? i + 1 : 0;
        state.firstRender = false;
      }
      render();
    });
  }

  function currentList() {
    const cat = CATEGORIES[state.catIdx];
    const f = state.filter.toLowerCase();
    const match = (t) => {
      if (!f) return true;
      const u = (t.url || "").toLowerCase();
      const ti = (t.title || "").toLowerCase();
      let host = "";
      try { host = new URL(t.url).hostname.toLowerCase(); } catch {}
      return u.includes(f) || ti.includes(f) || host.includes(f);
    };

    if (cat.id === "closed") {
      return state.closed
        .map((s) => s.tab || s.window?.tabs?.[0])
        .filter(Boolean)
        .filter(match)
        .map((t, i) => ({
          ...t,
          kind: "closed",
          sessionId: state.closed[i].tab?.sessionId || state.closed[i].window?.sessionId
        }));
    }

    let tabs = state.mru.filter(match);
    if      (cat.id === "current") tabs = tabs.filter((t) => t.windowId === state.currentWindowId);
    else if (cat.id === "pinned")  tabs = tabs.filter((t) => t.pinned);
    else if (cat.id === "audible") tabs = tabs.filter((t) => t.audible);
    else if (cat.id === "muted")   tabs = tabs.filter((t) => t.mutedInfo?.muted);
    return tabs.map((t) => ({ ...t, kind: "open" }));
  }

  function render() {
    if (!state) return;
    const { shadow } = state;
    shadow.querySelectorAll(".cat").forEach((el, i) => {
      el.classList.toggle("sel", i === state.catIdx);
    });
    const list = shadow.querySelector(".list");
    const items = currentList();
    if (!items.length) {
      list.innerHTML = `<div class="empty">no matches</div>`;
      return;
    }
    if (state.rowIdx >= items.length) state.rowIdx = items.length - 1;
    if (state.rowIdx < 0) state.rowIdx = 0;
    list.innerHTML = items.map((t, i) => row(t, i, i === state.rowIdx)).join("");
    list.querySelectorAll(".row img.favicon").forEach((img) => {
      img.addEventListener("error", () => { img.style.visibility = "hidden"; });
    });
    list.querySelectorAll(".row").forEach((el) => {
      el.addEventListener("click", () => activate(Number(el.dataset.idx)));
      el.addEventListener("mouseenter", () => {
        state.rowIdx = Number(el.dataset.idx);
        list.querySelectorAll(".row").forEach((r) =>
          r.classList.toggle("sel", Number(r.dataset.idx) === state.rowIdx));
      });
    });
    const sel = list.querySelector(".row.sel");
    if (sel) sel.scrollIntoView({ block: "nearest" });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function row(t, idx, selected) {
    let host = "";
    try { host = new URL(t.url).hostname; } catch {}
    const badges = [];
    if (t.pinned)            badges.push(`<span class="badge pinned">pin</span>`);
    if (t.audible)           badges.push(`<span class="badge audible">audio</span>`);
    if (t.mutedInfo?.muted)  badges.push(`<span class="badge muted">muted</span>`);
    const fav = t.favIconUrl ? `<img class="favicon" src="${escapeHtml(t.favIconUrl)}" referrerpolicy="no-referrer">` : `<span class="favicon"></span>`;
    return `
      <div class="row${selected ? " sel" : ""}${t.active ? " active-tab" : ""}"
           data-idx="${idx}"
           data-kind="${t.kind}"
           data-tab-id="${t.id ?? ""}"
           data-session-id="${t.sessionId ?? ""}">
        ${fav}
        <div class="title-col">
          <span class="name">${escapeHtml(t.title || t.url || "(untitled)")}</span>
          <span class="path">${escapeHtml(host)}</span>
        </div>
        <div class="badges">${badges.join("")}</div>
      </div>
    `;
  }

  function activate(idx) {
    const items = currentList();
    const t = items[idx];
    if (!t) return;
    if (t.kind === "closed") {
      chrome.runtime.sendMessage({ kind: "restore", sessionId: t.sessionId });
    } else {
      chrome.runtime.sendMessage({ kind: "activate", tabId: t.id });
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

  function handleKey(e) {
    if (!state) return;
    // Cmd+1..6 → category jump
    if ((e.metaKey || e.ctrlKey) && /^[1-6]$/.test(e.key)) {
      e.preventDefault(); e.stopPropagation();
      const n = parseInt(e.key, 10) - 1;
      if (n < CATEGORIES.length) {
        state.catIdx = n; state.rowIdx = 0; render();
      }
      return;
    }
    // Cmd+E (or Ctrl+E): cycle while open
    if ((e.metaKey || e.ctrlKey) && (e.key === "e" || e.key === "E")) {
      e.preventDefault(); e.stopPropagation();
      cycle(e.shiftKey ? -1 : +1);
      return;
    }
    if (e.key === "Escape")     { e.preventDefault(); e.stopPropagation(); closeModal(); return; }
    if (e.key === "ArrowDown")  { e.preventDefault(); e.stopPropagation(); cycle(+1); return; }
    if (e.key === "ArrowUp")    { e.preventDefault(); e.stopPropagation(); cycle(-1); return; }
    if (e.key === "Enter")      { e.preventDefault(); e.stopPropagation(); activate(state.rowIdx); return; }
    if (e.key === "Delete" || e.key === "Backspace") {
      // Mac laptops don't have a real Del key (Fn+Backspace is awkward).
      // Plain Backspace closes the highlighted tab — UNLESS the search
      // input is focused and non-empty, in which case it deletes a char
      // (default browser behavior).
      const search = state.shadow.querySelector(".search");
      const searchFocused = state.shadow.activeElement === search;
      if (e.key === "Backspace" && searchFocused && search.value) {
        return; // let the browser delete a character
      }
      const items = currentList();
      const t = items[state.rowIdx];
      if (t?.kind === "open") {
        e.preventDefault(); e.stopPropagation();
        chrome.runtime.sendMessage({ kind: "close-tab", tabId: t.id }, () => refresh());
      }
      return;
    }
    // Letter keys → focus the search box so typing filters even if search isn't focused.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      state.shadow.querySelector(".search").focus();
    }
  }

  function handleKeyUp(e) {
    // No-op for now. Could be wired to JetBrains-style "release modifier =
    // activate" behavior, but plain Enter already covers it without ambiguity.
  }
})();
