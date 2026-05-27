// Keyboard navigation invariants in popup.js keydown handler.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");

const keydown = popup.match(/document\.addEventListener\("keydown",[\s\S]*?\n\}\);/);
assert.ok(keydown, "keydown handler block missing");

test("popup Cmd/Ctrl+1..9 switches category by index", () => {
  assert.match(keydown[0], /\(e\.metaKey \|\| e\.ctrlKey\) && \/\^\[0-9\]\$\/\.test\(e\.key\)/);
  assert.match(keydown[0], /const idx = n === 0 \? 9 : n - 1/);
  assert.match(keydown[0], /state\.catIdx = idx/);
});

test("popup Cmd/Ctrl+0 maps to History (category index 9)", () => {
  assert.match(popup, /id: "history", label: "History",\s+key: "⌘0"/);
  assert.match(keydown[0], /n === 0 \? 9 : n - 1/);
});

test("popup category shortcut prevents default browser behavior", () => {
  assert.match(keydown[0], /e\.preventDefault\(\)/);
});

test("popup ArrowDown/ArrowUp call cycle with signed delta", () => {
  assert.match(keydown[0], /e\.key === "ArrowDown"\)[\s\S]*?cycle\(\+1\)/);
  assert.match(keydown[0], /e\.key === "ArrowUp"\)[\s\S]*?cycle\(-1\)/);
});

test("popup Enter activates the currently selected row", () => {
  assert.match(keydown[0], /e\.key === "Enter"\)[\s\S]*?activate\(state\.rowIdx\)/);
});

test("popup Delete closes highlighted open tab via close-tab message", () => {
  assert.match(keydown[0], /e\.key === "Delete"/);
  assert.match(keydown[0], /t\?\.kind === "open"/);
  assert.match(keydown[0], /kind: "close-tab", tabId: t\.id/);
});

test("popup Backspace on history row deletes URL via history-delete", () => {
  assert.match(keydown[0], /t\?\.kind === "history" && t\.url/);
  assert.match(keydown[0], /kind: "history-delete", url: t\.url/);
});

test("popup Backspace with non-empty search defers to native input editing", () => {
  assert.match(keydown[0], /e\.key === "Backspace" && document\.activeElement === \$q && \$q\.value/);
  assert.match(keydown[0], /return;\s*\}/);
});

test("popup Escape clears filter first, then closes window", () => {
  assert.match(keydown[0], /e\.key === "Escape"/);
  assert.match(keydown[0], /if \(\$q\.value\) \{ \$q\.value = ""; state\.filter = "";/);
  assert.match(keydown[0], /else window\.close\(\)/);
});

test("popup tree category ArrowLeft collapses branch with children", () => {
  assert.match(keydown[0], /CATEGORIES\[state\.catIdx\]\.id === "tree"/);
  assert.match(keydown[0], /e\.key === "ArrowLeft"\)[\s\S]*?state\.collapsedTreeIds\.add\(cur\.id\)/);
});

test("popup tree category ArrowRight expands collapsed branch", () => {
  assert.match(keydown[0], /e\.key === "ArrowRight"\)[\s\S]*?state\.collapsedTreeIds\.delete\(cur\.id\)/);
});

test("popup tree arrow keys require _hasChildren on current row", () => {
  assert.match(keydown[0], /if \(cur && cur\._hasChildren\)/);
});

test("popup open-scripts link opens manager.html in a new tab", () => {
  assert.match(popup, /getElementById\("open-scripts"\)/);
  assert.match(popup, /chrome\.runtime\.getURL\("scripts-manager\/manager\.html"\)/);
  assert.match(popup, /window\.close\(\)/);
});

test("popup killHeaviest button sends kill-heaviest message", () => {
  assert.match(popup, /getElementById\("killHeaviest"\)/);
  assert.match(popup, /kind: "kill-heaviest"/);
});

test("popup killHeaviest alerts when background returns ok:false", () => {
  assert.match(popup, /if \(!r\?\.ok\) alert\("kill-heaviest: "/);
});

test("popup firstRender selects row after active tab for one-stroke MRU switch", () => {
  assert.match(popup, /state\.rowIdx = i >= 0 && i \+ 1 < items\.length \? i \+ 1 : 0/);
});

test("popup search input resets rowIdx to 0 on filter change", () => {
  assert.match(popup, /\$q\.addEventListener\("input"/);
  assert.match(popup, /state\.filter = e\.target\.value/);
  assert.match(popup, /state\.rowIdx = 0/);
});

test("popup render toggles killHeaviest visibility from processes availability", () => {
  assert.match(popup, /killBtn\.classList\.toggle\("hidden", !state\.proc\.available\)/);
});

test("popup history delete filters local state before re-render", () => {
  assert.match(popup, /state\.history = state\.history\.filter\(\(h\) => h\.url !== t\.url\)/);
});

test("popup category shortcut resets rowIdx to top of list", () => {
  assert.match(keydown[0], /state\.rowIdx = 0[\s\S]*?render\(\)/);
});

test("popup keydown handler guards category index against CATEGORIES.length", () => {
  assert.match(keydown[0], /if \(idx < CATEGORIES\.length\)/);
});
