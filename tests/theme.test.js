// Static invariants for the companion Chrome theme package.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const THEME = join(ROOT, "theme");

const tm = JSON.parse(readFileSync(join(THEME, "manifest.json"), "utf8"));

test("theme manifest is MV3 and declares a theme block", () => {
  assert.equal(tm.manifest_version, 3);
  assert.ok(tm.theme, "missing theme key");
  // Chrome rejects themes that also declare action/background.
  assert.equal(tm.action, undefined, "theme must not declare action");
  assert.equal(tm.background, undefined, "theme must not declare background");
});

test("every theme image path exists and is a PNG", () => {
  const images = tm.theme.images || {};
  assert.ok(Object.keys(images).length > 0, "theme declares no images");
  for (const [slot, rel] of Object.entries(images)) {
    const abs = join(THEME, rel);
    assert.ok(existsSync(abs), `${slot}: file missing — ${rel}`);
    const buf = readFileSync(abs);
    assert.equal(buf[0], 0x89, `${slot}: not a PNG`);
    assert.equal(buf.toString("ascii", 1, 4), "PNG", `${slot}: PNG header invalid`);
  }
});

test("every theme color is an RGB(A) triplet of 0-255 ints", () => {
  const colors = tm.theme.colors || {};
  assert.ok(Object.keys(colors).length > 0, "theme declares no colors");
  for (const [name, value] of Object.entries(colors)) {
    assert.ok(Array.isArray(value), `${name}: not an array`);
    assert.ok(value.length === 3 || value.length === 4, `${name}: expected length 3 or 4, got ${value.length}`);
    for (let i = 0; i < 3; i++) {
      assert.ok(Number.isInteger(value[i]) && value[i] >= 0 && value[i] <= 255,
        `${name}[${i}]: ${value[i]} out of [0,255]`);
    }
  }
});

test("theme uses the strykelang palette anchors", () => {
  // Doc-anchor guard: the marketing claim is "uses strykelang palette".
  // Pin the load-bearing entries so a refactor can't silently re-skin it.
  const c = tm.theme.colors;
  assert.deepEqual(c.ntp_background, [5, 5, 10],       "ntp_background must be strykelang --bg-primary (#05050a)");
  assert.deepEqual(c.ntp_link,       [5, 217, 232],    "ntp_link must be strykelang --cyan (#05d9e8)");
  assert.deepEqual(c.ntp_header,     [255, 42, 109],   "ntp_header must be strykelang --accent (#ff2a6d)");
  assert.deepEqual(c.bookmark_text,  [5, 217, 232],    "bookmark_text must be strykelang --cyan");
  assert.deepEqual(c.frame,          [5, 5, 10],       "frame must be strykelang --bg-primary");
});

test("ntp_background_alignment and repeat are valid Chrome values", () => {
  const p = tm.theme.properties || {};
  if (p.ntp_background_alignment !== undefined) {
    const allowed = ["center", "top", "bottom", "left", "right",
                     "top left", "top right", "bottom left", "bottom right",
                     "left top", "right top", "left bottom", "right bottom"];
    assert.ok(allowed.includes(p.ntp_background_alignment),
      `ntp_background_alignment "${p.ntp_background_alignment}" not in Chrome's allowed list`);
  }
  if (p.ntp_background_repeat !== undefined) {
    const allowed = ["no-repeat", "repeat", "repeat-x", "repeat-y"];
    assert.ok(allowed.includes(p.ntp_background_repeat),
      `ntp_background_repeat "${p.ntp_background_repeat}" not in Chrome's allowed list`);
  }
});

test("theme version uses 1-4 dot-separated 0-65535 ints (Chrome's version rule)", () => {
  const parts = tm.version.split(".");
  assert.ok(parts.length >= 1 && parts.length <= 4, `version has ${parts.length} parts`);
  for (const p of parts) {
    const n = Number(p);
    assert.ok(Number.isInteger(n) && n >= 0 && n <= 65535, `version part "${p}" out of range`);
  }
});

test("theme declares no permissions / action / background (Chrome rejects mixed manifests)", () => {
  // A Chrome theme must be a pure theme — no API surface.
  assert.equal(tm.permissions, undefined, "theme must not declare permissions");
  assert.equal(tm.host_permissions, undefined, "theme must not declare host_permissions");
  assert.equal(tm.content_scripts, undefined, "theme must not declare content_scripts");
  assert.equal(tm.commands, undefined, "theme must not declare commands");
});

test("theme version tracks extension version (same release line)", () => {
  // If the extension version bumps but the theme doesn't, users won't get the
  // updated theme on auto-update. We enforce version parity at the major.minor
  // level — patch may drift if only one side has a fix.
  const extVersion = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")).version;
  const [extMaj, extMin] = extVersion.split(".");
  const [thMaj, thMin]   = tm.version.split(".");
  assert.equal(thMaj, extMaj, `theme major ${thMaj} ≠ extension major ${extMaj}`);
  assert.equal(thMin, extMin, `theme minor ${thMin} ≠ extension minor ${extMin}`);
});

test("theme PNGs match their declared resolution", () => {
  // Pin the dimensions we documented in README/theme/README.md so a silent
  // re-render at the wrong size can't ship.
  const expected = {
    "images/theme_ntp_background.png": [1920, 1200],
    "images/theme_frame.png":          [1920,  120],
    "images/theme_toolbar.png":        [1920,   80]
  };
  for (const [rel, [w, h]] of Object.entries(expected)) {
    const buf = readFileSync(join(THEME, rel));
    // PNG IHDR: signature(8) + length(4) + type(4) + width(4) + height(4)
    const width  = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    assert.equal(width,  w, `${rel} width ${width} ≠ ${w}`);
    assert.equal(height, h, `${rel} height ${height} ≠ ${h}`);
  }
});

test("theme SVG sources exist next to every theme PNG", () => {
  // Doc-anchor: theme/README.md instructs regenerating PNGs from SVGs. If a
  // PNG ships without its SVG source, future regen impossible.
  for (const rel of Object.values(tm.theme.images)) {
    const svg = join(THEME, rel.replace(/\.png$/, ".svg"));
    assert.ok(existsSync(svg), `missing SVG source: ${svg}`);
  }
});

test("theme palette anchors match popup.css palette anchors (cross-asset consistency)", () => {
  // The marketing pitch is "the rest of the browser matches the popup."
  // Verify the load-bearing color slots in both files agree on hex values.
  const popupCss = readFileSync(join(ROOT, "popup.css"), "utf8");
  const c = tm.theme.colors;
  const pairs = [
    ["--bg-primary",   "#05050a", c.frame,          [5, 5, 10]],
    ["--cyan",         "#05d9e8", c.ntp_link,       [5, 217, 232]],
    ["--accent",       "#ff2a6d", c.ntp_header,     [255, 42, 109]],
    ["--bg-secondary", "#0a0a14", c.toolbar,        [10, 10, 20]],
  ];
  for (const [cssVar, hex, themeRgb, expected] of pairs) {
    const re = new RegExp(`${cssVar}:\\s*${hex}`, "i");
    assert.match(popupCss, re, `popup.css missing ${cssVar}: ${hex}`);
    assert.deepEqual(themeRgb, expected,
      `theme color for ${cssVar} (${hex}) ≠ ${JSON.stringify(expected)}; got ${JSON.stringify(themeRgb)}`);
  }
});
