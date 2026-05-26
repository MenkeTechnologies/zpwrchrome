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
