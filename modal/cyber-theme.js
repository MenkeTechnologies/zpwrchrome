// zpwrchrome — cyberpunk HUD theme injector.
//
// Reads settings from chrome.storage.local and conditionally injects a
// `<style id="zpwr-cyber-theme">` tag into every http(s) tab. Reacts
// to settings changes (storage onChanged) so flipping the toggle in
// scripts-manager/theme-injector.html takes effect without a reload.
//
// Self-contained — content scripts can't import. The pure CSS builder
// in lib/cyber-theme-css.js is duplicated here in minimized form.

(function () {
  "use strict";

  const STYLE_ID = "zpwr-cyber-theme";
  const STATE_KEY = "theme.injector";
  const PALETTE = {
    bgPrimary:   "#05050a",
    bgSecondary: "#0a0a14",
    bgCard:      "#0d0d1a",
    bgHover:     "#12122a",
    cyan:        "#05d9e8",
    cyanGlow:    "rgba(5,217,232,0.4)",
    accent:      "#ff2a6d",
    magenta:     "#d300c5",
    orange:      "#ff8c1a",
    text:        "#e0f0ff",
    textDim:     "#7a8ba8",
    border:      "#1a1a3e",
    fontStack:   "'Share Tech Mono', 'SF Mono', 'Fira Code', monospace",
  };

  function hostnameOf(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
  }
  function shouldApplyTo(host, s) {
    if (!s || !s.enabled) return false;
    const mode = s.mode || "all";
    const domains = (s.domains || []).map((d) => String(d).toLowerCase());
    const h = String(host || "").toLowerCase();
    const matches = domains.some((d) => h === d || h.endsWith("." + d));
    if (mode === "all")       return !matches;
    if (mode === "blocklist") return !matches;
    if (mode === "allowlist") return matches;
    return false;
  }

  function buildCss(opts) {
    const o = opts || {};
    const intensity = o.intensity || "medium";
    const forceMono = !!o.forceMono;
    const scanlines = !!o.scanlines;
    const t = PALETTE;
    const parts = [];

    parts.push(`
      html { color-scheme: dark !important; }
      a, a:visited { color: ${t.cyan} !important; text-decoration-color: ${t.cyan} !important; }
      a:hover { color: ${t.orange} !important; text-shadow: 0 0 6px rgba(255,140,26,0.4) !important; }
      h1, h2, h3, h4, h5, h6 { color: ${t.cyan} !important; letter-spacing: 0.5px !important; }
      ::selection { background: ${t.cyan} !important; color: ${t.bgPrimary} !important; }
      ::-webkit-scrollbar { width: 10px !important; height: 10px !important; }
      ::-webkit-scrollbar-track { background: ${t.bgPrimary} !important; }
      ::-webkit-scrollbar-thumb { background: linear-gradient(180deg, ${t.cyan}, ${t.magenta}) !important; border-radius: 4px !important; box-shadow: 0 0 6px ${t.cyanGlow} !important; }
    `);

    if (intensity === "medium" || intensity === "full") {
      parts.push(`
        html, body { background-color: ${t.bgPrimary} !important; color: ${t.text} !important; }
        body, main, article, section { background-color: ${t.bgPrimary} !important; color: ${t.text} !important; }
        header, nav, aside, footer { background-color: ${t.bgSecondary} !important; color: ${t.text} !important; border-color: ${t.border} !important; }
        input, textarea, select, button { background-color: ${t.bgCard} !important; color: ${t.text} !important; border: 1px solid ${t.border} !important; border-radius: 2px !important; }
        input:focus, textarea:focus, select:focus { outline: none !important; border-color: ${t.cyan} !important; box-shadow: 0 0 6px ${t.cyanGlow} !important; }
        button { cursor: pointer !important; letter-spacing: 0.5px !important; }
        button:hover { color: ${t.cyan} !important; border-color: ${t.cyan} !important; background-color: ${t.bgHover} !important; }
        code, pre, kbd, samp, tt { background-color: ${t.bgCard} !important; color: ${t.orange} !important; border-radius: 2px !important; padding: 0 4px !important; }
        pre { padding: 10px 14px !important; border-left: 3px solid ${t.cyan} !important; }
        hr { border: none !important; border-top: 1px solid ${t.border} !important; }
      `);
    }

    if (intensity === "full") {
      parts.push(`
        div, span, p, li, td, th, dt, dd, blockquote, label { color: ${t.text} !important; border-color: ${t.border} !important; }
        [class*="card"], [class*="panel"], [class*="box"] { background-color: ${t.bgCard} !important; }
        table, th, td { border: 1px solid ${t.border} !important; background-color: transparent !important; }
        thead, tr:nth-child(odd) { background-color: ${t.bgSecondary} !important; }
        img, video { opacity: 0.88 !important; filter: contrast(1.05) saturate(1.1) !important; }
        img:hover, video:hover { opacity: 1 !important; }
        blockquote { border-left: 3px solid ${t.magenta} !important; padding-left: 14px !important; color: ${t.textDim} !important; }
        [class*="badge"], [class*="tag"], [class*="chip"] { background-color: ${t.bgHover} !important; color: ${t.cyan} !important; border: 1px solid ${t.cyan} !important; border-radius: 2px !important; }
      `);
    }
    if (forceMono) {
      parts.push(`*:not(code):not(pre):not(kbd):not(samp):not(tt) { font-family: ${t.fontStack} !important; }`);
    }
    if (scanlines) {
      parts.push(`
        body::after {
          content: "" !important;
          position: fixed !important; inset: 0 !important;
          pointer-events: none !important; z-index: 2147483646 !important;
          background: repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(5,217,232,0.025) 2px, rgba(5,217,232,0.025) 3px) !important;
          mix-blend-mode: screen !important;
        }
      `);
    }
    return parts.join("\n");
  }

  function applyTheme(settings) {
    const host = hostnameOf(location.href);
    const should = shouldApplyTo(host, settings);
    const existing = document.getElementById(STYLE_ID);
    if (!should) {
      if (existing) existing.remove();
      return;
    }
    const css = buildCss(settings);
    if (existing) {
      if (existing.textContent !== css) existing.textContent = css;
      return;
    }
    const tag = document.createElement("style");
    tag.id = STYLE_ID;
    tag.textContent = css;
    (document.head || document.documentElement).appendChild(tag);
  }

  // Initial pass — read settings and apply.
  chrome.storage?.local?.get?.(STATE_KEY, (bag) => {
    applyTheme(bag?.[STATE_KEY]);
  });

  // React to settings changes pushed from the manager page.
  chrome.storage?.onChanged?.addListener?.((changes, area) => {
    if (area !== "local" || !changes[STATE_KEY]) return;
    applyTheme(changes[STATE_KEY].newValue);
  });
})();
