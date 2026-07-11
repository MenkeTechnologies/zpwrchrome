// Unit tests for lib/color-schemes.js — the 8 vendored schemes, their var
// completeness, the themeFor() mapping the page-recolor builders consume, and
// the palette pass-through into buildThemeCss.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COLOR_SCHEMES,
  SCHEME_IDS,
  SCHEME_VAR_KEYS,
  DEFAULT_SCHEME,
  varsFor,
  themeFor,
} from "../lib/color-schemes.js";
import { THEME, buildThemeCss } from "../lib/cyber-theme-css.js";

// The 8 schemes the app shell ships — zpwrchrome must offer the same set.
const EXPECTED_IDS = ["cyberpunk", "midnight", "matrix", "ember", "arctic", "crimson", "toxic", "vapor"];

test("exactly the 8 app-shell schemes are present, default is cyberpunk", () => {
  assert.deepEqual(SCHEME_IDS, EXPECTED_IDS);
  assert.deepEqual(Object.keys(COLOR_SCHEMES), EXPECTED_IDS);
  assert.equal(DEFAULT_SCHEME, "cyberpunk");
  assert.ok(COLOR_SCHEMES[DEFAULT_SCHEME], "default scheme must exist");
});

test("every scheme defines the full var-key set with hex/rgba values + label/desc", () => {
  for (const id of SCHEME_IDS) {
    const s = COLOR_SCHEMES[id];
    assert.ok(s.label && s.desc, `${id}: missing label/desc`);
    for (const key of SCHEME_VAR_KEYS) {
      const v = s.vars[key];
      assert.ok(v, `${id}: missing var ${key}`);
      assert.match(v, /^(#[0-9a-f]{6}|rgba?\()/i, `${id} ${key}: not hex/rgba — ${v}`);
    }
    // No stray keys beyond the documented set.
    assert.deepEqual(Object.keys(s.vars).sort(), [...SCHEME_VAR_KEYS].sort(),
      `${id}: var set drifted from SCHEME_VAR_KEYS`);
  }
});

test("schemes are visually distinct (no two share the same --cyan + --accent + --bg-primary)", () => {
  const seen = new Set();
  for (const id of SCHEME_IDS) {
    const v = COLOR_SCHEMES[id].vars;
    const sig = `${v["--cyan"]}|${v["--accent"]}|${v["--bg-primary"]}`;
    assert.ok(!seen.has(sig), `${id}: duplicate palette signature ${sig}`);
    seen.add(sig);
  }
});

test("varsFor: known id returns its vars; unknown falls back to default", () => {
  assert.equal(varsFor("matrix"), COLOR_SCHEMES.matrix.vars);
  assert.equal(varsFor("does-not-exist"), COLOR_SCHEMES[DEFAULT_SCHEME].vars);
  assert.equal(varsFor(undefined), COLOR_SCHEMES[DEFAULT_SCHEME].vars);
});

test("themeFor: fills every camelCase slot the page-recolor builders consume", () => {
  // The builders (cyber-theme-css.js / modal/cyber-theme.js) default to THEME;
  // a scheme palette must supply every key THEME has, or var interpolation
  // would emit `undefined` into the CSS.
  for (const id of SCHEME_IDS) {
    const p = themeFor(id);
    for (const slot of Object.keys(THEME)) {
      assert.ok(p[slot] !== undefined, `themeFor(${id}) missing slot ${slot}`);
    }
  }
});

test("themeFor: maps the load-bearing anchors from the scheme vars", () => {
  const m = themeFor("matrix");
  assert.equal(m.cyan, COLOR_SCHEMES.matrix.vars["--cyan"]);
  assert.equal(m.accent, COLOR_SCHEMES.matrix.vars["--accent"]);
  assert.equal(m.bgPrimary, COLOR_SCHEMES.matrix.vars["--bg-primary"]);
  assert.equal(m.text, COLOR_SCHEMES.matrix.vars["--text"]);
  assert.equal(m.fontStack, THEME.fontStack);
});

test("buildThemeCss(opts.palette): the chosen scheme's colors replace the cyberpunk defaults", () => {
  const matrixCss = buildThemeCss({ intensity: "medium", palette: themeFor("matrix") });
  // Matrix --cyan is #39ff14; Cyberpunk --cyan is #05d9e8.
  assert.match(matrixCss, /#39ff14/i, "matrix cyan must appear");
  assert.doesNotMatch(matrixCss, /#05d9e8/i, "cyberpunk cyan must be gone when matrix palette is passed");
});

test("buildThemeCss(): no palette → unchanged cyberpunk default (back-compat)", () => {
  assert.deepEqual(buildThemeCss({ intensity: "medium" }), buildThemeCss({ intensity: "medium", palette: THEME }));
});

// ── Custom scheme sync from ~/.zwire/global.toml (the fleet-shared library) ──

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { themeFromVars } from "../lib/color-schemes.js";

const _root = join(dirname(fileURLToPath(import.meta.url)), "..");
const _read = (p) => readFileSync(join(_root, p), "utf8");

test("themeFromVars: a synced custom scheme's raw var map fills the same camelCase palette", () => {
  const vars = { ...COLOR_SCHEMES.cyberpunk.vars, "--accent": "#123456", "--cyan": "#abcdef", "--bg-primary": "#010203" };
  const p = themeFromVars(vars);
  for (const slot of Object.keys(THEME)) assert.ok(p[slot] !== undefined, `themeFromVars missing slot ${slot}`);
  assert.equal(p.accent, "#123456");
  assert.equal(p.cyan, "#abcdef");
  assert.equal(p.bgPrimary, "#010203");
  assert.equal(p.fontStack, THEME.fontStack);
  // themeFor now delegates to themeFromVars, so a built-in still resolves identically.
  assert.deepEqual(themeFor("matrix"), themeFromVars(COLOR_SCHEMES.matrix.vars));
});

test("background.js subscribes to the host 'schemes' topic and mirrors the library to ui.schemes", () => {
  const bg = _read("background.js");
  assert.match(bg, /cmd:\s*"sub",\s*topic:\s*"schemes"/, "must sub to the schemes topic");
  assert.match(bg, /"ui\.schemes"/, "must define the ui.schemes storage key");
  assert.match(bg, /m\.topic\s*===\s*"schemes"/, "must handle inbound schemes pubs");
  // A local custom pick (ui.palette) is pushed back to the host so the fleet repaints.
  assert.match(bg, /sendNativeMessage\(HOST,\s*\{\s*palette:\s*pal\s*\}/, "must forward ui.palette to the host");
});

test("theme-injector.js renders the synced custom schemes and resolves custom-N palettes", () => {
  const ti = _read("scripts-manager/theme-injector.js");
  assert.match(ti, /"ui\.schemes"/, "must read the ui.schemes library");
  assert.match(ti, /custom-"\s*\+\s*i/, "must render a button per custom scheme as custom-N");
  assert.match(ti, /themeFromVars/, "must resolve a custom scheme's palette from its vars");
  assert.match(ti, /UI_PALETTE_KEY/, "picking a custom scheme must write ui.palette");
});

// ── Custom-scheme EDITOR (port of zgui-core buildEditor / buildPresetChips) ──

import { CUSTOM_EDIT_KEYS, hexToRgba, buildCustomScheme } from "../lib/color-schemes.js";

test("hexToRgba: parses #rrggbb into rgba() with the given alpha", () => {
  assert.equal(hexToRgba("#05d9e8", 0.4), "rgba(5, 217, 232, 0.4)");
  assert.equal(hexToRgba("#000000", 0.15), "rgba(0, 0, 0, 0.15)");
  assert.equal(hexToRgba("#ffffff", 0.08), "rgba(255, 255, 255, 0.08)");
});

test("buildCustomScheme: auto-derives glow/dim/bg variants from the base picks (zgui-core alphas)", () => {
  const base = { "--accent": "#ff2a6d", "--cyan": "#05d9e8", "--magenta": "#d300c5", "--yellow": "#ffd400", "--green": "#39ff14", "--orange": "#ff8800" };
  const v = buildCustomScheme(base);
  // base picks preserved
  assert.equal(v["--accent"], "#ff2a6d");
  // derived variants with the exact alpha constants the app shell uses
  assert.equal(v["--accent-glow"], hexToRgba("#ff2a6d", 0.4));
  assert.equal(v["--cyan-glow"], hexToRgba("#05d9e8", 0.4));
  assert.equal(v["--cyan-dim"], hexToRgba("#05d9e8", 0.15));
  assert.equal(v["--magenta-glow"], hexToRgba("#d300c5", 0.3));
  assert.equal(v["--yellow-glow"], hexToRgba("#ffd400", 0.2));
  assert.equal(v["--green-bg"], hexToRgba("#39ff14", 0.08));
  assert.equal(v["--orange-bg"], hexToRgba("#ff8800", 0.1));
});

test("buildCustomScheme: does not invent variants for tokens that weren't picked", () => {
  const v = buildCustomScheme({ "--accent": "#123456" });
  assert.ok(v["--accent-glow"], "accent-glow derives");
  assert.equal(v["--cyan-glow"], undefined, "no cyan pick → no cyan-glow");
  assert.equal(v["--green-bg"], undefined, "no green pick → no green-bg");
});

test("CUSTOM_EDIT_KEYS: only hex-pickable base tokens (none of the auto-derived rgba variants)", () => {
  assert.ok(CUSTOM_EDIT_KEYS.includes("--accent") && CUSTOM_EDIT_KEYS.includes("--bg-primary"));
  // The exact variants buildCustomScheme derives — these must never be directly editable
  // (a <input type=color> can't hold an rgba(), and editing them would be overwritten).
  const DERIVED = ["--accent-glow", "--cyan-glow", "--cyan-dim", "--magenta-glow", "--yellow-glow", "--green-bg", "--orange-bg"];
  for (const d of DERIVED) assert.ok(!CUSTOM_EDIT_KEYS.includes(d), `${d} is auto-derived, must not be editable`);
});

test("theme-injector.js has the editor + preset CRUD writing the shared library", () => {
  const ti = _read("scripts-manager/theme-injector.js");
  assert.match(ti, /function buildEditor\(/, "swatch-grid editor");
  assert.match(ti, /function savePreset\(/, "save a custom scheme");
  assert.match(ti, /function deletePreset\(/, "delete one preset");
  assert.match(ti, /function updatePresetActive\(/, "update the active preset in place");
  assert.match(ti, /buildCustomScheme\(pickerMap\(host\)\)/, "swatch edits rebuild via buildCustomScheme");
  assert.match(ti, /UI_SCHEMES_KEY\]:\s*customSchemes/, "saves write the library to ui.schemes");
});

test("background.js forwards the edited library (ui.schemes) to the host", () => {
  const bg = _read("background.js");
  assert.match(bg, /sendNativeMessage\(HOST,\s*\{\s*schemes:\s*list\s*\}/, "must push ui.schemes edits to the host");
  assert.match(bg, /fromHostSchemes/, "must echo-guard host-pushed library updates");
});
