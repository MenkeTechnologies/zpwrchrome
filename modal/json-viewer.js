// zpwrchrome — JSON formatter content script.
//
// Auto-detects when the active page is a JSON document (response
// Content-Type or a `.json` URL or the body parses as JSON) and
// replaces the raw `<pre>` blob Chrome ships with a syntax-highlit,
// collapsible tree. Adds a toolbar with copy / minify / raw toggle.
//
// No imports — content scripts are self-contained. The pure formatter
// helpers in lib/json-format.js are duplicated here in minimized form.

(function () {
  "use strict";

  // ─── Auto-detect ─────────────────────────────────────────────────
  // Skip if not in a top frame, or already processed, or clearly not
  // a JSON page. The body-text parse is the strongest signal — many
  // servers don't set Content-Type correctly but the bytes parse fine.
  if (window.top !== window.self) return;
  if (document.documentElement?.dataset?.zpwrJsonViewer === "1") return;

  const pre = document.body?.querySelector?.("pre");
  // The page must be just a `<pre>` (Chrome's default JSON / plain-text
  // rendering) or have JSON content-type. Skip rich pages.
  const ctype = String(document.contentType || "").toLowerCase();
  const isJsonCt = /json/.test(ctype);
  const isJsonExt = /\.json($|\?)/i.test(location.pathname);

  if (!pre && !isJsonCt && !isJsonExt) return;
  const raw = (pre?.textContent ?? document.body?.textContent ?? "").trim();
  if (!raw) return;

  // Cheap pre-check before paying for JSON.parse.
  const head = raw[0];
  const looksJson =
    head === "{" || head === "[" || head === '"' ||
    head === "-" || (head >= "0" && head <= "9") ||
    raw.startsWith("true") || raw.startsWith("false") || raw.startsWith("null");
  if (!looksJson && !isJsonCt) return;

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return; }    // bail silently — leave the page alone

  // ─── Render ──────────────────────────────────────────────────────
  document.documentElement.dataset.zpwrJsonViewer = "1";
  injectStyles();
  buildPage(parsed, raw);

  // ─── Style injection ─────────────────────────────────────────────
  function injectStyles() {
    const css = `
      :root { color-scheme: dark; }
      html, body {
        margin: 0; padding: 0;
        background: #05050a; color: #e0f0ff;
        font-family: 'Share Tech Mono', 'SF Mono', 'Fira Code', monospace;
        font-size: 13px;
      }
      .zpwr-jv-toolbar {
        display: flex; align-items: center; gap: 8px;
        background: #0a0a14; border-bottom: 1px solid #1a1a3e;
        padding: 8px 14px;
        position: sticky; top: 0; z-index: 10;
      }
      .zpwr-jv-toolbar .zpwr-jv-title {
        font-size: 12px; color: #05d9e8;
        letter-spacing: 1px; text-transform: uppercase; font-weight: 700;
      }
      .zpwr-jv-toolbar .zpwr-jv-stats {
        font-size: 11px; color: #7a8ba8; margin-left: 4px;
      }
      .zpwr-jv-toolbar .grow { flex: 1; }
      .zpwr-jv-toolbar .zpwr-jv-search {
        background: #05050a; border: 1px solid #1a1a3e; color: #e0f0ff;
        font-family: inherit; font-size: 12px;
        padding: 4px 10px; border-radius: 2px; min-width: 220px;
      }
      .zpwr-jv-toolbar .zpwr-jv-search:focus {
        outline: none; border-color: #05d9e8; box-shadow: 0 0 6px rgba(5,217,232,0.4);
      }
      .zpwr-jv-toolbar button {
        background: transparent; color: #7a8ba8;
        border: 1px solid #1a1a3e; border-radius: 2px;
        font-family: inherit; font-size: 11px;
        padding: 4px 10px; cursor: pointer;
        letter-spacing: 0.5px;
      }
      .zpwr-jv-toolbar button:hover {
        color: #05d9e8; border-color: #05d9e8; background: #12122a;
      }
      .zpwr-jv-toolbar button.active {
        color: #ff8c1a; border-color: #ff8c1a;
      }
      .zpwr-jv-toolbar .zpwr-jv-status {
        font-size: 11px; color: #39ff14;
        font-style: italic; margin-left: 4px;
      }

      .zpwr-jv-body { padding: 14px 18px; max-width: 100%; overflow-x: auto; }
      .zpwr-jv-body[hidden] { display: none; }
      .zpwr-jv-raw {
        display: none;
        white-space: pre-wrap; word-break: break-all;
        font-family: inherit; font-size: 12px; color: #e0f0ff;
        background: #05050a;
      }
      .zpwr-jv-raw.active { display: block; }

      .zpwr-jv-row { line-height: 1.55; }
      .zpwr-jv-collapsible > .zpwr-jv-toggle {
        display: inline-block; width: 12px;
        color: #7a8ba8; cursor: pointer; user-select: none;
      }
      .zpwr-jv-collapsible.zpwr-jv-collapsed > .zpwr-jv-children { display: none; }
      .zpwr-jv-collapsible.zpwr-jv-collapsed > .zpwr-jv-preview { color: #7a8ba8; font-style: italic; }
      .zpwr-jv-children {
        margin-left: 16px;
        border-left: 1px dotted #1a1a3e; padding-left: 8px;
      }

      .zpwr-jv-key  { color: #ff8c1a; }
      .zpwr-jv-str  { color: #39ff14; }
      .zpwr-jv-num  { color: #05d9e8; }
      .zpwr-jv-bool { color: #d300c5; font-weight: 700; }
      .zpwr-jv-null { color: #d300c5; font-style: italic; }
      .zpwr-jv-brace, .zpwr-jv-bracket, .zpwr-jv-comma, .zpwr-jv-colon { color: #7a8ba8; }
      .zpwr-jv-str a { color: #39ff14; text-decoration: underline; }
      .zpwr-jv-str a:hover { color: #ff8c1a; }

      .zpwr-jv-search-hit { background: #ff8c1a; color: #05050a; padding: 0 2px; border-radius: 1px; }
      .zpwr-jv-row.search-match { background: rgba(255,140,26,0.08); }

      .zpwr-jv-copy-path {
        opacity: 0; cursor: pointer;
        display: inline-block; margin-left: 8px;
        font-size: 10px; color: #7a8ba8;
        border: 1px solid #1a1a3e; border-radius: 2px;
        padding: 0 4px;
      }
      .zpwr-jv-row:hover > .zpwr-jv-copy-path { opacity: 1; }
      .zpwr-jv-copy-path:hover { color: #05d9e8; border-color: #05d9e8; }
    `;
    const s = document.createElement("style");
    s.id = "zpwr-jv-styles";
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ─── Page assembly ───────────────────────────────────────────────
  function buildPage(value, rawText) {
    // Wipe + replace body — leaves <head> alone so any tab title set by
    // the server stays.
    document.body.innerHTML = "";

    const toolbar = document.createElement("div");
    toolbar.className = "zpwr-jv-toolbar";

    const title = document.createElement("span");
    title.className = "zpwr-jv-title";
    title.textContent = "zpwrchrome // json";

    const stats = document.createElement("span");
    stats.className = "zpwr-jv-stats";
    stats.textContent = ` · ${nodeCount(value)} nodes · ${byteSize(rawText)} bytes`;

    const search = document.createElement("input");
    search.className = "zpwr-jv-search";
    search.type = "search";
    search.placeholder = "filter keys / values…";

    const btnCopy = mkBtn("⧉ copy",       () => copyText(JSON.stringify(value, null, 2), btnCopy));
    const btnMin  = mkBtn("⌐ minify copy", () => copyText(JSON.stringify(value),          btnMin));
    const btnRaw  = mkBtn("◧ raw",         (b) => toggleRaw(b));
    const btnAll  = mkBtn("▼ expand all",  () => setAllCollapsed(false, btnAll));
    const btnNone = mkBtn("▶ collapse all",() => setAllCollapsed(true,  btnNone));

    const grow = document.createElement("span");
    grow.className = "grow";

    toolbar.append(title, stats, grow, search, btnCopy, btnMin, btnAll, btnNone, btnRaw);
    document.body.appendChild(toolbar);

    const body = document.createElement("pre");
    body.className = "zpwr-jv-body";
    body.appendChild(renderNode(value, []));
    document.body.appendChild(body);

    const raw = document.createElement("pre");
    raw.className = "zpwr-jv-raw";
    raw.textContent = rawText;
    document.body.appendChild(raw);

    // ─── Live filter ─────────────────────────────────────────────
    let lastQuery = "";
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      if (q === lastQuery) return;
      lastQuery = q;
      applySearch(body, q);
    });
    // Keyboard: Ctrl/Cmd+F focuses the search box.
    document.addEventListener("keydown", (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && (ev.key === "f" || ev.key === "F")) {
        ev.preventDefault();
        search.focus();
        search.select();
      }
    });

    // ─── Raw toggle ──────────────────────────────────────────────
    function toggleRaw(btn) {
      const showingRaw = raw.classList.toggle("active");
      body.hidden = showingRaw;
      btn.classList.toggle("active", showingRaw);
    }
    function setAllCollapsed(collapsed, btn) {
      for (const el of body.querySelectorAll(".zpwr-jv-collapsible")) {
        el.classList.toggle("zpwr-jv-collapsed", collapsed);
      }
      flashStatus(btn, collapsed ? "collapsed" : "expanded");
    }
  }

  // ─── Search highlighter ──────────────────────────────────────────
  function applySearch(body, q) {
    // Drop any prior <mark> wrappers + match flags.
    for (const m of body.querySelectorAll(".zpwr-jv-search-hit")) {
      const parent = m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    }
    for (const r of body.querySelectorAll(".search-match")) r.classList.remove("search-match");
    if (!q) return;
    // For each .zpwr-jv-key or .zpwr-jv-str / .zpwr-jv-num text node,
    // check substring (case-insensitive) and wrap matches.
    const candidates = body.querySelectorAll(".zpwr-jv-key, .zpwr-jv-str, .zpwr-jv-num, .zpwr-jv-bool, .zpwr-jv-null");
    for (const el of candidates) {
      const t = el.textContent.toLowerCase();
      if (!t.includes(q)) continue;
      // Expand all ancestor collapsibles so matches are visible.
      let p = el.parentElement;
      while (p) {
        if (p.classList.contains("zpwr-jv-collapsible")) p.classList.remove("zpwr-jv-collapsed");
        p = p.parentElement;
      }
      // Mark the row.
      const row = el.closest(".zpwr-jv-row");
      if (row) row.classList.add("search-match");
      // Wrap each occurrence in a <span>.
      wrapMatches(el, q);
    }
  }

  function wrapMatches(el, q) {
    const orig = el.textContent;
    const lc = orig.toLowerCase();
    let i = 0;
    const frag = document.createDocumentFragment();
    while (i < orig.length) {
      const at = lc.indexOf(q, i);
      if (at < 0) {
        frag.appendChild(document.createTextNode(orig.slice(i)));
        break;
      }
      if (at > i) frag.appendChild(document.createTextNode(orig.slice(i, at)));
      const m = document.createElement("span");
      m.className = "zpwr-jv-search-hit";
      m.textContent = orig.slice(at, at + q.length);
      frag.appendChild(m);
      i = at + q.length;
    }
    el.innerHTML = "";
    el.appendChild(frag);
  }

  // ─── Node renderer ───────────────────────────────────────────────
  function renderNode(value, path) {
    if (value === null)             return primitive("null",  "null");
    if (typeof value === "boolean") return primitive(String(value), "bool");
    if (typeof value === "number")  return primitive(String(value), "num");
    if (typeof value === "string")  return renderString(value);
    if (Array.isArray(value))       return renderArray(value, path);
    if (typeof value === "object")  return renderObject(value, path);
    return primitive(String(value), "null");
  }
  function primitive(text, cls) {
    const span = document.createElement("span");
    span.className = `zpwr-jv-${cls}`;
    span.textContent = text;
    return span;
  }
  function renderString(s) {
    const span = document.createElement("span");
    span.className = "zpwr-jv-str";
    span.textContent = JSON.stringify(s);
    // Auto-linkify http(s) URLs so users can navigate from inspected
    // payloads without copy-pasting.
    if (/^"https?:\/\//.test(span.textContent)) {
      const url = s;
      span.innerHTML = "";
      span.appendChild(document.createTextNode('"'));
      const a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener";
      a.textContent = url;
      span.appendChild(a);
      span.appendChild(document.createTextNode('"'));
    }
    return span;
  }
  function renderArray(arr, path) {
    const wrap = document.createElement("span");
    wrap.className = "zpwr-jv-collapsible zpwr-jv-arr";
    const toggle = document.createElement("span");
    toggle.className = "zpwr-jv-toggle";
    toggle.textContent = "▼";
    toggle.addEventListener("click", () => wrap.classList.toggle("zpwr-jv-collapsed"));
    wrap.appendChild(toggle);
    wrap.appendChild(bracket("["));
    if (!arr.length) {
      wrap.appendChild(bracket("]"));
      return wrap;
    }
    const preview = document.createElement("span");
    preview.className = "zpwr-jv-preview";
    preview.textContent = ` Array(${arr.length}) `;
    wrap.appendChild(preview);
    const kids = document.createElement("div");
    kids.className = "zpwr-jv-children";
    for (let i = 0; i < arr.length; i++) {
      const row = document.createElement("div");
      row.className = "zpwr-jv-row";
      row.appendChild(renderNode(arr[i], [...path, i]));
      if (i < arr.length - 1) row.appendChild(text(","));
      row.appendChild(mkCopyPath([...path, i]));
      kids.appendChild(row);
    }
    wrap.appendChild(kids);
    wrap.appendChild(bracket("]"));
    return wrap;
  }
  function renderObject(obj, path) {
    const wrap = document.createElement("span");
    wrap.className = "zpwr-jv-collapsible zpwr-jv-obj";
    const toggle = document.createElement("span");
    toggle.className = "zpwr-jv-toggle";
    toggle.textContent = "▼";
    toggle.addEventListener("click", () => wrap.classList.toggle("zpwr-jv-collapsed"));
    wrap.appendChild(toggle);
    wrap.appendChild(bracket("{"));
    const keys = Object.keys(obj);
    if (!keys.length) {
      wrap.appendChild(bracket("}"));
      return wrap;
    }
    const preview = document.createElement("span");
    preview.className = "zpwr-jv-preview";
    preview.textContent = ` Object(${keys.length}) `;
    wrap.appendChild(preview);
    const kids = document.createElement("div");
    kids.className = "zpwr-jv-children";
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const row = document.createElement("div");
      row.className = "zpwr-jv-row";
      const keySpan = document.createElement("span");
      keySpan.className = "zpwr-jv-key";
      keySpan.textContent = JSON.stringify(k);
      row.appendChild(keySpan);
      row.appendChild(text(": "));
      row.appendChild(renderNode(obj[k], [...path, k]));
      if (i < keys.length - 1) row.appendChild(text(","));
      row.appendChild(mkCopyPath([...path, k]));
      kids.appendChild(row);
    }
    wrap.appendChild(kids);
    wrap.appendChild(bracket("}"));
    return wrap;
  }
  function bracket(ch) {
    const s = document.createElement("span");
    s.className = "zpwr-jv-bracket";
    s.textContent = ch;
    return s;
  }
  function text(t) {
    return document.createTextNode(t);
  }

  // ─── Misc UI helpers ─────────────────────────────────────────────
  function mkBtn(label, onClick) {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", () => onClick(b));
    return b;
  }
  function mkCopyPath(path) {
    const b = document.createElement("span");
    b.className = "zpwr-jv-copy-path";
    b.textContent = "⧉ path";
    b.title = "Copy RFC-6901 JSON pointer to clipboard";
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      copyText(formatPath(path), b);
    });
    return b;
  }
  function flashStatus(btn, msg) {
    const orig = btn.textContent;
    btn.textContent = `✓ ${msg}`;
    setTimeout(() => { btn.textContent = orig; }, 900);
  }
  function copyText(t, btn) {
    // navigator.clipboard is only defined in secure contexts (https,
    // localhost, file://). On plain http (e.g. 0.0.0.0:8000) it's
    // undefined entirely — we fall back to the legacy execCommand
    // hidden-textarea trick so the button still works.
    const done = (ok) => flashStatus(btn, ok ? "copied" : "fail");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(t).then(() => done(true), () => legacyCopy(t, done));
      return;
    }
    legacyCopy(t, done);
  }
  function legacyCopy(text, done) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      done(ok);
    } catch { done(false); }
  }
  function nodeCount(v) {
    let n = 0;
    walk(v, () => { n++; });
    return n;
  }
  function byteSize(s) {
    return new TextEncoder().encode(s).length;
  }
  function walk(v, fn) {
    fn(v);
    if (Array.isArray(v)) for (const x of v) walk(x, fn);
    else if (v && typeof v === "object") for (const k of Object.keys(v)) walk(v[k], fn);
  }
  function formatPath(path) {
    if (!path.length) return "";
    return "/" + path.map((s) => String(s).replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
  }
})();
