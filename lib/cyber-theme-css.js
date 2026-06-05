// zpwrchrome Cyberpunk HUD theme — page-side CSS builder.
//
// Composes a stylesheet that recolors arbitrary pages to the
// strykelang HUD palette without rewriting their HTML. Pure function:
// the content script just calls `buildThemeCss(opts)` and shoves the
// result into a single `<style>` tag.
//
// Knobs (opts):
//   intensity: "subtle" | "medium" | "full"  (default "medium")
//     - subtle: links + headings + scrollbars only; backgrounds untouched
//     - medium: + page background + form fields + code blocks
//     - full:   + tables / cards / images dimmed; everything carries the palette
//   forceMono: boolean  (default false) — override every font to Share Tech Mono
//   scanlines: boolean  (default false)  — CRT-style horizontal scanline overlay
//   darkMode:  boolean  (default false)  — Smart dark overlay: `color-scheme:
//                                          dark` to opt the page into browser-
//                                          level dark adaptations, plus targeted
//                                          overrides for common white-card
//                                          patterns (Amazon AUI `.a-box`,
//                                          generic [class*="card"|"panel"|
//                                          "widget"], ARIA dialogs, inline
//                                          white backgrounds). Does NOT use
//                                          CSS filter inversion — that fights
//                                          pages which are already dark.
//
// All declarations use `!important` because we're competing against the
// site's own author styles. Selectors are intentionally broad — this is
// a "vibe filter," not a per-element editor.

export const THEME = Object.freeze({
  bgPrimary:   "#05050a",
  bgSecondary: "#0a0a14",
  bgCard:      "#0d0d1a",
  bgHover:     "#12122a",
  cyan:        "#05d9e8",
  cyanGlow:    "rgba(5,217,232,0.4)",
  accent:      "#ff2a6d",
  accentGlow:  "rgba(255,42,109,0.4)",
  magenta:     "#d300c5",
  orange:      "#ff8c1a",
  green:       "#39ff14",
  yellow:      "#ffb800",
  text:        "#e0f0ff",
  textDim:     "#7a8ba8",
  textMuted:   "#3d4f6a",
  border:      "#1a1a3e",
  fontStack:   "'Share Tech Mono', 'SF Mono', 'Fira Code', monospace",
});

