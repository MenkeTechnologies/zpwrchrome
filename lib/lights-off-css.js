// zpwrchrome — "Turn off the lights" cinema overlay (pure helpers).
//
// Port of the popular Turn Off the Lights Chrome extension. The
// overlay dims the page, the active <video> element is lifted above
// the overlay via z-index so it appears in spotlight. This module is
// the pure-function half: defaults, host routing, the inline-style
// string for the overlay div. Content script in modal/lights-off.js
// imports nothing (Chrome content scripts can't `import`); it
// duplicates the relevant helpers inline.

export const OVERLAY_ID = "zpwr-lights-off-overlay";
export const LIFT_ATTR  = "data-zpwr-lights-lifted";

// Stacking-context boundaries. The video chain runs at MAX_Z, the
// overlay sits one below so it covers everything except the lifted
// video. Two-int gap leaves room for future overlays (toolbars).
export const MAX_Z     = 2147483647;
export const OVERLAY_Z = 2147483646;

export const DEFAULTS = Object.freeze({
  opacity:  0.85,
  fadeMs:   300,
  color:    "#000000",
  mode:     "all",        // "all" | "blocklist" | "allowlist"
  domains:  [],
  autoOn:   false,        // auto-dim when a <video> is detected
  liftPlayer: true,       // also lift the video's player container
});

export function hostnameOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

// shouldApply(host, settings) — same routing model as the cyber-theme
// injector. `all` and `blocklist` are synonyms (domains[] excludes);
// `allowlist` flips the polarity.
export function shouldApply(host, settings) {
  const s = settings || DEFAULTS;
  const mode = s.mode || "all";
  const domains = (s.domains || []).map((d) => String(d).toLowerCase());
  const h = String(host || "").toLowerCase();
  const matches = domains.some((d) => h === d || h.endsWith("." + d));
  if (mode === "all" || mode === "blocklist") return !matches;
  if (mode === "allowlist") return matches;
  return false;
}

// Inline style string for the overlay <div>. We start at opacity 0 so
// the requestAnimationFrame fade-in works; the content script flips
// to the configured opacity after the next paint.
export function buildOverlayStyles(opts) {
  const o = { ...DEFAULTS, ...(opts || {}) };
  const ms = Math.max(0, Math.min(60000, Number(o.fadeMs) || 0));
  return [
    "position: fixed !important",
    "inset: 0 !important",
    "top: 0 !important", "left: 0 !important",
    "right: 0 !important", "bottom: 0 !important",
    "width: 100vw !important", "height: 100vh !important",
    `background-color: ${o.color} !important`,
    "opacity: 0 !important",
    `z-index: ${OVERLAY_Z} !important`,
    "cursor: pointer !important",
    `transition: opacity ${ms}ms ease-in-out !important`,
    "pointer-events: auto !important",
    "margin: 0 !important", "padding: 0 !important",
    "border: none !important", "outline: none !important",
    "display: block !important",
  ].join("; ");
}

// Clamp opacity to [0, 1]. Anything else falls back to the default
// so a malformed settings bag doesn't paint a fully-opaque overlay.
export function clampOpacity(v) {
  const n = Number(v);
  if (!isFinite(n)) return DEFAULTS.opacity;
  return Math.max(0, Math.min(1, n));
}

// Pretty hex-color guard for the settings UI's color picker. Returns
// the original string if it's a valid 3- or 6-digit hex, else the
// default color. (Used only for input validation, not CSS injection
// — CSS gets the raw string because the browser will reject bad
// values via the CSSOM anyway.)
export function sanitizeColor(c) {
  if (typeof c !== "string") return DEFAULTS.color;
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c) ? c : DEFAULTS.color;
}
