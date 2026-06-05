// zpwrchrome Reader Mode — pure helpers.
//
// Reader mode strips the active page to its main article and re-renders
// it inside a fixed-position overlay with the strykelang HUD palette.
// This module is the pure-function half: defaults, the CSS builder,
// reading-time estimation. The content script in modal/reader-mode.js
// owns DOM extraction (heuristic-based, no Readability.js dependency)
// and overlay lifecycle.

export const OVERLAY_ID    = "zpwr-reader-mode";
export const STYLE_ID      = "zpwr-reader-mode-style";
export const PREV_HIDDEN   = "data-zpwr-reader-prev-hidden";
export const STATE_KEY     = "reader.mode";

// Four typographic themes — cyberpunk is the brand default, the other
// three exist so the user can A/B against more traditional reader UIs.
export const THEMES = Object.freeze({
  cyberpunk:     { bg: "#05050a", panel: "#0a0a14", text: "#e0f0ff", muted: "#7a8ba8", accent: "#05d9e8", accent2: "#ff8c1a", accent3: "#d300c5", border: "#1a1a3e" },
  "classic-dark":{ bg: "#1a1a1a", panel: "#252525", text: "#e8e8e8", muted: "#9a9a9a", accent: "#5b9aff", accent2: "#ffa657", accent3: "#bf91e8", border: "#3a3a3a" },
  "classic-light":{ bg: "#fbfbf9", panel: "#f0eee5", text: "#1a1a1a", muted: "#666",    accent: "#0066cc", accent2: "#cc5500", accent3: "#7c2d92", border: "#d0cec0" },
  sepia:         { bg: "#f4ecd8", panel: "#ebe1c8", text: "#3b2f1e", muted: "#776444", accent: "#7a4a1a", accent2: "#8a3b0a", accent3: "#5b3010", border: "#cebd91" },
});

// Three font families — mono = brand, serif = long-form reading,
// sans = modern web. Each falls through to widely-installed fonts so
// we never ship a webfont over the wire.
export const FONT_STACKS = Object.freeze({
  mono:  "'Share Tech Mono', 'SF Mono', 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
  serif: "Iowan Old Style, 'Apple Garamond', Baskerville, 'Times New Roman', 'Droid Serif', Times, 'Source Serif Pro', serif",
  sans:  "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
});

export const DEFAULTS = Object.freeze({
  theme:      "cyberpunk",
  font:       "mono",
  fontSize:   16,
  lineWidth:  65,        // ch units — text column width
  lineHeight: 1.65,
  scanlines:  false,     // inherit from the page-theme injector's CRT effect
});

// Words per minute — the standard reading-rate constant used by every
// major reader extension (Pocket, Reader View, Instapaper).
export const WORDS_PER_MIN = 200;

export function estimateReadingTime(text) {
  if (!text || typeof text !== "string") return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MIN));
}

// clampFontSize / clampLineWidth — settings come from a slider, but
// defensive clamps protect against a malformed bag injecting a 1px
// font (unreadable) or a 200ch column (overflows on phones).
export function clampFontSize(v) {
  const n = Number(v);
  if (!isFinite(n)) return DEFAULTS.fontSize;
  return Math.max(12, Math.min(28, Math.round(n)));
}
export function clampLineWidth(v) {
  const n = Number(v);
  if (!isFinite(n)) return DEFAULTS.lineWidth;
  return Math.max(40, Math.min(120, Math.round(n)));
}
export function clampLineHeight(v) {
  const n = Number(v);
  if (!isFinite(n)) return DEFAULTS.lineHeight;
  return Math.max(1.2, Math.min(2.4, Number(n.toFixed(2))));
}

export function pickTheme(name)   { return THEMES[name] || THEMES[DEFAULTS.theme]; }
export function pickFontStack(n)  { return FONT_STACKS[n] || FONT_STACKS[DEFAULTS.font]; }

