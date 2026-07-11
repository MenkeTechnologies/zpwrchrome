// Unit tests for lib/ui-scheme.js resolveSchemeVars — the var map applied to
// zpwrchrome's own pages for a scheme + light flag (+ custom palette). Regression
// guard: light mode must reach a CUSTOM scheme, not just the built-in eight.

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveSchemeVars } from "../lib/ui-scheme.js";
import { COLOR_SCHEMES, buildCustomScheme } from "../lib/color-schemes.js";

// A stand-in for a fleet custom scheme (bright accent, dark neutrals — exactly what
// our editor and a dark-resolved host palette produce).
const CUSTOM = buildCustomScheme({
  "--accent": "#123456", "--cyan": "#abcdef", "--magenta": "#654321",
  "--bg-primary": "#010203", "--text": "#eeeeee",
});

test("built-in dark: neutrals come from the vendored table", () => {
  const v = resolveSchemeVars("cyberpunk", false, null);
  assert.equal(v["--bg-primary"], COLOR_SCHEMES.cyberpunk.vars["--bg-primary"]);
});

test("built-in light: LIGHT_VARS override the neutrals, accent stays", () => {
  const dark = resolveSchemeVars("cyberpunk", false, null);
  const light = resolveSchemeVars("cyberpunk", true, null);
  assert.notEqual(light["--bg-primary"], dark["--bg-primary"], "bg must change in light mode");
  assert.equal(light["--accent"], dark["--accent"], "accent hue unchanged by light mode");
});

test("custom dark: renders straight from the custom palette", () => {
  const v = resolveSchemeVars("custom-0", false, CUSTOM);
  assert.equal(v["--bg-primary"], "#010203");
  assert.equal(v["--accent"], "#123456");
});

test("REGRESSION: custom scheme + light mode overlays the light neutrals", () => {
  const darkC = resolveSchemeVars("custom-0", false, CUSTOM);
  const lightC = resolveSchemeVars("custom-0", true, CUSTOM);
  // the fix: light must reach a custom scheme — bg flips off the custom DARK value…
  assert.notEqual(lightC["--bg-primary"], darkC["--bg-primary"], "custom+light must not keep the dark bg");
  // …to the SAME light neutral a built-in uses…
  assert.equal(lightC["--bg-primary"], resolveSchemeVars("cyberpunk", true, null)["--bg-primary"]);
  assert.equal(lightC["--text"], resolveSchemeVars("cyberpunk", true, null)["--text"]);
  // …while the custom accent hue is preserved.
  assert.equal(lightC["--accent"], "#123456");
});

test("live 'custom' scheme also honors light mode", () => {
  const light = resolveSchemeVars("custom", true, CUSTOM);
  assert.equal(light["--bg-primary"], resolveSchemeVars("cyberpunk", true, null)["--bg-primary"]);
});
