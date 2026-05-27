// Popup mouse/keyboard interaction guards in popup.js renderList.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");

const renderList = popup.match(/function renderList\(\)[\s\S]*?\n\}/);
assert.ok(renderList, "renderList missing");

test("popup renderList binds mousemove once to track lastMouseMove timestamp", () => {
  assert.match(renderList[0], /if \(!\$list\._mouseMoveBound\)/);
  assert.match(renderList[0], /state\.lastMouseMove = Date\.now\(\)/);
  assert.match(renderList[0], /\$list\._mouseMoveBound = true/);
});

test("popup renderList mouseenter ignores hover when no recent mousemove", () => {
  assert.match(renderList[0], /if \(!state\.lastMouseMove \|\| Date\.now\(\) - state\.lastMouseMove > 100\) return/);
});

test("popup renderList row click activates by data-idx unless scene button clicked", () => {
  assert.match(renderList[0], /el\.addEventListener\("click"/);
  assert.match(renderList[0], /ev\.target\.closest\("\.scene-restore-btn"\)/);
  assert.match(renderList[0], /activate\(Number\(el\.dataset\.idx\)\)/);
});

test("popup renderList scene-restore stops propagation before sendMessage", () => {
  assert.match(renderList[0], /scene-restore-btn[\s\S]*?e\.stopPropagation\(\)/);
});

test("popup renderList scene-delete stops propagation before sendMessage", () => {
  assert.match(renderList[0], /scene-delete-btn[\s\S]*?e\.stopPropagation\(\)/);
});

test("popup renderList tree-toggle ignores ghost placeholder buttons", () => {
  assert.match(renderList[0], /if \(btn\.classList\.contains\("ghost"\)\) return/);
});

test("popup renderList tree-toggle toggles collapsedTreeIds Set membership", () => {
  assert.match(renderList[0], /state\.collapsedTreeIds\.has\(tid\)/);
  assert.match(renderList[0], /state\.collapsedTreeIds\.delete\(tid\)/);
  assert.match(renderList[0], /state\.collapsedTreeIds\.add\(tid\)/);
});

test("popup renderList scrolls selected row into view with nearest block", () => {
  assert.match(renderList[0], /scrollIntoView\(\{ block: "nearest" \}\)/);
});

test("popup search input resets rowIdx to 0 on filter change", () => {
  assert.match(popup, /\$q\.addEventListener\("input"/);
  assert.match(popup, /state\.filter = e\.target\.value/);
  assert.match(popup, /state\.rowIdx = 0/);
});

test("popup host() helper returns empty string on invalid URLs", () => {
  const fn = popup.match(/function host\(u\)[\s\S]*?\n\}/);
  assert.match(fn[0], /catch \{ return ""; \}/);
});

test("popup host() uses URL.hostname for valid URLs", () => {
  const fn = popup.match(/function host\(u\)[\s\S]*?\n\}/);
  assert.match(fn[0], /return new URL\(u\)\.hostname/);
});

test("popup state.collapsedTreeIds is a Set initialized empty", () => {
  assert.match(popup, /collapsedTreeIds: new Set\(\)/);
});

test("popup state.proc defaults to unavailable with empty perTab map", () => {
  assert.match(popup, /proc: \{ available: false, perTab: \{\} \}/);
});

test("popup refresh derives currentWindowId from active tab in MRU list", () => {
  const fn = popup.match(/function refresh\(\)[\s\S]*?\n\}/);
  assert.match(fn[0], /state\.currentWindowId = state\.mru\.find\(\(t\) => t\.active\)\?\.windowId/);
});

test("popup refresh falls back to first MRU tab windowId when none active", () => {
  const fn = popup.match(/function refresh\(\)[\s\S]*?\n\}/);
  assert.match(fn[0], /state\.mru\[0\]\?\.windowId/);
});

test("popup history delete filters local state after background confirms", () => {
  assert.match(popup, /state\.history = state\.history\.filter\(\(h\) => h\.url !== t\.url\)/);
});

test("popup imports fzfMatch and highlightWithIndices from lib/fzf.js", () => {
  assert.match(popup, /import \{ fzfMatch, highlightWithIndices \} from "\.\/lib\/fzf\.js"/);
});

test("popup imports buildTabTree flattenTree domainHueFor from lib/util.js", () => {
  assert.match(popup, /import \{ buildTabTree, flattenTree, domainHueFor \} from "\.\/lib\/util\.js"/);
});