// buildReaderCss(opts) — the stylesheet for the reader-mode overlay.
// Scoped under `#zpwr-reader-mode` so it never bleeds into the host
// page (the overlay itself sits on top of the host DOM, but a misfired
// `:where(body)` rule could still leak — scoping by id sidesteps that).
export function buildReaderCss(opts) {
  const o = { ...DEFAULTS, ...(opts || {}) };
  const t = pickTheme(o.theme);
  const f = pickFontStack(o.font);
  const fs = clampFontSize(o.fontSize);
  const lw = clampLineWidth(o.lineWidth);
  const lh = clampLineHeight(o.lineHeight);
  return `
    #${OVERLAY_ID} {
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483647 !important;
      overflow-y: auto !important;
      background-color: ${t.bg} !important;
      color: ${t.text} !important;
      font-family: ${f} !important;
      font-size: ${fs}px !important;
      line-height: ${lh} !important;
      padding: 56px 24px 80px !important;
      box-sizing: border-box !important;
    }
    #${OVERLAY_ID} .zpwr-reader-bar {
      position: fixed; top: 0; left: 0; right: 0;
      display: flex; align-items: center; gap: 14px;
      padding: 8px 14px;
      background-color: ${t.panel};
      border-bottom: 1px solid ${t.border};
      font-family: ${FONT_STACKS.mono};
      font-size: 11px;
      color: ${t.muted};
      letter-spacing: 1px;
      z-index: 1;
    }
    #${OVERLAY_ID} .zpwr-reader-bar .grow { flex: 1; }
    #${OVERLAY_ID} .zpwr-reader-bar a,
    #${OVERLAY_ID} .zpwr-reader-bar button {
      color: ${t.accent}; background: none; border: none; padding: 0;
      font: inherit; cursor: pointer; text-decoration: none;
    }
    #${OVERLAY_ID} .zpwr-reader-bar button:hover,
    #${OVERLAY_ID} .zpwr-reader-bar a:hover { color: ${t.accent2}; }
    #${OVERLAY_ID} .zpwr-reader-article {
      max-width: ${lw}ch;
      margin: 0 auto;
    }
    #${OVERLAY_ID} h1, #${OVERLAY_ID} h2,
    #${OVERLAY_ID} h3, #${OVERLAY_ID} h4,
    #${OVERLAY_ID} h5, #${OVERLAY_ID} h6 {
      color: ${t.accent} !important;
      letter-spacing: 0.5px;
      margin: 1.6em 0 0.6em;
      line-height: 1.25;
    }
    #${OVERLAY_ID} h1 { font-size: 1.6em; }
    #${OVERLAY_ID} h2 { font-size: 1.35em; }
    #${OVERLAY_ID} h3 { font-size: 1.18em; }
    #${OVERLAY_ID} p, #${OVERLAY_ID} li, #${OVERLAY_ID} dd, #${OVERLAY_ID} dt {
      margin: 0 0 1em;
    }
    #${OVERLAY_ID} a {
      color: ${t.accent} !important;
      text-decoration: underline;
      text-decoration-color: ${t.border};
    }
    #${OVERLAY_ID} a:hover { color: ${t.accent2} !important; }
    #${OVERLAY_ID} blockquote {
      margin: 1em 0;
      padding: 8px 16px;
      border-left: 3px solid ${t.accent3};
      color: ${t.muted};
      font-style: italic;
    }
    #${OVERLAY_ID} code, #${OVERLAY_ID} kbd, #${OVERLAY_ID} samp {
      font-family: ${FONT_STACKS.mono};
      color: ${t.accent2};
      background: ${t.panel};
      padding: 1px 5px;
      border-radius: 2px;
      font-size: 0.92em;
    }
    #${OVERLAY_ID} pre {
      background: ${t.panel};
      border-left: 3px solid ${t.accent};
      padding: 12px 16px;
      overflow-x: auto;
      margin: 1em 0;
    }
    #${OVERLAY_ID} pre code { background: transparent; padding: 0; }
    #${OVERLAY_ID} hr {
      border: none;
      border-top: 1px solid ${t.border};
      margin: 2em 0;
    }
    #${OVERLAY_ID} img, #${OVERLAY_ID} video, #${OVERLAY_ID} picture {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 1em auto;
    }
    #${OVERLAY_ID} table {
      border-collapse: collapse;
      margin: 1em 0;
      width: 100%;
    }
    #${OVERLAY_ID} th, #${OVERLAY_ID} td {
      border: 1px solid ${t.border};
      padding: 6px 10px;
      text-align: left;
    }
    #${OVERLAY_ID} th {
      background: ${t.panel};
      color: ${t.accent};
    }
    #${OVERLAY_ID} .zpwr-reader-title {
      font-family: ${f};
      font-size: 1.9em;
      color: ${t.accent} !important;
      margin: 32px 0 8px;
      line-height: 1.2;
    }
    #${OVERLAY_ID} .zpwr-reader-meta {
      color: ${t.muted};
      font-size: 0.85em;
      margin-bottom: 24px;
      font-family: ${FONT_STACKS.mono};
      letter-spacing: 1px;
    }
    #${OVERLAY_ID} .zpwr-reader-meta a { color: ${t.muted} !important; }
    #${OVERLAY_ID} .zpwr-reader-meta .sep { margin: 0 8px; color: ${t.border}; }
    #${OVERLAY_ID} *::selection {
      background: ${t.accent};
      color: ${t.bg};
    }
    ${o.scanlines ? `
    #${OVERLAY_ID}::after {
      content: "" !important;
      position: fixed !important; inset: 0 !important;
      pointer-events: none !important; z-index: 2 !important;
      background: repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(5,217,232,0.025) 2px, rgba(5,217,232,0.025) 3px) !important;
      mix-blend-mode: screen !important;
    }` : ""}
  `;
}
