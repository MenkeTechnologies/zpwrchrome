// zpwrchrome — XML formatter content script.
//
// Auto-detects when the active page is an XML document (Content-Type or
// a `.xml`/`.rss`/`.atom`/`.svg`/`.xsd`/`.xsl` URL or the body parses as
// XML) and replaces the raw `<pre>` blob Chrome ships with a syntax-
// highlit, collapsible tree. Adds a toolbar with copy / minify / pretty
// / raw toggle, live filter, and XPath copy per node. Mirrors the JSON
// viewer's UX so they feel like sister tools.
//
// No imports — content scripts are self-contained. Pure helpers from
// lib/xml-format.js are duplicated here in compact form where needed
// (looksLikeXml, isXmlContentType, hasXmlExtension).

(function () {
  "use strict";

  if (window.top !== window.self) return;
  if (document.documentElement?.dataset?.zpwrXmlViewer === "1") return;
  // Avoid clobbering the JSON viewer — they share content_scripts on
  // <all_urls>, and Chrome's plain-text `<pre>` rendering could match
  // either pre-check on edge inputs.
  if (document.documentElement?.dataset?.zpwrJsonViewer === "1") return;

  // Trigger ONLY when the page is a "pure XML document" — server-declared
  // XML Content-Type, or Chrome's plain rendering shape (body is exactly
  // one `<pre>`). A `<pre>` anywhere on a rich HTML page is NOT enough
  // (Prism / highlight.js code blocks would false-fire); a `.xml` URL
  // alone is NOT enough either.
  const ctype = String(document.contentType || "").toLowerCase();
  const isXmlCt = /\/(xml|atom\+xml|rss\+xml|xhtml\+xml|svg\+xml|soap\+xml)|\+xml\b/.test(ctype);
  const pre = chromePlainPreShape();

  if (!pre && !isXmlCt) return;

  const raw = (pre?.textContent ?? document.body?.textContent ?? "").trim();
  if (!raw) return;

  // Cheap pre-check — must start with `<` and look like XML, not HTML.
  const head = raw.replace(/^﻿/, "").trimStart();
  if (head[0] !== "<") return;
  if (/^<!DOCTYPE\s+html/i.test(head)) return;
  if (/^<html[\s>]/i.test(head)) return;

  // Parse — DOMParser is available in every Chrome MV3 content-script.
  // Try `application/xml` first; fall back to `text/xml` so namespaced
  // documents and edge cases both succeed.
  let doc;
  try {
    doc = new DOMParser().parseFromString(raw, "application/xml");
  } catch { return; }
  // DOMParser surfaces parse errors as a `<parsererror>` element rather
  // than throwing. Bail if the document is unrecoverable — leave the
  // page alone so the user can see the raw payload + browser-level error.
  if (!doc || !doc.documentElement) return;
  if (doc.documentElement.tagName === "parsererror") return;
  if (doc.getElementsByTagName("parsererror").length > 0 &&
      doc.documentElement.tagName === "parsererror") return;

  document.documentElement.dataset.zpwrXmlViewer = "1";
  injectStyles();
  buildPage(doc, raw);

  // Chrome's "raw response" rendering shape: <body> has exactly one
  // meaningful child and it is a <pre>. Anything richer (header, nav,
  // multiple sections, sibling code blocks) is a real HTML page and
  // must not be hijacked even if a child <pre> happens to parse.
  function chromePlainPreShape() {
    const body = document.body;
    if (!body) return null;
    const kids = Array.from(body.children).filter((el) => {
      const t = el.tagName;
      return t !== "SCRIPT" && t !== "STYLE" && t !== "LINK" && t !== "META";
    });
    if (kids.length !== 1) return null;
    return kids[0].tagName === "PRE" ? kids[0] : null;
  }

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
      .zpwr-xv-toolbar {
        display: flex; align-items: center; gap: 8px;
        background: #0a0a14; border-bottom: 1px solid #1a1a3e;
        padding: 8px 14px;
        position: sticky; top: 0; z-index: 10;
      }
      .zpwr-xv-toolbar .zpwr-xv-title {
        font-size: 12px; color: #05d9e8;
        letter-spacing: 1px; text-transform: uppercase; font-weight: 700;
      }
      .zpwr-xv-toolbar .zpwr-xv-stats {
        font-size: 11px; color: #7a8ba8; margin-left: 4px;
      }
      .zpwr-xv-toolbar .grow { flex: 1; }
      .zpwr-xv-toolbar .zpwr-xv-search {
        background: #05050a; border: 1px solid #1a1a3e; color: #e0f0ff;
        font-family: inherit; font-size: 12px;
        padding: 4px 10px; border-radius: 2px; min-width: 220px;
      }
      .zpwr-xv-toolbar .zpwr-xv-search:focus {
        outline: none; border-color: #05d9e8; box-shadow: 0 0 6px rgba(5,217,232,0.4);
      }
      .zpwr-xv-toolbar button {
        background: transparent; color: #7a8ba8;
        border: 1px solid #1a1a3e; border-radius: 2px;
        font-family: inherit; font-size: 11px;
        padding: 4px 10px; cursor: pointer;
        letter-spacing: 0.5px;
      }
      .zpwr-xv-toolbar button:hover {
        color: #05d9e8; border-color: #05d9e8; background: #12122a;
      }
      .zpwr-xv-toolbar button.active {
        color: #ff8c1a; border-color: #ff8c1a;
      }

      .zpwr-xv-body { padding: 14px 18px; max-width: 100%; overflow-x: auto; }
      .zpwr-xv-body[hidden] { display: none; }
      .zpwr-xv-raw {
        display: none;
        white-space: pre-wrap; word-break: break-all;
        font-family: inherit; font-size: 12px; color: #e0f0ff;
        background: #05050a;
      }
      .zpwr-xv-raw.active { display: block; }

      .zpwr-xv-row { line-height: 1.55; }
      .zpwr-xv-collapsible > .zpwr-xv-toggle {
        display: inline-block; width: 12px;
        color: #7a8ba8; cursor: pointer; user-select: none;
      }
      .zpwr-xv-collapsible.zpwr-xv-collapsed > .zpwr-xv-children { display: none; }
      .zpwr-xv-collapsible.zpwr-xv-collapsed > .zpwr-xv-preview { color: #7a8ba8; font-style: italic; }
      .zpwr-xv-children {
        margin-left: 16px;
        border-left: 1px dotted #1a1a3e; padding-left: 8px;
      }

      .zpwr-xv-tag      { color: #ff2a6d; }
      .zpwr-xv-tagname  { color: #ff2a6d; font-weight: 700; }
      .zpwr-xv-attr     { color: #ff8c1a; }
      .zpwr-xv-attrval  { color: #39ff14; }
      .zpwr-xv-text     { color: #e0f0ff; }
      .zpwr-xv-cdata    { color: #d300c5; font-style: italic; }
      .zpwr-xv-comment  { color: #7a8ba8; font-style: italic; }
      .zpwr-xv-pi       { color: #05d9e8; font-style: italic; }
      .zpwr-xv-eq       { color: #7a8ba8; }
      .zpwr-xv-quote    { color: #7a8ba8; }
      .zpwr-xv-bracket  { color: #7a8ba8; }
      .zpwr-xv-text a   { color: #39ff14; text-decoration: underline; }
      .zpwr-xv-text a:hover, .zpwr-xv-attrval a:hover { color: #ff8c1a; }
      .zpwr-xv-attrval a { color: #39ff14; }

      .zpwr-xv-search-hit { background: #ff8c1a; color: #05050a; padding: 0 2px; border-radius: 1px; }
      .zpwr-xv-row.search-match { background: rgba(255,140,26,0.08); }

      .zpwr-xv-copy-path {
        opacity: 0; cursor: pointer;
        display: inline-block; margin-left: 8px;
        font-size: 10px; color: #7a8ba8;
        border: 1px solid #1a1a3e; border-radius: 2px;
        padding: 0 4px;
      }
      .zpwr-xv-row:hover > .zpwr-xv-copy-path { opacity: 1; }
      .zpwr-xv-copy-path:hover { color: #05d9e8; border-color: #05d9e8; }
    `;
    const s = document.createElement("style");
    s.id = "zpwr-xv-styles";
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ─── Page assembly ───────────────────────────────────────────────
  function buildPage(doc, rawText) {
    document.body.innerHTML = "";

    const toolbar = document.createElement("div");
    toolbar.className = "zpwr-xv-toolbar";

    const title = document.createElement("span");
    title.className = "zpwr-xv-title";
    title.textContent = "zpwrchrome // xml";

    const stats = document.createElement("span");
    stats.className = "zpwr-xv-stats";
    stats.textContent = ` · ${countAllNodes(doc)} nodes · ${byteSize(rawText)} bytes`;

    const search = document.createElement("input");
    search.className = "zpwr-xv-search";
    search.type = "search";
    search.placeholder = "filter tags / attrs / text…";

    const btnCopy   = mkBtn("⧉ copy",        () => copyText(rawText,              btnCopy));
    const btnPretty = mkBtn("✎ pretty copy", () => copyText(prettyXml(rawText),   btnPretty));
    const btnMin    = mkBtn("⌐ minify copy", () => copyText(minifyXml(rawText),   btnMin));
    const btnAll    = mkBtn("▼ expand all",  () => setAllCollapsed(false, btnAll));
    const btnNone   = mkBtn("▶ collapse all",() => setAllCollapsed(true,  btnNone));
    const btnRaw    = mkBtn("◧ raw",         (b) => toggleRaw(b));

    const grow = document.createElement("span");
    grow.className = "grow";

    toolbar.append(title, stats, grow, search, btnCopy, btnPretty, btnMin, btnAll, btnNone, btnRaw);
    document.body.appendChild(toolbar);

    const body = document.createElement("pre");
    body.className = "zpwr-xv-body";
    // Render the prolog (PIs / DOCTYPE / leading comments) when present,
    // then the document element + its subtree.
    for (const n of Array.from(doc.childNodes)) {
      if (n.nodeType === 1) {
        // Element — the document root. Render with its full path.
        body.appendChild(renderElement(n, [{ name: n.nodeName, index: 1 }]));
      } else if (n.nodeType === 7) {
        // Processing instruction.
        body.appendChild(renderPI(n));
      } else if (n.nodeType === 8) {
        // Comment.
        body.appendChild(renderComment(n));
      }
    }
    document.body.appendChild(body);

    const rawPre = document.createElement("pre");
    rawPre.className = "zpwr-xv-raw";
    rawPre.textContent = rawText;
    document.body.appendChild(rawPre);

    // ─── Live filter ────────────────────────────────────────────
    let lastQuery = "";
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      if (q === lastQuery) return;
      lastQuery = q;
      applySearch(body, q);
    });
    document.addEventListener("keydown", (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && (ev.key === "f" || ev.key === "F")) {
        ev.preventDefault();
        search.focus(); search.select();
      }
    });

    function toggleRaw(btn) {
      const showingRaw = rawPre.classList.toggle("active");
      body.hidden = showingRaw;
      btn.classList.toggle("active", showingRaw);
    }
    function setAllCollapsed(collapsed, btn) {
      for (const el of body.querySelectorAll(".zpwr-xv-collapsible")) {
        el.classList.toggle("zpwr-xv-collapsed", collapsed);
      }
      flashStatus(btn, collapsed ? "collapsed" : "expanded");
    }
  }

  // ─── Search highlighter ──────────────────────────────────────────
  function applySearch(body, q) {
    for (const m of body.querySelectorAll(".zpwr-xv-search-hit")) {
      const parent = m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    }
    for (const r of body.querySelectorAll(".search-match")) r.classList.remove("search-match");
    if (!q) return;
    const candidates = body.querySelectorAll(".zpwr-xv-tagname, .zpwr-xv-attr, .zpwr-xv-attrval, .zpwr-xv-text, .zpwr-xv-cdata, .zpwr-xv-comment");
    for (const el of candidates) {
      const t = el.textContent.toLowerCase();
      if (!t.includes(q)) continue;
      let p = el.parentElement;
      while (p) {
        if (p.classList.contains("zpwr-xv-collapsible")) p.classList.remove("zpwr-xv-collapsed");
        p = p.parentElement;
      }
      const row = el.closest(".zpwr-xv-row");
      if (row) row.classList.add("search-match");
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
      if (at < 0) { frag.appendChild(document.createTextNode(orig.slice(i))); break; }
      if (at > i) frag.appendChild(document.createTextNode(orig.slice(i, at)));
      const m = document.createElement("span");
      m.className = "zpwr-xv-search-hit";
      m.textContent = orig.slice(at, at + q.length);
      frag.appendChild(m);
      i = at + q.length;
    }
    el.innerHTML = "";
    el.appendChild(frag);
  }

  // ─── Node renderers ──────────────────────────────────────────────
  function renderElement(el, path) {
    // Wrap with a collapsible row carrying the XPath for copy + filter.
    const wrap = document.createElement("span");
    wrap.className = "zpwr-xv-collapsible zpwr-xv-elem";

    const toggle = document.createElement("span");
    toggle.className = "zpwr-xv-toggle";
    toggle.textContent = "▼";
    toggle.addEventListener("click", () => wrap.classList.toggle("zpwr-xv-collapsible-toggled") || wrap.classList.toggle("zpwr-xv-collapsed"));
    wrap.appendChild(toggle);

    // Detect element shape: empty / text-only leaf / mixed-content / nested.
    const childElements = Array.from(el.children);
    const childNodes    = Array.from(el.childNodes);
    const onlyText      = childNodes.length > 0 &&
                          childNodes.every((n) => n.nodeType === 3 || n.nodeType === 4) &&
                          (el.textContent || "").trim().length > 0;
    const isEmpty       = childNodes.length === 0 ||
                          childNodes.every((n) => n.nodeType === 3 && !n.textContent.trim());

    if (isEmpty) {
      wrap.appendChild(renderOpenTag(el, /*selfClose=*/true));
      wrap.appendChild(mkCopyPath(path));
      return wrap;
    }

    if (onlyText && childElements.length === 0) {
      // Leaf with text content: <tag attr="v">text</tag> all on one line.
      wrap.appendChild(renderOpenTag(el, /*selfClose=*/false));
      const txt = document.createElement("span");
      txt.className = "zpwr-xv-text";
      txt.textContent = (el.textContent || "").trim();
      autoLinkify(txt);
      wrap.appendChild(txt);
      wrap.appendChild(renderCloseTag(el));
      wrap.appendChild(mkCopyPath(path));
      return wrap;
    }

    // Mixed / nested element. Open tag + collapsible child block + close tag.
    wrap.appendChild(renderOpenTag(el, /*selfClose=*/false));
    const preview = document.createElement("span");
    preview.className = "zpwr-xv-preview";
    preview.textContent = ` <${childElements.length} child${childElements.length === 1 ? "" : "ren"}> `;
    wrap.appendChild(preview);

    const kids = document.createElement("div");
    kids.className = "zpwr-xv-children";
    // Track sibling indexes per child name so we can build 1-based XPath.
    const seen = new Map();
    for (const n of childNodes) {
      if (n.nodeType === 1) {
        const name = n.nodeName;
        const idx = (seen.get(name) || 0) + 1;
        seen.set(name, idx);
        const row = document.createElement("div");
        row.className = "zpwr-xv-row";
        row.appendChild(renderElement(n, [...path, { name, index: idx }]));
        kids.appendChild(row);
      } else if (n.nodeType === 3) {
        const t = (n.textContent || "");
        if (!t.trim()) continue;
        const row = document.createElement("div");
        row.className = "zpwr-xv-row";
        const span = document.createElement("span");
        span.className = "zpwr-xv-text";
        span.textContent = t.replace(/\s+/g, " ").trim();
        autoLinkify(span);
        row.appendChild(span);
        kids.appendChild(row);
      } else if (n.nodeType === 4) {
        const row = document.createElement("div");
        row.className = "zpwr-xv-row";
        const span = document.createElement("span");
        span.className = "zpwr-xv-cdata";
        span.textContent = `<![CDATA[${n.data}]]>`;
        row.appendChild(span);
        kids.appendChild(row);
      } else if (n.nodeType === 7) {
        const row = document.createElement("div");
        row.className = "zpwr-xv-row";
        row.appendChild(renderPI(n));
        kids.appendChild(row);
      } else if (n.nodeType === 8) {
        const row = document.createElement("div");
        row.className = "zpwr-xv-row";
        row.appendChild(renderComment(n));
        kids.appendChild(row);
      }
    }
    wrap.appendChild(kids);
    wrap.appendChild(renderCloseTag(el));
    wrap.appendChild(mkCopyPath(path));
    return wrap;
  }

  function renderOpenTag(el, selfClose) {
    const span = document.createElement("span");
    span.className = "zpwr-xv-tag";
    span.appendChild(bracket("<"));
    const name = document.createElement("span");
    name.className = "zpwr-xv-tagname";
    name.textContent = el.nodeName;
    span.appendChild(name);
    for (const a of Array.from(el.attributes || [])) {
      span.appendChild(document.createTextNode(" "));
      const k = document.createElement("span");
      k.className = "zpwr-xv-attr";
      k.textContent = a.name;
      span.appendChild(k);
      span.appendChild(equals());
      span.appendChild(quote());
      const v = document.createElement("span");
      v.className = "zpwr-xv-attrval";
      v.textContent = a.value;
      autoLinkify(v);
      span.appendChild(v);
      span.appendChild(quote());
    }
    span.appendChild(bracket(selfClose ? "/>" : ">"));
    return span;
  }
  function renderCloseTag(el) {
    const span = document.createElement("span");
    span.className = "zpwr-xv-tag";
    span.appendChild(bracket("</"));
    const name = document.createElement("span");
    name.className = "zpwr-xv-tagname";
    name.textContent = el.nodeName;
    span.appendChild(name);
    span.appendChild(bracket(">"));
    return span;
  }
  function renderPI(n) {
    const span = document.createElement("span");
    span.className = "zpwr-xv-pi";
    span.textContent = `<?${n.target}${n.data ? " " + n.data : ""}?>`;
    return span;
  }
  function renderComment(n) {
    const span = document.createElement("span");
    span.className = "zpwr-xv-comment";
    span.textContent = `<!--${n.data}-->`;
    return span;
  }

  function bracket(ch) {
    const s = document.createElement("span");
    s.className = "zpwr-xv-bracket";
    s.textContent = ch;
    return s;
  }
  function equals() {
    const s = document.createElement("span");
    s.className = "zpwr-xv-eq";
    s.textContent = "=";
    return s;
  }
  function quote() {
    const s = document.createElement("span");
    s.className = "zpwr-xv-quote";
    s.textContent = '"';
    return s;
  }

  // Auto-linkify http(s) URLs inside text + attribute values. Replaces
  // the contents of the passed-in span with a fragment that has an <a>
  // wrapping the URL chunk.
  function autoLinkify(span) {
    const t = span.textContent || "";
    if (!/https?:\/\/\S/.test(t)) return;
    span.innerHTML = "";
    const re = /https?:\/\/[^\s<>"']+/g;
    let last = 0, m;
    while ((m = re.exec(t)) !== null) {
      if (m.index > last) span.appendChild(document.createTextNode(t.slice(last, m.index)));
      const a = document.createElement("a");
      a.href = m[0]; a.target = "_blank"; a.rel = "noopener";
      a.textContent = m[0];
      span.appendChild(a);
      last = m.index + m[0].length;
    }
    if (last < t.length) span.appendChild(document.createTextNode(t.slice(last)));
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
    b.className = "zpwr-xv-copy-path";
    b.textContent = "⧉ xpath";
    b.title = "Copy XPath of this node";
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      copyText(formatXPath(path), b);
    });
    return b;
  }
  function flashStatus(btn, msg) {
    const orig = btn.textContent;
    btn.textContent = `✓ ${msg}`;
    setTimeout(() => { btn.textContent = orig; }, 900);
  }
  function copyText(t, btn) {
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
  function countAllNodes(doc) {
    let n = 0;
    const walk = (node) => {
      if (!node) return;
      n++;
      for (const c of Array.from(node.childNodes || [])) walk(c);
    };
    walk(doc.documentElement);
    return n;
  }
  function byteSize(s) {
    return new TextEncoder().encode(s).length;
  }
  function formatXPath(segments) {
    if (!segments.length) return "/";
    return "/" + segments.map((s) => `${s.name}[${s.index}]`).join("/");
  }
  // Inline prettyXml + minifyXml — kept verbatim from lib/xml-format.js
  // so this content script needs no imports (Chrome MV3 content scripts
  // can't `import` from extension modules).
  function prettyXml(raw, indent) {
    const i = Number.isFinite(indent) ? indent : 2;
    const pad = " ".repeat(Math.max(0, i));
    const src = String(raw || "");
    if (!src.trim()) return "";
    const out = [];
    let depth = 0, p = src.charCodeAt(0) === 0xFEFF ? 1 : 0;
    const N = src.length;
    const push = (s) => out.push(pad.repeat(depth) + s);
    while (p < N) {
      while (p < N && /\s/.test(src[p])) p++;
      if (p >= N) break;
      if (src[p] !== "<") {
        const start = p;
        while (p < N && src[p] !== "<") p++;
        const t = src.slice(start, p).replace(/\s+/g, " ").trim();
        if (t) push(t);
        continue;
      }
      if (src.startsWith("<!--", p))     { const e = src.indexOf("-->", p + 4); const s = e < 0 ? N : e + 3; push(src.slice(p, s)); p = s; continue; }
      if (src.startsWith("<![CDATA[", p)){ const e = src.indexOf("]]>", p + 9); const s = e < 0 ? N : e + 3; push(src.slice(p, s)); p = s; continue; }
      if (src.startsWith("<?", p))       { const e = src.indexOf("?>", p + 2);  const s = e < 0 ? N : e + 2; push(src.slice(p, s)); p = s; continue; }
      if (src.startsWith("<!", p))       { const e = src.indexOf(">", p + 2);   const s = e < 0 ? N : e + 1; push(src.slice(p, s)); p = s; continue; }
      const close = src.indexOf(">", p + 1);
      if (close < 0) { push(src.slice(p)); p = N; continue; }
      const tag = src.slice(p, close + 1);
      p = close + 1;
      if (tag[1] === "/") { depth = Math.max(0, depth - 1); push(tag); continue; }
      if (tag.endsWith("/>")) { push(tag); continue; }
      const nm = (/^<([^\s/>]+)/.exec(tag) || [])[1];
      if (nm) {
        let j = p;
        while (j < N && /\s/.test(src[j])) j++;
        if (src[j] !== "<") {
          const ts = j;
          while (j < N && src[j] !== "<") j++;
          const closer = `</${nm}>`;
          if (src.startsWith(closer, j)) {
            const t = src.slice(ts, j).replace(/\s+/g, " ").trim();
            push(tag + t + closer);
            p = j + closer.length;
            continue;
          }
        } else {
          const closer = `</${nm}>`;
          if (src.startsWith(closer, j)) { push(tag + closer); p = j + closer.length; continue; }
        }
      }
      push(tag);
      depth++;
    }
    return out.join("\n");
  }
  function minifyXml(raw) {
    const src = String(raw || "");
    let out = ""; let p = 0; const N = src.length;
    while (p < N) {
      if (src[p] === "<") {
        if (src.startsWith("<!--", p))     { const e = src.indexOf("-->", p + 4); const s = e < 0 ? N : e + 3; out += src.slice(p, s); p = s; continue; }
        if (src.startsWith("<![CDATA[", p)){ const e = src.indexOf("]]>", p + 9); const s = e < 0 ? N : e + 3; out += src.slice(p, s); p = s; continue; }
        const close = src.indexOf(">", p + 1);
        const s = close < 0 ? N : close + 1;
        out += src.slice(p, s); p = s; continue;
      }
      const start = p;
      while (p < N && src[p] !== "<") p++;
      const t = src.slice(start, p).replace(/\s+/g, " ");
      if (t.trim()) out += t;
    }
    return out;
  }
})();