export function buildThemeCss(opts) {
  const o = opts || {};
  const intensity = o.intensity || "medium";
  const forceMono = !!o.forceMono;
  const scanlines = !!o.scanlines;
  const darkMode  = !!o.darkMode;
  const t = THEME;
  const parts = [];

  // ─── Smart dark mode (no inversion) ──────────────────────────────
  //     Earlier versions used `filter: invert(0.92)` on <html>, which
  //     darkened light pages but ALSO inverted already-dark pages (so
  //     a Slack-style dark UI became blinding white). This replacement
  //     uses two cooperative mechanisms:
  //       1. `color-scheme: dark` — tells the browser the page wants
  //          dark form controls / scrollbars / canvas paint.
  //       2. Targeted overrides on common white-card patterns: AUI
  //          `.a-box` (Amazon), generic [class*="card|panel|widget"],
  //          ARIA dialogs, and any inline `background: white`.
  //     Pages that are already dark (rgb(15,15,15) backgrounds, etc.)
  //     stay dark — we only darken EXPLICIT light cards.
  if (darkMode) {
    parts.push(`
      html { color-scheme: dark !important; }

      /* Generic light-card patterns. These class-name substrings are
         widely used across frameworks (Bootstrap, Tailwind UI, Amazon
         AUI, MUI) to mark panels/cards/widgets that default to white. */
      [class*="card"], [class*="panel"], [class*="widget"],
      [class*="box"]:not(html):not(body) {
        background-color: ${t.bgCard} !important;
        color: ${t.text} !important;
        border-color: ${t.border} !important;
      }

      /* Amazon AUI (.a-box family) + order-page-specific classes. */
      .a-box, .a-box-inner, .a-popover-wrapper, .a-popover-inner,
      .a-section.a-spacing-medium, .order-header, .delivery-box,
      .item-box, .a-color-offset-background,
      .bia-content, .celwidget {
        background-color: ${t.bgCard} !important;
        color: ${t.text} !important;
      }
      .a-color-base, .a-color-state { color: ${t.text} !important; }
      .a-color-secondary, .a-color-tertiary { color: ${t.textDim} !important; }
      .a-color-link, .a-link-normal { color: ${t.cyan} !important; }

      /* Catch inline white/near-white backgrounds anywhere — covers
         ad iframes, modal shells, third-party widgets that hardcode
         a white panel in the style attribute. */
      [style*="background-color: white"],
      [style*="background-color:white"],
      [style*="background-color: #fff"],
      [style*="background-color:#fff"],
      [style*="background-color: #ffffff"],
      [style*="background-color:#ffffff"],
      [style*="background-color: rgb(255, 255, 255)"],
      [style*="background-color: rgb(251, 251, 251)"],
      [style*="background: white"],
      [style*="background:#fff"],
      [style*="background: #fff"] {
        background-color: ${t.bgCard} !important;
      }

      /* ARIA modals / native dialogs / popover API. */
      [role="dialog"], [role="alertdialog"], [role="tooltip"],
      [role="menu"], [role="listbox"],
      dialog, [popover] {
        background-color: ${t.bgCard} !important;
        color: ${t.text} !important;
        border-color: ${t.border} !important;
      }
    `);
  }

  // ─── Subtle layer (always applied) ───────────────────────────────
  parts.push(`
    html { color-scheme: dark !important; }
    a, a:visited {
      color: ${t.cyan} !important;
      text-decoration-color: ${t.cyan} !important;
    }
    a:hover {
      color: ${t.orange} !important;
      text-shadow: 0 0 6px rgba(255,140,26,0.4) !important;
    }
    h1, h2, h3, h4, h5, h6 {
      color: ${t.cyan} !important;
      letter-spacing: 0.5px !important;
    }
    ::selection {
      background: ${t.cyan} !important;
      color: ${t.bgPrimary} !important;
    }
    ::-webkit-scrollbar { width: 10px !important; height: 10px !important; }
    ::-webkit-scrollbar-track { background: ${t.bgPrimary} !important; }
    ::-webkit-scrollbar-thumb {
      background: linear-gradient(180deg, ${t.cyan}, ${t.magenta}) !important;
      border-radius: 4px !important;
      box-shadow: 0 0 6px ${t.cyanGlow} !important;
    }
  `);

  // ─── Medium layer ────────────────────────────────────────────────
  if (intensity === "medium" || intensity === "full") {
    parts.push(`
      html, body {
        background-color: ${t.bgPrimary} !important;
        color: ${t.text} !important;
      }
      body, [class*="content"], [class*="main"], main, article, section {
        background-color: ${t.bgPrimary} !important;
        color: ${t.text} !important;
      }
      header, nav, aside, footer {
        background-color: ${t.bgSecondary} !important;
        color: ${t.text} !important;
        border-color: ${t.border} !important;
      }
      input, textarea, select, button {
        background-color: ${t.bgCard} !important;
        color: ${t.text} !important;
        border: 1px solid ${t.border} !important;
        border-radius: 2px !important;
      }
      input:focus, textarea:focus, select:focus {
        outline: none !important;
        border-color: ${t.cyan} !important;
        box-shadow: 0 0 6px ${t.cyanGlow} !important;
      }
      button {
        cursor: pointer !important;
        letter-spacing: 0.5px !important;
      }
      button:hover {
        color: ${t.cyan} !important;
        border-color: ${t.cyan} !important;
        background-color: ${t.bgHover} !important;
      }
      code, pre, kbd, samp, tt {
        background-color: ${t.bgCard} !important;
        color: ${t.orange} !important;
        border-radius: 2px !important;
        padding: 0 4px !important;
      }
      pre {
        padding: 10px 14px !important;
        border-left: 3px solid ${t.cyan} !important;
      }
      hr {
        border: none !important;
        border-top: 1px solid ${t.border} !important;
      }
    `);
  }

  // ─── Full layer ──────────────────────────────────────────────────
  if (intensity === "full") {
    parts.push(`
      div, span, p, li, td, th, dt, dd, blockquote, label {
        color: ${t.text} !important;
        border-color: ${t.border} !important;
      }
      [class*="card"], [class*="panel"], [class*="box"], [class*="container"] {
        background-color: ${t.bgCard} !important;
      }
      table, th, td {
        border: 1px solid ${t.border} !important;
        background-color: transparent !important;
      }
      thead, tr:nth-child(odd) {
        background-color: ${t.bgSecondary} !important;
      }
      img, video {
        opacity: 0.88 !important;
        filter: contrast(1.05) saturate(1.1) !important;
      }
      img:hover, video:hover { opacity: 1 !important; }
      blockquote {
        border-left: 3px solid ${t.magenta} !important;
        padding-left: 14px !important;
        color: ${t.textDim} !important;
      }
      [class*="badge"], [class*="tag"], [class*="chip"] {
        background-color: ${t.bgHover} !important;
        color: ${t.cyan} !important;
        border: 1px solid ${t.cyan} !important;
        border-radius: 2px !important;
      }
      [role="button"]:hover, [class*="btn"]:hover {
        color: ${t.cyan} !important;
        border-color: ${t.cyan} !important;
      }
    `);
  }

  // ─── Optional knobs ──────────────────────────────────────────────
  if (forceMono) {
    // Exclude common icon-font carriers — Font Awesome, Material Icons,
    // Lucide, app-bundled glyph fonts (`<i class="icon-...">`), and SVGs.
    // Forcing Share Tech Mono on those elements drops the PUA codepoints
    // that draw the actual icon glyphs, leaving tofu `[]` boxes.
    parts.push(`
      *:not(code):not(pre):not(kbd):not(samp):not(tt):not(i):not(svg):not(svg *):not([class*="icon"]):not([class*="Icon"]):not([class*="fa-"]):not([class*="material-icons"]):not([class*="lucide"]):not([data-icon]) {
        font-family: ${t.fontStack} !important;
      }
    `);
  }

  if (scanlines) {
    parts.push(`
      body::after {
        content: "" !important;
        position: fixed !important; inset: 0 !important;
        pointer-events: none !important; z-index: 2147483646 !important;
        background:
          repeating-linear-gradient(
            0deg,
            transparent 0px, transparent 2px,
            rgba(5,217,232,0.025) 2px, rgba(5,217,232,0.025) 3px
          ) !important;
        mix-blend-mode: screen !important;
      }
    `);
  }

  return parts.join("\n");
}

// hostnameOf(url) → string. Used by the content script to gate per-host
// blocklist matches before the CSS injection runs.
export function hostnameOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

// shouldApplyTo(host, settings) → boolean. Pure routing decision.
// settings: { enabled, mode: "all"|"blocklist"|"allowlist", domains: [host] }.
// Mode default is "all".
export function shouldApplyTo(host, settings) {
  if (!settings || !settings.enabled) return false;
  const mode = settings.mode || "all";
  const domains = (settings.domains || []).map((d) => String(d).toLowerCase());
  const h = String(host || "").toLowerCase();
  const matches = domains.some((d) => h === d || h.endsWith("." + d));
  if (mode === "all")       return !matches;   // domains[] is blocklist
  if (mode === "blocklist") return !matches;   // explicit synonym
  if (mode === "allowlist") return matches;
  return false;
}
