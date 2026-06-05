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
  { id: "history", label: "History",           key: "⌘0" },
  { id: "pass",    label: "Pass",              key: "⌘P" },
  // Cmd+K — Cmd+T is reserved by Chrome for new-tab and cannot be
  // intercepted by an extension popup. K is the common "command palette"
  // binding (VSCode, Slack, Linear) — close enough to the tech-recon vibe.
  { id: "tech",    label: "Tech",              key: "⌘K" }
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
  // PASS — lazily loaded on first entry into the category. matches is a
  // list of entry paths (e.g. "amazon.com/wizard"); host is the active
  // tab's hostname used for the match; loaded flips to true after the
  // first NM call returns (success or empty); err holds the most recent
  // native-host error so the row count can render an actionable banner.
  // PASS — domain-scoped matches load into `matches`. Typing `/` followed
  // by anything switches to whole-store search mode (browserpass-style):
  // the host-side `pass.search` op streams subsequence-scored results into
  // `searchResults`. `searchQuery` is the last query we asked the host for,
  // used to dedupe redundant NM calls per keystroke.
  pass: {
    matches: [],
    host: "",
    loaded: false,
    err: null,
    searchResults: [],
    searchQuery: null,
    searching: false
  },
  // Wappalyzer tech detection — lazily loaded for the active tab when
  // the user enters the Tech category. `hits` is sorted by category +
  // confidence; `categories` is the upstream id→meta map.
  tech: {
    loaded: false,
    hits: [],
    categories: {},
    err: null,
  }
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
    // state.history arrives already frecency-sorted (recent + frequent first)
    // from background.js's history-list handler. Carry frecency forward so
    // the fzf sort below can use it as a tiebreaker.
    items = state.history.map((h) => ({
      kind: "history",
      url: h.url,
      title: h.title,
      lastVisitTime: h.lastVisitTime,
      visitCount: h.visitCount,
      frecency: h.frecency,
    }));
  } else if (cat.id === "tech") {
    if (!state.tech.loaded) {
      loadTech();
      return [];
    }
    const f = state.filter.toLowerCase();
    return state.tech.hits
      .filter((h) => !f
        || h.name.toLowerCase().includes(f)
        || (h.cats || []).some((c) => (state.tech.categories[c]?.name || "").toLowerCase().includes(f)))
      .map((h) => ({
        kind:  "tech",
        name:  h.name,
        title: h.name,
        version: h.version || "",
        confidence: h.confidence || 0,
        cats: (h.cats || []).map((c) => state.tech.categories[c]?.name).filter(Boolean),
        url:   h.website || "",
      }));
  } else if (cat.id === "pass") {
    if (!state.pass.loaded) {
      loadPass();
      return [];
    }
    // Slash-prefix → whole-store search mode (browserpass convention).
    if (state.filter.startsWith("/")) {
      const q = state.filter.slice(1);
      if (q !== state.pass.searchQuery) loadPassSearch(q);
      return state.pass.searchResults.map((m) => ({
        kind: "pass",
        path: m.path,
        store: m.store,
        title: m.path,
        url: "search",
        searchMode: true
      }));
    }
    const f = state.filter.toLowerCase();
    return state.pass.matches
      .filter((m) => !f || m.path.toLowerCase().includes(f))
      .map((m) => ({
        kind: "pass",
        path: m.path,
        store: m.store,
        title: m.path,
        url: state.pass.host || ""
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
  // Primary sort: fzf score. Tiebreaker: frecency (set on history rows by
  // background.js; undefined → 0 elsewhere so non-history sorts unchanged).
  scored.sort((a, b) => (b._score - a._score) || ((b.frecency ?? 0) - (a.frecency ?? 0)));
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

  const techHeader = (cat.id === "tech" && state.tech.loaded && state.tech.hits.length) ? `
    <div class="tech-header">
      <span class="tech-count">${state.tech.hits.length} technolog${state.tech.hits.length === 1 ? "y" : "ies"} detected</span>
      <a href="#" id="tech-export" class="tech-export-link" title="Export as JSON (Cmd+E)">⤓ export</a>
    </div>
  ` : "";

  if (!items.length) {
    if (cat.id === "pass") {
      let passMsg;
      if (!state.pass.loaded)  passMsg = `searching ${escapeHtml(state.pass.host || "…")}`;
      else if (state.pass.err) passMsg = `native host: ${escapeHtml(state.pass.err)} — run cargo install zpwrchrome-host &amp;&amp; zpwrchrome-host --install &lt;ext-id&gt;`;
      else                     passMsg = `no pass entries match ${escapeHtml(state.pass.host || "(no host)")}`;
      $list.innerHTML = `<div class="empty">${passMsg}</div>`;
      return;
    }
    if (cat.id === "tech") {
      let msg;
      if (!state.tech.loaded)  msg = "detecting…";
      else if (state.tech.err) msg = `tech detect: ${escapeHtml(state.tech.err)}`;
      else                     msg = "no technologies detected on this page";
      $list.innerHTML = `<div class="empty">${msg}</div>`;
      return;
    }
    $list.innerHTML = saveForm + techHeader + `<div class="empty">${isScenes ? "no scenes saved yet" : "no matches"}</div>`;
    if (isScenes) wireSceneForm();
    return;
  }
  if (state.rowIdx >= items.length) state.rowIdx = items.length - 1;
  if (state.rowIdx < 0) state.rowIdx = 0;

  $list.innerHTML = saveForm + techHeader + items.map((t, i) => {
    if (t.kind === "tech") {
      const name    = escapeHtml(t.name);
      const ver     = t.version ? `<span class="tech-version">${escapeHtml(t.version)}</span>` : "";
      const cats    = (t.cats || []).map((c) => `<span class="tech-cat">${escapeHtml(c)}</span>`).join("");
      const conf    = t.confidence < 100 ? `<span class="tech-conf">${t.confidence}%</span>` : "";
      const site    = t.url ? `<a href="${escapeHtml(t.url)}" class="tech-link" target="_blank" rel="noopener" title="${escapeHtml(t.url)}">↗</a>` : "";
      return `
        <div class="row tech-row${i === state.rowIdx ? " sel" : ""}"
             data-idx="${i}" data-kind="tech">
          <span class="favicon tech-glyph">⚙</span>
          <div class="title-col">
            <span class="name">${name}${ver}${conf}</span>
            <span class="path">${cats || "&nbsp;"}</span>
          </div>
          <div class="badges">${site}</div>
        </div>
      `;
    }
    if (t.kind === "pass") {
      const pth   = escapeHtml(t.path);
      const store = escapeHtml(t.store || "");
      const storeBadge = store
        ? `<span class="pass-store-badge" title="store: ${store}">${store}</span>`
        : "";
      const dataset = `data-path="${pth}" data-store="${store}"`;
      return `
        <div class="row pass-row${i === state.rowIdx ? " sel" : ""}"
             data-idx="${i}" data-kind="pass" ${dataset}>
          <span class="favicon pass-glyph">⛀</span>
          <div class="title-col">
            <span class="name">${storeBadge}${pth}</span>
            <span class="path">pass · ${escapeHtml(t.url)}</span>
          </div>
          <div class="badges pass-badges">
            <button class="badge pass-fill-btn"  ${dataset} title="fill login form on active tab">fill</button>
            <button class="badge pass-go-btn"    ${dataset} title="open url from entry (shift = new tab)">go</button>
            <button class="badge pass-copy-user" ${dataset} title="copy username">user</button>
            <button class="badge pass-copy-pw"   ${dataset} title="copy password">pw</button>
            <button class="badge pass-copy-otp"  ${dataset} title="copy OTP">otp</button>
          </div>
        </div>
      `;
    }
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
  $list.querySelectorAll(".pass-fill-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ kind: "pass.fill", path: btn.dataset.path, store: btn.dataset.store || undefined }, (r) => {
        if (chrome.runtime.lastError || !r?.ok) {
          flashButton(btn, false, "fill");
          return;
        }
        flashButton(btn, true, "fill");
        setTimeout(() => window.close(), 300);
      });
    });
  });
  $list.querySelectorAll(".pass-go-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const newTab = e.shiftKey || e.metaKey || e.ctrlKey;
      chrome.runtime.sendMessage({ kind: "pass.openUrl", path: btn.dataset.path, store: btn.dataset.store || undefined, newTab }, (r) => {
        if (chrome.runtime.lastError || !r?.ok) {
          flashButton(btn, false, "go");
          return;
        }
        flashButton(btn, true, "go");
        setTimeout(() => window.close(), 200);
      });
    });
  });
  // Copy buttons route through the SW's `pass.copyField` bridge, which
  // fetches the entry and writes via the active tab's clipboard. Doing
  // the writeText() in the popup itself drops the user-gesture window
  // across the SW + NM + GPG round-trip — Chrome silently no-ops.
  const wireCopyBtn = (selector, field, label) => {
    $list.querySelectorAll(selector).forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage(
          { kind: "pass.copyField", path: btn.dataset.path, store: btn.dataset.store || undefined, field },
          (r) => {
            if (chrome.runtime.lastError || !r?.ok) {
              console.warn("[zpwrchrome] pass.copyField", field, ":",
                chrome.runtime.lastError?.message || r?.err || "(no response)");
              flashButton(btn, false, label);
              return;
            }
            flashButton(btn, true, label);
          },
        );
      });
    });
  };
  wireCopyBtn(".pass-copy-pw",   "password", "pw");
  wireCopyBtn(".pass-copy-user", "username", "user");
  wireCopyBtn(".pass-copy-otp",  "otp",      "otp");
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
  const exportLink = document.getElementById("tech-export");
  if (exportLink) {
    exportLink.addEventListener("click", (ev) => {
      ev.preventDefault();
      exportTechAsJson();
    });
  }
  const sel = $list.querySelector(".row.sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}

// Export the detected stack as JSON + CSV. Triggered by the popup's
// `[⤓ export]` link (Tech category header) or Cmd/Ctrl+E while the
// Tech category is active. Mirrors Wappalyzer's own export — name,
// version, confidence, categories, website per row.
function exportTechAsJson() {
  if (!state.tech.loaded || !state.tech.hits.length) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const t = tabs?.[0];
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const hostSafe = host(t?.url || "").replace(/[^a-z0-9.-]/gi, "_") || "page";
    const rows = state.tech.hits.map((h) => ({
      name:       h.name,
      version:    h.version || "",
      confidence: h.confidence,
      categories: (h.cats || []).map((c) => state.tech.categories[c]?.name).filter(Boolean),
      website:    h.url || "",
    }));
    const payload = {
      exportedAt: new Date().toISOString(),
      url:        t?.url || "",
      title:      t?.title || "",
      technologies: rows,
    };
    const json = JSON.stringify(payload, null, 2);
    chrome.downloads?.download?.({
      url:      "data:application/json;charset=utf-8," + encodeURIComponent(json),
      filename: `tech-${hostSafe}-${stamp}.json`,
      saveAs:   true,
    });
  });
}

