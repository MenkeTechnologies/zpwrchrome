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
