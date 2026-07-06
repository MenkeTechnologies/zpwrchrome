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

// Light-mode neutral overrides (from cyberpunk.css [data-theme="light"]). zpwr's
// pages hardcode data-theme="dark" and use var(--bg-primary) etc., so flipping
// these vars (+ the attribute) turns the whole UI light — matching the HUD.
const LIGHT_VARS = {
  "--bg-primary": "#f0f2f5", "--bg-secondary": "#e4e7ec", "--bg-card": "#ffffff", "--bg-hover": "#f7f8fa",
  "--text": "#1e293b", "--text-dim": "#475569", "--text-muted": "#94a3b8", "--border": "#cbd5e1", "--border-glow": "#a5b4c8",
};
let curScheme = DEFAULT_SCHEME;
let curLight = false;

function apply(id, light) {
  if (id != null) curScheme = id;
  if (light != null) curLight = light;
  const vars = Object.assign({}, varsFor(curScheme || DEFAULT_SCHEME));
  if (curLight) Object.assign(vars, LIGHT_VARS);
  const root = document.documentElement.style;
  for (const k in vars) root.setProperty(k, vars[k]);
  try { document.documentElement.setAttribute("data-theme", curLight ? "light" : "dark"); } catch (e) {}
}

// Recoloring only makes sense on a page with a DOM. The service worker
// pulls this module in transitively (background.js → dl-settings.js →
// page-nav.js → here), and there `document` is undefined, so skip the
// storage wiring entirely rather than crashing apply() with a
// "document is not defined" ReferenceError.
if (typeof document !== "undefined") {
  // Initial paint: read the saved scheme + light flag and override CSS defaults.
  chrome.storage?.local?.get?.([UI_SCHEME_KEY, UI_LIGHT_KEY], (bag) => {
    apply(bag?.[UI_SCHEME_KEY] ?? DEFAULT_SCHEME, !!bag?.[UI_LIGHT_KEY]);
  });

  // Live updates: scheme picker OR the HUD's light-mode toggle (via ui.light).
  chrome.storage?.onChanged?.addListener?.((changes, area) => {
    if (area !== "local") return;
    if (changes[UI_SCHEME_KEY]) apply(changes[UI_SCHEME_KEY].newValue, null);
    if (changes[UI_LIGHT_KEY]) apply(null, !!changes[UI_LIGHT_KEY].newValue);
  });
}