function loadTech() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs?.[0]?.id;
    if (typeof tabId !== "number") {
      state.tech.hits = [];
      state.tech.loaded = true;
      state.tech.err = "no active tab";
      render();
      return;
    }
    chrome.runtime.sendMessage({ kind: "tech.detected", tabId }, (r) => {
      if (chrome.runtime.lastError) {
        state.tech.hits = [];
        state.tech.err = chrome.runtime.lastError.message;
      } else if (r?.ok) {
        // Sort hits by category priority (lowest first) → name asc.
        const cats = state.tech.categories = r.categories || {};
        const sortKey = (h) => {
          const c = (h.cats || [])[0];
          const p = c != null ? (cats[c]?.priority ?? 99) : 99;
          return [p, h.name];
        };
        state.tech.hits = (r.hits || []).slice().sort((a, b) => {
          const [ap, an] = sortKey(a); const [bp, bn] = sortKey(b);
          return ap - bp || an.localeCompare(bn);
        });
        state.tech.err = null;
      } else {
        state.tech.hits = [];
        state.tech.err = r?.err || "detection failed";
      }
      state.tech.loaded = true;
      render();
    });
  });
}

function loadPass() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const h = host(tabs?.[0]?.url || "");
    state.pass.host = h;
    if (!h) {
      state.pass.matches = [];
      state.pass.loaded = true;
      state.pass.err = "no host for active tab";
      render();
      return;
    }
    chrome.runtime.sendMessage({ kind: "pass.match", host: h }, (r) => {
      if (chrome.runtime.lastError) {
        state.pass.matches = [];
        state.pass.err = chrome.runtime.lastError.message;
      } else if (r?.ok) {
        state.pass.matches = Array.isArray(r.matches) ? r.matches : [];
        state.pass.err = null;
      } else {
        state.pass.matches = [];
        state.pass.err = r?.err || "native host error";
      }
      state.pass.loaded = true;
      render();
    });
  });
}

