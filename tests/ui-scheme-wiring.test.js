// Tests for lib/ui-scheme.js's page wiring — the module-level storage read and
// storage.onChanged listener that recolor every open extension page. The
// pure resolveSchemeVars is covered in ui-scheme.test.js; this file drives the
// side-effecting half through fake `document` + `chrome` globals.
//
// The wiring only installs when `document` exists at import time (the service
// worker imports the module transitively and has no DOM), so each test installs
// the fakes first and imports a fresh module instance via a cache-busting query.

import { test } from "node:test";
import assert from "node:assert/strict";

import { COLOR_SCHEMES, DEFAULT_SCHEME, buildCustomScheme } from "../lib/color-schemes.js";
import { resolveSchemeVars, UI_SCHEME_KEY, UI_LIGHT_KEY, UI_PALETTE_KEY } from "../lib/ui-scheme.js";

let importSeq = 0;

// loadPage(saved) → { root, attrs, fire } after the module's initial paint.
//   root  — the documentElement.style var map as last written
//   attrs — documentElement attributes (data-theme)
//   fire(changes, area) — dispatch a storage.onChanged event
async function loadPage(saved) {
  const root = {};
  const attrs = {};
  const listeners = [];
  const doc = {
    documentElement: {
      style: { setProperty: (k, v) => { root[k] = v; } },
      setAttribute: (k, v) => { attrs[k] = v; },
    },
  };
  globalThis.document = doc;
  globalThis.chrome = {
    storage: {
      local: {
        get: (keys, cb) => {
          assert.deepEqual(keys, [UI_SCHEME_KEY, UI_LIGHT_KEY, UI_PALETTE_KEY]);
          cb(saved);
        },
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
  };
  try {
    await import(`../lib/ui-scheme.js?wiring=${++importSeq}`);
  } finally {
    delete globalThis.document;
    delete globalThis.chrome;
  }
  assert.equal(listeners.length, 1, "exactly one onChanged listener");
  // apply() reads the global `document` at call time, so re-install the fake
  // for the duration of each dispatch.
  const fire = (changes, area = "local") => {
    globalThis.document = doc;
    try { listeners[0](changes, area); } finally { delete globalThis.document; }
  };
  return { root, attrs, fire };
}

const change = (newValue) => ({ newValue });
const pick = (map, keys) => Object.fromEntries(keys.map((k) => [k, map[k]]));
const OTHER = Object.keys(COLOR_SCHEMES).find((id) => id !== DEFAULT_SCHEME);

test("initial paint: empty storage applies the default scheme in dark mode", async () => {
  const { root, attrs } = await loadPage({});
  assert.deepEqual(root, resolveSchemeVars(DEFAULT_SCHEME, false, null));
  assert.equal(attrs["data-theme"], "dark");
});

test("initial paint: a saved scheme + light flag are both honored", async () => {
  const { root, attrs } = await loadPage({ [UI_SCHEME_KEY]: OTHER, [UI_LIGHT_KEY]: true });
  assert.deepEqual(root, resolveSchemeVars(OTHER, true, null));
  assert.equal(attrs["data-theme"], "light");
});

test("initial paint: a saved custom scheme renders from the saved palette", async () => {
  const palette = buildCustomScheme({ "--accent": "#123456", "--bg-primary": "#010203" });
  const { root } = await loadPage({ [UI_SCHEME_KEY]: "custom-2", [UI_PALETTE_KEY]: palette });
  assert.equal(root["--accent"], "#123456");
  assert.equal(root["--bg-primary"], "#010203");
});

test("onChanged: events from areas other than 'local' are ignored", async () => {
  const page = await loadPage({});
  const before = { ...page.root };
  page.fire({ [UI_SCHEME_KEY]: change(OTHER), [UI_LIGHT_KEY]: change(true) }, "sync");
  assert.deepEqual(page.root, before);
  assert.equal(page.attrs["data-theme"], "dark");
});

test("onChanged: switching scheme keeps the current light flag", async () => {
  const page = await loadPage({ [UI_LIGHT_KEY]: true });
  page.fire({ [UI_SCHEME_KEY]: change(OTHER) });
  assert.deepEqual(page.root, resolveSchemeVars(OTHER, true, null));
  assert.equal(page.attrs["data-theme"], "light");
});

test("onChanged: light on then off restores the scheme's own dark neutrals", async () => {
  const page = await loadPage({ [UI_SCHEME_KEY]: OTHER });
  const dark = resolveSchemeVars(OTHER, false, null);
  page.fire({ [UI_LIGHT_KEY]: change(true) });
  assert.equal(page.attrs["data-theme"], "light");
  assert.notEqual(page.root["--bg-primary"], dark["--bg-primary"]);
  page.fire({ [UI_LIGHT_KEY]: change(false) });
  assert.equal(page.attrs["data-theme"], "dark");
  assert.deepEqual(pick(page.root, Object.keys(dark)), dark);
});

test("onChanged: a removed ui.light key (newValue undefined) means dark", async () => {
  const page = await loadPage({ [UI_LIGHT_KEY]: true });
  page.fire({ [UI_LIGHT_KEY]: change(undefined) });
  assert.equal(page.attrs["data-theme"], "dark");
});

test("onChanged: a pushed palette recolors a custom scheme but not a built-in one", async () => {
  const p1 = buildCustomScheme({ "--accent": "#111111" });
  const p2 = buildCustomScheme({ "--accent": "#222222" });

  const custom = await loadPage({ [UI_SCHEME_KEY]: "custom", [UI_PALETTE_KEY]: p1 });
  assert.equal(custom.root["--accent"], "#111111");
  custom.fire({ [UI_PALETTE_KEY]: change(p2) });
  assert.equal(custom.root["--accent"], "#222222");

  const builtin = await loadPage({ [UI_SCHEME_KEY]: OTHER });
  builtin.fire({ [UI_PALETTE_KEY]: change(p2) });
  assert.equal(builtin.root["--accent"], COLOR_SCHEMES[OTHER].vars["--accent"]);
});

test("onChanged: scheme + palette in one event apply together (palette not lost to ordering)", async () => {
  // The host writes ui.scheme and ui.palette in one storage.set when the user
  // picks a custom scheme; both must land regardless of which key is handled first.
  const page = await loadPage({});
  const palette = buildCustomScheme({ "--accent": "#abcdef" });
  page.fire({ [UI_SCHEME_KEY]: change("custom-1"), [UI_PALETTE_KEY]: change(palette) });
  assert.equal(page.root["--accent"], "#abcdef");
});
