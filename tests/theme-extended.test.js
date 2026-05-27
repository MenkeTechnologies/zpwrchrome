// Additional companion-theme invariants beyond tests/theme.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const THEME = join(ROOT, "theme");
const tm = JSON.parse(readFileSync(join(THEME, "manifest.json"), "utf8"));

test("theme manifest version tracks main extension version", () => {
  const main = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  assert.equal(tm.version, main.version,
    "companion theme version must match main extension for release parity");
});

test("theme manifest has no permissions block (themes are passive)", () => {
  assert.equal(tm.permissions, undefined);
  assert.equal(tm.host_permissions, undefined);
});

test("theme toolbar_text uses strykelang foreground (#e0f0ff)", () => {
  assert.deepEqual(tm.theme.colors.toolbar_text, [224, 240, 255]);
});

test("theme omnibox colors match toolbar secondary palette", () => {
  assert.deepEqual(tm.theme.colors.omnibox_background, [10, 10, 20]);
  assert.deepEqual(tm.theme.colors.omnibox_text, [224, 240, 255]);
});

test("theme incognito frame colors stay in the dark HUD family", () => {
  const frame = tm.theme.colors.frame_incognito;
  assert.ok(frame[0] <= 20 && frame[1] <= 20 && frame[2] <= 30,
    "incognito frame should stay dark");
});

test("theme ntp_section uses secondary card background", () => {
  assert.deepEqual(tm.theme.colors.ntp_section, [13, 13, 26]);
});

test("theme properties enable alternate NTP logo treatment", () => {
  assert.equal(tm.theme.properties.ntp_logo_alternate, 1);
});

test("theme declares exactly three raster images (frame, toolbar, ntp)", () => {
  assert.equal(Object.keys(tm.theme.images).length, 3);
  assert.ok(tm.theme.images.theme_frame);
  assert.ok(tm.theme.images.theme_toolbar);
  assert.ok(tm.theme.images.theme_ntp_background);
});

test("theme README exists for SVG→PNG regeneration instructions", () => {
  assert.ok(existsSync(join(THEME, "README.md")));
});

test("theme author matches main extension author", () => {
  const main = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  assert.equal(tm.author, main.author);
});

test("theme homepage_url points at the GitHub repo", () => {
  assert.match(tm.homepage_url, /github\.com\/MenkeTechnologies\/zpwrchrome/);
});

test("theme tab_background_text_inactive is dimmer than tab_background_text", () => {
  const active = tm.theme.colors.tab_background_text;
  const inactive = tm.theme.colors.tab_background_text_inactive;
  const sum = (rgb) => rgb[0] + rgb[1] + rgb[2];
  assert.ok(sum(inactive) < sum(active), "inactive tab text must be dimmer");
});

test("theme button_background matches toolbar fill", () => {
  assert.deepEqual(tm.theme.colors.button_background, tm.theme.colors.toolbar);
});

test("theme frame_inactive is slightly brighter than frame (visible inactive window)", () => {
  const frame = tm.theme.colors.frame;
  const inactive = tm.theme.colors.frame_inactive;
  assert.ok(inactive[0] >= frame[0] && inactive[1] >= frame[1],
    "inactive frame should not be darker than active frame on all channels");
});
