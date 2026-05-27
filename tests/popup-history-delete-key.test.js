// history row delete via Backspace/Delete keydown in popup.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");

const keydown = popup.match(/document\.addEventListener\("keydown",[\s\S]*?\n\}\);/);
assert.ok(keydown, "keydown handler missing");

test("history delete triggers on Backspace or Delete key", () => {
  assert.match(keydown[0], /e\.key === "Delete" \|\| e\.key === "Backspace"/);
});

test("history delete requires row kind history with url present", () => {
  assert.match(keydown[0], /t\?\.kind === "history" && t\.url/);
});

test("history delete sends history-delete with row url", () => {
  assert.match(keydown[0], /kind: "history-delete", url: t\.url/);
});

test("history delete removes url from local state.history immediately", () => {
  assert.match(keydown[0], /state\.history = state\.history\.filter\(\(h\) => h\.url !== t\.url\)/);
});

test("history delete re-renders list without full refresh", () => {
  assert.match(keydown[0], /history-delete[\s\S]*?renderList\(\)/);
});

test("open tab delete sends close-tab with tab id then refresh", () => {
  assert.match(keydown[0], /t\?\.kind === "open"/);
  assert.match(keydown[0], /kind: "close-tab", tabId: t\.id/);
  assert.match(keydown[0], /close-tab[\s\S]*?refresh\)/);
});

test("Backspace on focused search with text returns early for native editing", () => {
  assert.match(keydown[0], /e\.key === "Backspace" && document\.activeElement === \$q && \$q\.value/);
  assert.match(keydown[0], /return;\s*\}/);
});

test("Escape clears search filter before closing popup", () => {
  assert.match(keydown[0], /e\.key === "Escape"/);
  assert.match(keydown[0], /if \(\$q\.value\) \{ \$q\.value = ""; state\.filter = "";/);
  assert.match(keydown[0], /else window\.close\(\)/);
});

test("Escape filter clear resets rowIdx and calls renderList", () => {
  assert.match(keydown[0], /state\.rowIdx = 0; renderList\(\)/);
});

test("Delete on open tab calls preventDefault before close-tab message", () => {
  assert.match(keydown[0], /t\?\.kind === "open"[\s\S]*?e\.preventDefault\(\)/);
});

test("history delete calls preventDefault before sendMessage", () => {
  assert.match(keydown[0], /t\?\.kind === "history"[\s\S]*?e\.preventDefault\(\)/);
});

test("keydown close paths use currentList to resolve highlighted row", () => {
  assert.match(keydown[0], /const items = currentList\(\)/);
  assert.match(keydown[0], /const t = items\[state\.rowIdx\]/);
});
