// Companion theme raster assets and manifest image paths.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const THEME = join(ROOT, "theme");
const tm = JSON.parse(readFileSync(join(THEME, "manifest.json"), "utf8"));

function themePath(rel) {
  return join(THEME, rel);
}

test("theme manifest images.theme_frame points at an existing PNG", () => {
  const p = tm.theme.images.theme_frame;
  assert.ok(existsSync(themePath(p)), `${p} missing`);
});

test("theme manifest images.theme_toolbar points at an existing PNG", () => {
  const p = tm.theme.images.theme_toolbar;
  assert.ok(existsSync(themePath(p)), `${p} missing`);
});

test("theme manifest images.theme_ntp_background points at an existing PNG", () => {
  const p = tm.theme.images.theme_ntp_background;
  assert.ok(existsSync(themePath(p)), `${p} missing`);
});

test("theme PNG assets are non-empty files", () => {
  for (const rel of Object.values(tm.theme.images)) {
    const st = statSync(themePath(rel));
    assert.ok(st.size > 100, `${rel} suspiciously small (${st.size} bytes)`);
  }
});

test("theme directory contains source SVGs referenced by README workflow", () => {
  assert.ok(existsSync(join(THEME, "frame.svg")) || existsSync(join(THEME, "README.md")),
    "theme should document SVG sources");
});

test("main extension icons/icon128.png exists for notifications", () => {
  assert.ok(existsSync(join(ROOT, "icons/icon128.png")));
});

test("main extension icons/icon16.png exists for toolbar", () => {
  assert.ok(existsSync(join(ROOT, "icons/icon16.png")));
});

test("popup fonts ShareTechMono-Regular.woff2 exists", () => {
  assert.ok(existsSync(join(ROOT, "fonts/ShareTechMono-Regular.woff2")));
});

test("popup fonts Orbitron.woff2 exists", () => {
  assert.ok(existsSync(join(ROOT, "fonts/Orbitron.woff2")));
});

test("theme manifest colors.frame uses strykelang HUD dark base", () => {
  assert.deepEqual(tm.theme.colors.frame, [5, 5, 10]);
});

test("theme manifest toolbar_button_icon uses strykelang cyan accent", () => {
  assert.deepEqual(tm.theme.colors.toolbar_button_icon, [5, 217, 232]);
});

test("theme manifest tab_text uses strykelang foreground (#e0f0ff)", () => {
  assert.deepEqual(tm.theme.colors.tab_text, [224, 240, 255]);
});

test("theme manifest ntp_header uses accent magenta", () => {
  assert.deepEqual(tm.theme.colors.ntp_header, [255, 42, 109]);
});

test("theme manifest name identifies companion theme separately from main extension", () => {
  assert.match(tm.name, /theme|Theme|HUD/i);
});
