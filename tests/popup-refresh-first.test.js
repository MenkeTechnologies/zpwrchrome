// popup refresh() bootstrap chain and firstRender row selection in popup.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");

const rfStart = popup.indexOf("function refresh()");
const rfEnd = popup.indexOf("function loadHistory(");
assert.ok(rfStart >= 0 && rfEnd > rfStart, "refresh missing");
const rf = popup.slice(rfStart, rfEnd);

test("refresh sends list kind first to populate mru and closed arrays", () => {
  assert.match(rf, /sendMessage\(\{ kind: "list" \}/);
  assert.match(rf, /state\.mru = data\.mru \|\| \[\]/);
  assert.match(rf, /state\.closed = data\.closed \|\| \[\]/);
});

test("refresh derives currentWindowId from active tab in mru list", () => {
  assert.match(rf, /state\.currentWindowId = state\.mru\.find\(\(t\) => t\.active\)\?\.windowId/);
});

test("refresh falls back to first mru tab windowId when none active", () => {
  assert.match(rf, /\?\? state\.mru\[0\]\?\.windowId/);
});

test("refresh chains scenes-list after list response", () => {
  assert.match(rf, /kind: "scenes-list"/);
  assert.match(rf, /state\.scenes = sd\?\.scenes \|\| \[\]/);
});

test("refresh chains processes-snapshot after scenes-list", () => {
  assert.match(rf, /kind: "processes-snapshot"/);
  assert.match(rf, /state\.proc = pd && pd\.available \? pd : \{ available: false, perTab: \{\} \}/);
});

test("refresh calls loadHistory before render on every refresh path", () => {
  assert.match(rf, /loadHistory\(\(\) => \{/);
});

test("refresh firstRender reads pendingCategory from session storage once", () => {
  assert.match(rf, /if \(state\.firstRender\)/);
  assert.match(rf, /chrome\.storage\.session\.get\("pendingCategory"/);
});

test("refresh pendingCategory switches catIdx when id exists in CATEGORIES", () => {
  assert.match(rf, /CATEGORIES\.findIndex\(\(c\) => c\.id === pending\)/);
  assert.match(rf, /if \(idx >= 0\) state\.catIdx = idx/);
});

test("refresh removes pendingCategory after consuming it", () => {
  assert.match(rf, /chrome\.storage\.session\.remove\("pendingCategory"\)/);
});

test("refresh firstRender selects row after active tab when possible", () => {
  assert.match(rf, /const i = items\.findIndex\(\(t\) => t\.active\)/);
  assert.match(rf, /state\.rowIdx = i >= 0 && i \+ 1 < items\.length \? i \+ 1 : 0/);
});

test("refresh clears firstRender flag after initial positioning", () => {
  assert.match(rf, /state\.firstRender = false/);
});

test("refresh non-firstRender path calls render directly without session get", () => {
  assert.match(rf, /\} else \{[\s\S]*?render\(\)/);
});

test("loadHistory requests history-list with HISTORY_MAX_RESULTS ceiling", () => {
  const lh = popup.match(/function loadHistory\([\s\S]*?\n\}/);
  assert.match(lh[0], /kind: "history-list", maxResults: HISTORY_MAX_RESULTS/);
  assert.match(lh[0], /state\.historyLoaded = true/);
});

test("HISTORY_MAX_RESULTS constant is 5000 in popup.js", () => {
  assert.match(popup, /const HISTORY_MAX_RESULTS = 5000/);
});