function loadPassSearch(query) {
  state.pass.searchQuery = query;
  state.pass.searching = true;
  chrome.runtime.sendMessage({ kind: "pass.search", query }, (r) => {
    state.pass.searching = false;
    if (chrome.runtime.lastError) {
      state.pass.searchResults = [];
      state.pass.err = chrome.runtime.lastError.message;
    } else if (r?.ok) {
      state.pass.searchResults = Array.isArray(r.matches) ? r.matches : [];
      state.pass.err = null;
    } else {
      state.pass.searchResults = [];
      state.pass.err = r?.err || "search failed";
    }
    render();
  });
}

function passFetch(path, store, cb) {
  chrome.runtime.sendMessage({ kind: "pass.fetch", path, store: store || undefined }, (r) => {
    if (chrome.runtime.lastError) { cb(new Error(chrome.runtime.lastError.message), null); return; }
    if (!r?.ok) { cb(new Error(r?.err || "fetch failed"), null); return; }
    cb(null, r.data || {});
  });
}

function passOtpFetch(path, store, cb) {
  chrome.runtime.sendMessage({ kind: "pass.otp", path, store: store || undefined }, (r) => {
    if (chrome.runtime.lastError) { cb(new Error(chrome.runtime.lastError.message), null); return; }
    if (!r?.ok) { cb(new Error(r?.err || "otp failed"), null); return; }
    cb(null, r.otp || "");
  });
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function flashButton(btn, ok, restore) {
  const orig = btn.textContent;
  btn.textContent = ok ? "✓" : "✗";
  btn.classList.toggle("pass-ok",  ok);
  btn.classList.toggle("pass-err", !ok);
  setTimeout(() => {
    btn.textContent = restore || orig;
    btn.classList.remove("pass-ok", "pass-err");
  }, 800);
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
}

function loadHistory(done) {
  // Both popup and modal go through background.js `history-list` so there's
  // one code path. Content scripts can't reach chrome.history directly in
  // MV3 — routing through the SW is the shared point of truth.
  chrome.runtime.sendMessage(
    { kind: "history-list", maxResults: HISTORY_MAX_RESULTS },
    (resp) => {
      state.history = resp?.history || [];
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
  // Cmd/Ctrl+P → Pass category. Mnemonic, and the popup has no use for
  // the browser's Print binding. Tab is left alone for normal focus
  // traversal between the search box and other focusable elements.
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === "p" || e.key === "P")) {
    const passIdx = CATEGORIES.findIndex((c) => c.id === "pass");
    if (passIdx >= 0) {
      e.preventDefault();
      state.catIdx = passIdx;
      state.rowIdx = 0;
      render();
      return;
    }
  }
  // Cmd/Ctrl+K → jump to Tech category. Cmd+T would be the "natural"
  // mnemonic but Chrome reserves it for new-tab and the popup can't
  // intercept it.
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === "k" || e.key === "K")) {
    const techIdx = CATEGORIES.findIndex((c) => c.id === "tech");
    if (techIdx >= 0) {
      e.preventDefault();
      state.catIdx = techIdx;
      state.rowIdx = 0;
      render();
      return;
    }
  }
  // Cmd/Ctrl+E in the Tech category → export detected stack as JSON.
  // (Cmd+E in other categories stays bound to "switch-previous-tab"
  // by Chrome, but the popup won't see that — Cmd+E to the popup means
  // the popup is focused.)
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === "e" || e.key === "E")
      && CATEGORIES[state.catIdx].id === "tech") {
    e.preventDefault();
    exportTechAsJson();
    return;
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
      // Background's history-delete wraps chrome.history.deleteUrl, which
      // removes ALL visits to this URL — what the user wants for an
      // fzf-history sweep (one stroke = gone).
      e.preventDefault();
      chrome.runtime.sendMessage({ kind: "history-delete", url: t.url }, () => {
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

document.getElementById("open-downloads").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("scripts-manager/downloads.html") });
  window.close();
});

