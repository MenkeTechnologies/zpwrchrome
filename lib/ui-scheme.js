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

function apply(id) {
  const vars = varsFor(id || DEFAULT_SCHEME);
  const root = document.documentElement.style;
  for (const k in vars) root.setProperty(k, vars[k]);
}

// Recoloring only makes sense on a page with a DOM. The service worker
// pulls this module in transitively (background.js → dl-settings.js →
// page-nav.js → here), and there `document` is undefined, so skip the
// storage wiring entirely rather than crashing apply() with a
// "document is not defined" ReferenceError.
if (typeof document !== "undefined") {
  // Initial paint: read the saved scheme and override the CSS defaults.
  chrome.storage?.local?.get?.(UI_SCHEME_KEY, (bag) => {
    apply(bag?.[UI_SCHEME_KEY]);
  });

  // Live updates from the picker (or any other page).
  chrome.storage?.onChanged?.addListener?.((changes, area) => {
    if (area !== "local" || !changes[UI_SCHEME_KEY]) return;
    apply(changes[UI_SCHEME_KEY].newValue);
  });
}
