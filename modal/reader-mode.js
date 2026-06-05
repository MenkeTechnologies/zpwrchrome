// zpwrchrome — Reader Mode content script.
//
// Strips the active page to its main article and renders it in a
// fixed-position overlay with the strykelang HUD palette. Trigger via
// the `reader-mode` command, toolbar context menu "Reader mode (this
// tab)", or the settings page's preview button. Click the × in the top
// bar or press Esc to close. The original page DOM is untouched — the
// overlay just sits on top.
//
// Content scripts can't `import`, so a minimized copy of the helpers
// from lib/reader-mode-css.js is inlined.

(function () {
  "use strict";

  const OVERLAY_ID  = "zpwr-reader-mode";
  const STYLE_ID    = "zpwr-reader-mode-style";
  const STATE_KEY   = "reader.mode";
  const NOISE_CLASS = /(^|[\s-_])(nav|navigation|navbar|menu|header|footer|aside|sidebar|side-bar|ad|ads|adv|advert|advertisement|promo|sponsor|share|social|comment|comments|related|widget|popup|modal|tracker|newsletter|signup|cookie|consent|gdpr|toolbar|breadcrumb|byline-share)(?=[\s-_]|$)/i;

  const THEMES = {
    cyberpunk:      { bg: "#05050a", panel: "#0a0a14", text: "#e0f0ff", muted: "#7a8ba8", accent: "#05d9e8", accent2: "#ff8c1a", accent3: "#d300c5", border: "#1a1a3e" },
    "classic-dark": { bg: "#1a1a1a", panel: "#252525", text: "#e8e8e8", muted: "#9a9a9a", accent: "#5b9aff", accent2: "#ffa657", accent3: "#bf91e8", border: "#3a3a3a" },
    "classic-light":{ bg: "#fbfbf9", panel: "#f0eee5", text: "#1a1a1a", muted: "#666",    accent: "#0066cc", accent2: "#cc5500", accent3: "#7c2d92", border: "#d0cec0" },
    sepia:          { bg: "#f4ecd8", panel: "#ebe1c8", text: "#3b2f1e", muted: "#776444", accent: "#7a4a1a", accent2: "#8a3b0a", accent3: "#5b3010", border: "#cebd91" },
  };
  const FONT_STACKS = {
    mono:  "'Share Tech Mono', 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
    serif: "Iowan Old Style, 'Apple Garamond', Baskerville, 'Times New Roman', Times, serif",
    sans:  "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  };
  const DEFAULTS = {
    theme: "cyberpunk", font: "mono", fontSize: 16, lineWidth: 65, lineHeight: 1.65, scanlines: false,
  };

  function clampFs(v) { const n = Number(v); return !isFinite(n) ? DEFAULTS.fontSize : Math.max(12, Math.min(28, Math.round(n))); }
  function clampLw(v) { const n = Number(v); return !isFinite(n) ? DEFAULTS.lineWidth : Math.max(40, Math.min(120, Math.round(n))); }
  function clampLh(v) { const n = Number(v); return !isFinite(n) ? DEFAULTS.lineHeight : Math.max(1.2, Math.min(2.4, Number(n.toFixed(2)))); }
  function pickTheme(name) { return THEMES[name] || THEMES.cyberpunk; }
  function pickFont(name)  { return FONT_STACKS[name] || FONT_STACKS.mono; }

  // ─── Article extraction ────────────────────────────────────────────
  function isNoise(el) {
    if (!el) return false;
    const cls = (el.className && typeof el.className === "string") ? el.className : "";
    const id  = el.id || "";
    const role = el.getAttribute && el.getAttribute("role") || "";
    if (NOISE_CLASS.test(cls) || NOISE_CLASS.test(id)) return true;
    if (/^(nav|navigation|banner|complementary|search|contentinfo)$/i.test(role)) return true;
    return false;
  }

  function pickArticleRoot() {
    // 1. <article> with the most text content.
    const articles = Array.from(document.querySelectorAll("article")).filter((a) => !isNoise(a));
    if (articles.length) {
      return articles.reduce((best, a) =>
        (a.innerText || "").length > (best.innerText || "").length ? a : best
      );
    }
    // 2. <main> or [role="main"].
    const main = document.querySelector("main, [role='main']");
    if (main) return main;
    // 3. Heaviest paragraph cluster — count <p>+<h*> children that aren't
    //    inside noise containers. This is the gist of Readability without
    //    the per-element scoring matrix.
    let best = document.body;
    let bestScore = 0;
    const candidates = document.querySelectorAll("section, div");
    for (const c of candidates) {
      if (isNoise(c)) continue;
      let walker = c.parentElement;
      let nestedInNoise = false;
      while (walker && walker !== document.body) {
        if (isNoise(walker)) { nestedInNoise = true; break; }
        walker = walker.parentElement;
      }
      if (nestedInNoise) continue;
      const paragraphs = c.querySelectorAll("p").length;
      const headings   = c.querySelectorAll("h1, h2, h3, h4, h5, h6").length;
      const score = paragraphs * 3 + headings;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  function cleanArticle(root) {
    const clone = root.cloneNode(true);
    const dropSelectors = [
      "script", "style", "noscript", "iframe",
      "nav", "footer", "aside", "header",
      "form", "button", "input", "select", "textarea",
      "[aria-hidden='true']", "[hidden]",
      "figure.advertisement", ".advertisement", ".ads", ".ad", ".sponsor",
      ".share", ".social", ".sidebar", ".related", ".comments",
      ".newsletter", ".signup", ".paywall", ".cookie-banner",
    ];
    clone.querySelectorAll(dropSelectors.join(", ")).forEach((el) => el.remove());
    // Strip elements whose className matches the noise regex but didn't
    // match the static list (catches sites that use bespoke class names).
    Array.from(clone.querySelectorAll("*")).forEach((el) => {
      if (isNoise(el)) el.remove();
    });
    // Convert relative <img src=…> and <a href=…> to absolute so they
    // still resolve when displayed inside the overlay.
    clone.querySelectorAll("img[src]").forEach((img) => { img.src = img.src; });
    clone.querySelectorAll("a[href]").forEach((a) => { a.href = a.href; });
    // Strip inline event handlers as a defense-in-depth measure (the
    // overlay sets innerHTML, so any onclick="" would execute on render).
    Array.from(clone.querySelectorAll("*")).forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      });
    });
    return clone;
  }

  function extractMeta() {
    const og = (name) =>
      document.querySelector(`meta[property="og:${name}"]`)?.content ||
      document.querySelector(`meta[name="${name}"]`)?.content ||
      null;
    const title = og("title") ||
      document.querySelector("h1")?.innerText ||
      document.title || "";
    const byline = og("author") ||
      document.querySelector("[rel='author']")?.innerText ||
      document.querySelector(".byline, .author")?.innerText ||
      null;
    const siteName = og("site_name") || location.hostname;
    const published = document.querySelector("meta[property='article:published_time']")?.content ||
      document.querySelector("time[datetime]")?.getAttribute("datetime") ||
      null;
    return { title: (title || "").trim(), byline: byline && byline.trim() || null, siteName, published };
  }

  function readingTimeMin(text) {
    if (!text) return 0;
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
  }

  // ─── Styles ────────────────────────────────────────────────────────
  function buildCss(o) {
    const opt = { ...DEFAULTS, ...(o || {}) };
    const t = pickTheme(opt.theme);
    const f = pickFont(opt.font);
    const fs = clampFs(opt.fontSize);
    const lw = clampLw(opt.lineWidth);
    const lh = clampLh(opt.lineHeight);
    return `
      #${OVERLAY_ID} {
        position: fixed !important; inset: 0 !important;
        z-index: 2147483647 !important; overflow-y: auto !important;
        background-color: ${t.bg} !important; color: ${t.text} !important;
        font-family: ${f} !important; font-size: ${fs}px !important;
        line-height: ${lh} !important; padding: 56px 24px 80px !important;
        box-sizing: border-box !important;
      }
      #${OVERLAY_ID} .zpwr-reader-bar {
        position: fixed; top: 0; left: 0; right: 0;
        display: flex; align-items: center; gap: 14px;
        padding: 8px 14px; background-color: ${t.panel};
        border-bottom: 1px solid ${t.border};
        font-family: ${FONT_STACKS.mono}; font-size: 11px;
        color: ${t.muted}; letter-spacing: 1px; z-index: 1;
      }
      #${OVERLAY_ID} .zpwr-reader-bar .grow { flex: 1; }
      #${OVERLAY_ID} .zpwr-reader-bar button {
        background: none; border: none; padding: 4px 8px;
        color: ${t.accent}; font: inherit; cursor: pointer;
      }
      #${OVERLAY_ID} .zpwr-reader-bar button:hover { color: ${t.accent2}; }
      #${OVERLAY_ID} .zpwr-reader-bar .close {
        font-size: 16px; padding: 0 8px; line-height: 1;
      }
      #${OVERLAY_ID} .zpwr-reader-article { max-width: ${lw}ch; margin: 0 auto; }
      #${OVERLAY_ID} h1, #${OVERLAY_ID} h2, #${OVERLAY_ID} h3,
      #${OVERLAY_ID} h4, #${OVERLAY_ID} h5, #${OVERLAY_ID} h6 {
        color: ${t.accent} !important; letter-spacing: 0.5px;
        margin: 1.6em 0 0.6em; line-height: 1.25;
      }
      #${OVERLAY_ID} h1 { font-size: 1.6em; }
      #${OVERLAY_ID} h2 { font-size: 1.35em; }
      #${OVERLAY_ID} h3 { font-size: 1.18em; }
      #${OVERLAY_ID} p, #${OVERLAY_ID} li, #${OVERLAY_ID} dd, #${OVERLAY_ID} dt { margin: 0 0 1em; }
      #${OVERLAY_ID} a { color: ${t.accent} !important; text-decoration: underline; text-decoration-color: ${t.border}; }
      #${OVERLAY_ID} a:hover { color: ${t.accent2} !important; }
      #${OVERLAY_ID} blockquote {
        margin: 1em 0; padding: 8px 16px;
        border-left: 3px solid ${t.accent3};
        color: ${t.muted}; font-style: italic;
      }
      #${OVERLAY_ID} code, #${OVERLAY_ID} kbd, #${OVERLAY_ID} samp {
        font-family: ${FONT_STACKS.mono};
        color: ${t.accent2}; background: ${t.panel};
        padding: 1px 5px; border-radius: 2px; font-size: 0.92em;
      }
      #${OVERLAY_ID} pre {
        background: ${t.panel}; border-left: 3px solid ${t.accent};
        padding: 12px 16px; overflow-x: auto; margin: 1em 0;
      }
      #${OVERLAY_ID} pre code { background: transparent; padding: 0; }
      #${OVERLAY_ID} hr { border: none; border-top: 1px solid ${t.border}; margin: 2em 0; }
      #${OVERLAY_ID} img, #${OVERLAY_ID} video, #${OVERLAY_ID} picture {
        max-width: 100%; height: auto; display: block; margin: 1em auto;
      }
      #${OVERLAY_ID} table { border-collapse: collapse; margin: 1em 0; width: 100%; }
      #${OVERLAY_ID} th, #${OVERLAY_ID} td { border: 1px solid ${t.border}; padding: 6px 10px; text-align: left; }
      #${OVERLAY_ID} th { background: ${t.panel}; color: ${t.accent}; }
      #${OVERLAY_ID} .zpwr-reader-title {
        font-family: ${f}; font-size: 1.9em;
        color: ${t.accent} !important; margin: 32px 0 8px; line-height: 1.2;
      }
      #${OVERLAY_ID} .zpwr-reader-meta {
        color: ${t.muted}; font-size: 0.85em; margin-bottom: 24px;
        font-family: ${FONT_STACKS.mono}; letter-spacing: 1px;
      }
      #${OVERLAY_ID} .zpwr-reader-meta a { color: ${t.muted} !important; }
      #${OVERLAY_ID} .zpwr-reader-meta .sep { margin: 0 8px; color: ${t.border}; }
      #${OVERLAY_ID} *::selection { background: ${t.accent}; color: ${t.bg}; }
      ${opt.scanlines ? `
      #${OVERLAY_ID}::after {
        content: "" !important; position: fixed !important; inset: 0 !important;
        pointer-events: none !important; z-index: 2 !important;
        background: repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(5,217,232,0.025) 2px, rgba(5,217,232,0.025) 3px) !important;
        mix-blend-mode: screen !important;
      }` : ""}
    `;
  }

  // ─── Overlay lifecycle ─────────────────────────────────────────────
  function ensureStyle(settings) {
    let tag = document.getElementById(STYLE_ID);
    if (!tag) {
      tag = document.createElement("style");
      tag.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(tag);
    }
    tag.textContent = buildCss(settings);
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  }

  function show(settings) {
    const s = { ...DEFAULTS, ...(settings || {}) };
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      // Already shown — refresh styles only (settings may have changed).
      ensureStyle(s);
      return;
    }
    const root = pickArticleRoot();
    const cleaned = cleanArticle(root);
    const meta = extractMeta();
    const readMin = readingTimeMin(cleaned.innerText || "");
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("role", "document");
    overlay.innerHTML = `
      <div class="zpwr-reader-bar">
        <span>${escapeHtml(meta.siteName)}</span>
        <span>${readMin} min read</span>
        <span class="grow"></span>
        <button class="font-down" title="Smaller text">A−</button>
        <button class="font-up"   title="Larger text">A+</button>
        <button class="close"     title="Close (Esc)">×</button>
      </div>
      <div class="zpwr-reader-article">
        <h1 class="zpwr-reader-title">${escapeHtml(meta.title)}</h1>
        <div class="zpwr-reader-meta">
          ${meta.byline ? escapeHtml(meta.byline) + "<span class='sep'>·</span>" : ""}
          <a href="${escapeHtml(location.href)}" target="_blank" rel="noopener">${escapeHtml(meta.siteName)}</a>
          ${meta.published ? "<span class='sep'>·</span>" + escapeHtml(meta.published.slice(0, 10)) : ""}
        </div>
        <div class="zpwr-reader-content"></div>
      </div>
    `;
    overlay.querySelector(".zpwr-reader-content").appendChild(cleaned);
    ensureStyle(s);
    document.documentElement.appendChild(overlay);
    overlay.querySelector(".close").addEventListener("click", hide);
    overlay.querySelector(".font-up").addEventListener("click", () => bumpFs(+1));
    overlay.querySelector(".font-down").addEventListener("click", () => bumpFs(-1));
    document.addEventListener("keydown", onEsc, true);
  }

  function hide() {
    document.getElementById(OVERLAY_ID)?.remove();
    document.removeEventListener("keydown", onEsc, true);
  }

  function toggle() {
    if (document.getElementById(OVERLAY_ID)) { hide(); return; }
    chrome.storage?.local?.get?.(STATE_KEY, (bag) => show(bag?.[STATE_KEY]));
  }

  function onEsc(ev) { if (ev.key === "Escape") hide(); }

  function bumpFs(delta) {
    chrome.storage?.local?.get?.(STATE_KEY, (bag) => {
      const s = { ...DEFAULTS, ...(bag?.[STATE_KEY] || {}) };
      s.fontSize = clampFs(s.fontSize + delta);
      chrome.storage.local.set({ [STATE_KEY]: s }, () => ensureStyle(s));
    });
  }

  // ─── Message bridge ────────────────────────────────────────────────
  chrome.runtime?.onMessage?.addListener?.((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "reader-mode:toggle") { toggle(); sendResponse({ ok: true }); }
    else if (msg.type === "reader-mode:on")  { show(msg.settings); sendResponse({ ok: true }); }
    else if (msg.type === "reader-mode:off") { hide(); sendResponse({ ok: true }); }
  });

  window.__zpwrReaderMode = { show, hide, toggle };
})();