document.getElementById("open-pass").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("scripts-manager/pass.html") });
  window.close();
});

// ── bottom downloads strip (always-visible glance) ────────────────────
//
// Reuses the SW's cached dl.snapshot for an instant first paint, then
// asks for a fresh dl.list. Repolls every 1 s while the popup is open
// so active progress / completion / fail status updates without the user
// having to leave the popup. Strip auto-hides when there's nothing to show.

const STRIP_MAX_ROWS = 6;
const $strip        = document.getElementById("dl-strip");
const $stripList    = document.getElementById("dl-strip-list");
const $stripResizer = document.getElementById("dl-strip-resizer");
const $stripCount  = document.getElementById("dl-strip-count");
const $stripOpen   = document.getElementById("dl-strip-open");
const STRIP_ICONS  = { image:"🖼", video:"🎬", audio:"🎵", document:"📄", archive:"🗂", other:"📦" };
const STRIP_EXT = {
  image:    new Set(["jpg","jpeg","png","gif","webp","svg","bmp","ico","tiff","heic","avif"]),
  video:    new Set(["mp4","mkv","avi","mov","webm","flv","m4v","wmv","ts","vob"]),
  audio:    new Set(["mp3","wav","flac","aac","ogg","m4a","opus","wma","alac"]),
  document: new Set(["pdf","doc","docx","xls","xlsx","ppt","pptx","odt","ods","odp","txt","md","rtf","csv","epub","mobi"]),
  archive:  new Set(["zip","tar","gz","bz2","xz","7z","rar","tgz","tbz","tbz2","z","lz","lzma","cab","iso","dmg"]),
};
function stripKind(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  for (const [k, set] of Object.entries(STRIP_EXT)) if (set.has(ext)) return k;
  return "other";
}
function stripBasename(p) { return (p || "").split("/").pop() || p || ""; }
function stripDur(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 60)   return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec/60)}m ${Math.round(sec%60)}s`;
  return `${Math.floor(sec/3600)}h ${Math.floor((sec%3600)/60)}m`;
}
function stripSpeed(bytes, ms) {
  if (!ms || ms <= 0) return "—";
  return `${stripBytes((bytes * 1000) / ms)}/s`;
}
function stripEta(done, total, bytesPerSec) {
  if (!total || total <= done) return "—";
  if (!bytesPerSec)            return "—";
  return stripDur((total - done) / bytesPerSec);
}
function stripElapsed(ms) {
  return stripDur(Math.max(0, Number(ms) || 0) / 1000);
}
function stripBytes(n) {
  if (!n || n <= 0) return "0 B";
  const u = ["B","KB","MB","GB","TB"]; let i = 0, v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
function stripEsc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}
function renderStrip(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    $strip.hidden = true;
    if ($stripResizer) $stripResizer.hidden = true;
    return;
  }
  if ($stripResizer) $stripResizer.hidden = false;
  // Sort active/pending/paused first, then by recency.
  const ord = { pending: 0, active: 1, paused: 2, failed: 3, cancelled: 4, done: 5 };
  const sorted = jobs.slice().sort((a, b) => (ord[a.status] ?? 9) - (ord[b.status] ?? 9) || b.gid - a.gid);
  const shown = sorted.slice(0, STRIP_MAX_ROWS);
  const active = jobs.filter((j) => j.status === "active" || j.status === "pending").length;
  $stripCount.textContent = active > 0
    ? `${active} active · ${jobs.length} total`
    : `${jobs.length} total`;
  $stripList.innerHTML = shown.map((j) => {
    const name = stripBasename(j.dest);
    const kind = stripKind(name);
    const ico  = STRIP_ICONS[kind] || "📄";
    const pct  = j.total > 0 ? Math.min(100, Math.round((j.done / j.total) * 100)) : 0;
    const destOnDisk = j.dest_exists !== false;
    const isMissing  = j.status === "done" && !destOnDisk;
    const cls = `dl-strip-row k-${kind}${isMissing ? " missing" : ""}`;
    const tag = isMissing
      ? `<span class="tag missing">missing</span>`
      : `<span class="tag ${stripEsc(j.status)}">${stripEsc(j.status)}</span>`;
    const showBar = j.status === "active" || j.status === "paused" || j.status === "pending";
    const rightStr = j.status === "done"
      ? stripBytes(j.done)
      : (j.total > 0 ? `${pct}%` : stripBytes(j.done));
    const subStr = j.total > 0
      ? `${stripBytes(j.done)} / ${stripBytes(j.total)}`
      : (j.status === "done" ? stripBytes(j.done) : "—");
    // Speed / ETA / elapsed — surfaced on the meta line. Active downloads
    // get all three (live values); paused gets size + elapsed; done gets
    // the final size + total elapsed; everything else just gets the tag
    // and size summary above.
    const bps = j.elapsed_ms > 0 ? (j.done * 1000) / j.elapsed_ms : 0;
    const rateStr = (j.status === "active") ? stripSpeed(j.done, j.elapsed_ms) : "";
    const etaStr  = (j.status === "active") ? stripEta(j.done, j.total, bps)   : "";
    const elpStr  = (j.status === "active" || j.status === "paused" || j.status === "done")
      ? stripElapsed(j.elapsed_ms)
      : "";
    const metaExtras = [
      rateStr ? `<span class="spd">${stripEsc(rateStr)}</span>`        : "",
      etaStr  ? `<span class="eta">ETA ${stripEsc(etaStr)}</span>`     : "",
      elpStr  ? `<span class="elp">${stripEsc(elpStr)} elapsed</span>` : "",
    ].filter(Boolean).join("");
    // Per-row action buttons. Status drives which appear:
    //   pending|active   → pause + cancel
    //   paused           → resume + cancel
    //   failed|cancelled → retry
    //   done + present   → open (default app) + reveal (parent dir)
    //   done + missing   → no buttons (file no longer there)
    const acts = [];
    if (j.status === "active" || j.status === "pending") {
      acts.push(`<button class="act" data-act="pause"  data-gid="${j.gid}" title="Pause">⏸</button>`);
      acts.push(`<button class="act danger" data-act="cancel" data-gid="${j.gid}" title="Cancel">✕</button>`);
    } else if (j.status === "paused") {
      acts.push(`<button class="act" data-act="resume" data-gid="${j.gid}" title="Resume">▶</button>`);
      acts.push(`<button class="act danger" data-act="cancel" data-gid="${j.gid}" title="Cancel">✕</button>`);
    } else if (j.status === "failed" || j.status === "cancelled") {
      acts.push(`<button class="act" data-act="resume" data-gid="${j.gid}" title="Retry">↻</button>`);
    } else if (j.status === "done" && destOnDisk) {
      acts.push(`<button class="act" data-act="open"   data-dest="${stripEsc(j.dest)}" title="Open file with default app">↗</button>`);
      acts.push(`<button class="act" data-act="reveal" data-dest="${stripEsc(j.dest)}" title="Reveal in Finder">📁</button>`);
    }
    // Remove-row button — works on every status. Cancels the underlying job
    // if it's still in flight (best-effort, ignores host error), then drops
    // the state file via dl.clear with the row's gid. The disk file is left
    // alone so the user keeps any partial bytes already downloaded.
    acts.push(`<button class="act danger" data-act="remove" data-gid="${j.gid}" title="Remove from list (does NOT delete the file)">🗑</button>`);
    const actHtml = acts.length ? `<div class="acts">${acts.join("")}</div>` : "";

    return `
      <div class="${cls}" data-gid="${j.gid}" data-dest="${stripEsc(j.dest || "")}" data-status="${stripEsc(j.status)}">
        <span class="ic">${ico}</span>
        <div class="body">
          <span class="nm" title="${stripEsc(j.dest || "")}">${stripEsc(name || "(unnamed)")}</span>
          <div class="meta">${tag}<span class="sz">${stripEsc(subStr)}</span>${metaExtras}</div>
          ${showBar ? `<div class="bar"><div class="fill" style="width:${pct}%;"></div></div>` : ""}
        </div>
        ${actHtml}
        <span class="right">${stripEsc(rightStr)}</span>
      </div>
    `;
  }).join("");
  $strip.hidden = false;
}
$stripList.addEventListener("click", (e) => {
  // Per-row action button — pause/resume/cancel/open/reveal via existing
  // SW handlers. open + reveal carry a `data-dest` path (not a gid); the
  // others carry a gid.
  const btn = e.target.closest("button.act");
  if (btn) {
    e.stopPropagation();
    const act = btn.dataset.act;
    if (act === "open" || act === "reveal") {
      const dest = btn.dataset.dest || "";
      const kind = act === "open" ? "dl.openFile" : "dl.openDir";
      btn.disabled = true;
      chrome.runtime.sendMessage({ kind, path: dest }, () => { btn.disabled = false; });
      return;
    }
    const gid = Number(btn.dataset.gid);
    if (!act || !Number.isFinite(gid)) return;
    btn.disabled = true;
    chrome.runtime.sendMessage({ kind: `dl.${act}`, gid }, () => {
      btn.disabled = false;
      // Refresh immediately so the strip reflects the new state without
      // waiting for the 1 s poll tick.
      pollStrip();
    });
    return;
  }
  const row = e.target.closest(".dl-strip-row");
  if (!row) return;
  const status = row.dataset.status || "";
  const dest   = row.dataset.dest   || "";
  // Done + present → open the file; otherwise jump to the manager.
  if (status === "done" && dest) {
    chrome.runtime.sendMessage({ kind: "dl.openFile", path: dest }, () => {
      window.close();
    });
    return;
  }
  chrome.tabs.create({ url: chrome.runtime.getURL("scripts-manager/downloads.html") });
  window.close();
});
$stripOpen?.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("scripts-manager/downloads.html") });
  window.close();
});

function pollStrip() {
  chrome.runtime.sendMessage({ kind: "dl.list" }, (r) => {
    if (chrome.runtime.lastError || !r?.ok) return;       // silent — popup keeps working
    renderStrip(r.jobs || []);
  });
}
// Instant paint from cached snapshot, then refresh + repeat.
chrome.runtime.sendMessage({ kind: "dl.snapshot.cached" }, (r) => {
  if (r?.snapshot?.jobs) renderStrip(r.snapshot.jobs);
  pollStrip();
});
setInterval(pollStrip, 1000);

// ── resizable downloads strip ────────────────────────────────────────
// Drag the handle just above the strip up/down to grow/shrink. Bounded
// by the CSS min-height (60px) and max-height (420px). Persisted to
// chrome.storage.local["dl.popupStripHeight"] so subsequent popups
// remember the user's chosen size.
const STRIP_HEIGHT_KEY = "dl.popupStripHeight";
const STRIP_MIN = 60;
const STRIP_MAX = 420;
function clampHeight(px) { return Math.max(STRIP_MIN, Math.min(STRIP_MAX, px)); }

chrome.storage.local.get("dl.popupStripHeight", (bag) => {
  const h = Number(bag?.[STRIP_HEIGHT_KEY]);
  if (Number.isFinite(h) && h > 0) $strip.style.height = clampHeight(h) + "px";
});

let _dragStartY = 0;
let _dragStartH = 0;
function onDragMove(e) {
  // Drag direction: moving the handle UP (negative dy) grows the strip.
  const dy = e.clientY - _dragStartY;
  const next = clampHeight(_dragStartH - dy);
  $strip.style.height = next + "px";
}
function onDragEnd() {
  $stripResizer.classList.remove("dragging");
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("mouseup",   onDragEnd);
  document.body.style.cursor = "";
  const px = parseFloat($strip.style.height) || 0;
  chrome.storage.local.set({ [STRIP_HEIGHT_KEY]: clampHeight(px) });
}
$stripResizer.addEventListener("mousedown", (e) => {
  e.preventDefault();
  _dragStartY = e.clientY;
  _dragStartH = $strip.offsetHeight;
  $stripResizer.classList.add("dragging");
  document.body.style.cursor = "ns-resize";
  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("mouseup",   onDragEnd);
});
// Double-click resets to the default 180.
$stripResizer.addEventListener("dblclick", () => {
  $strip.style.height = "180px";
  chrome.storage.local.set({ [STRIP_HEIGHT_KEY]: 180 });
});

// ── clipboard URL monitor — checks once on popup open ─────────────────
// Opening the popup IS a user gesture, so navigator.clipboard.readText()
// resolves without prompting. Surface an inline banner when the clipboard
// holds an http(s) URL that isn't already queued. Tied to
// dl.settings.urlFromClipboard (default ON).
function maybeOfferClipboardUrl() {
  chrome.runtime.sendMessage({ kind: "dl.settings.get" }, (r) => {
    if (chrome.runtime.lastError) return;
    if (r?.settings && r.settings.urlFromClipboard === false) return;
    navigator.clipboard.readText().then((raw) => {
      const text = (raw || "").trim();
      if (!/^https?:\/\//i.test(text)) return;
      const known = new Set((state?.jobs || []).map((j) => j.url));
      if (known.has(text)) return;
      showClipboardBanner(text);
    }).catch(() => {});
  });
}
maybeOfferClipboardUrl();

function showClipboardBanner(url) {
  // Inject above the strip — once. If a banner already exists, replace
  // its URL so we don't stack multiple.
  let banner = document.getElementById("dl-clip-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "dl-clip-banner";
    banner.className = "dl-clip-banner";
    $strip.parentNode.insertBefore(banner, $strip);
  }
  banner.innerHTML = `
    <span class="lbl">clipboard:</span>
    <span class="url" title="${url.replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}">${url.length > 60 ? url.slice(0, 60) + "…" : url}</span>
    <button class="add">add</button>
    <button class="dismiss">×</button>
  `;
  banner.querySelector(".add").addEventListener("click", () => {
    chrome.runtime.sendMessage({ kind: "dl.add", url }, () => {
      banner.remove();
      pollStrip();
    });
  });
  banner.querySelector(".dismiss").addEventListener("click", () => banner.remove());
}

refresh();
