// zpwrchrome — applies the chosen color scheme to zpwrchrome's OWN pages.
//
// Every dashboard page imports lib/page-nav.js (which imports this), and
// popup.js imports it directly, so one chosen scheme recolors every
// extension surface. Each page's CSS still ships the Cyberpunk palette as
// its :root default (kept in sync with the Chrome theme package — see
// tests/theme.test.js); this module overrides those vars at runtime via
// inline style on documentElement, which wins over the stylesheet :root.
//
// Persisted in chrome.storage.local["ui.scheme"]. storage.onChanged keeps
// every open page live, so switching the scheme in the theme-injector page
// recolors the popup/dashboards already on screen without a reload.

import { varsFor, DEFAULT_SCHEME } from "./color-schemes.js";

export const UI_SCHEME_KEY = "ui.scheme";
export const UI_LIGHT_KEY = "ui.light";
export const UI_PALETTE_KEY = "ui.palette";

// A custom/edited scheme has no entry in the vendored table; it's identified by a
// 'custom' / 'custom-N' name and rendered from ui.palette (the host's resolved map).
function isCustomScheme(id) { return id === "custom" || (typeof id === "string" && id.startsWith("custom-")); }

// Light-mode neutral overrides (from cyberpunk.css [data-theme="light"]). zpwr's
// pages hardcode data-theme="dark" and use var(--bg-primary) etc., so flipping
// these vars (+ the attribute) turns the whole UI light — matching the HUD.
const LIGHT_VARS = {
  "--bg-primary": "#f0f2f5", "--bg-secondary": "#e4e7ec", "--bg-card": "#ffffff", "--bg-hover": "#f7f8fa",
  "--text": "#1e293b", "--text-dim": "#475569", "--text-muted": "#94a3b8", "--border": "#cbd5e1", "--border-glow": "#a5b4c8",
};
let curScheme = DEFAULT_SCHEME;
let curLight = false;
let curPalette = null;

function apply(id, light, palette) {
  if (id != null) curScheme = id;
  if (light != null) curLight = light;
  if (palette !== undefined) curPalette = palette;
  const root = document.documentElement.style;
  if (isCustomScheme(curScheme) && curPalette && Object.keys(curPalette).length) {
    // Custom scheme: the host's palette is already resolved (glow/dim/bg + light),
    // so apply every var straight — do NOT overlay the named-scheme LIGHT_VARS.
    for (const k in curPalette) root.setProperty(k, curPalette[k]);
  } else {
    const vars = Object.assign({}, varsFor(curScheme || DEFAULT_SCHEME));
    if (curLight) Object.assign(vars, LIGHT_VARS);
    for (const k in vars) root.setProperty(k, vars[k]);
  }
  try { document.documentElement.setAttribute("data-theme", curLight ? "light" : "dark"); } catch (e) {}
}

// Recoloring only makes sense on a page with a DOM. The service worker
// pulls this module in transitively (background.js → dl-settings.js →
// page-nav.js → here), and there `document` is undefined, so skip the
// storage wiring entirely rather than crashing apply() with a
// "document is not defined" ReferenceError.
if (typeof document !== "undefined") {
  // Initial paint: read the saved scheme + light flag + custom palette and override CSS defaults.
  chrome.storage?.local?.get?.([UI_SCHEME_KEY, UI_LIGHT_KEY, UI_PALETTE_KEY], (bag) => {
    apply(bag?.[UI_SCHEME_KEY] ?? DEFAULT_SCHEME, !!bag?.[UI_LIGHT_KEY], bag?.[UI_PALETTE_KEY] ?? null);
  });

  // Live updates: scheme picker, the HUD's light-mode toggle (ui.light), or a
  // custom scheme's resolved palette (ui.palette) pushed from the host.
  chrome.storage?.onChanged?.addListener?.((changes, area) => {
    if (area !== "local") return;
    if (changes[UI_SCHEME_KEY]) apply(changes[UI_SCHEME_KEY].newValue, null, undefined);
    if (changes[UI_LIGHT_KEY]) apply(null, !!changes[UI_LIGHT_KEY].newValue, undefined);
    if (changes[UI_PALETTE_KEY]) apply(null, null, changes[UI_PALETTE_KEY].newValue);
  });
}
