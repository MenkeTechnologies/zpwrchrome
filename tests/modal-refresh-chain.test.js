// modal refresh() bootstrap chain in content.template.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const tmpl = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");

const rfStart = tmpl.indexOf("function refresh()");
const rfEnd = tmpl.indexOf("function currentList()");
assert.ok(rfStart >= 0 && rfEnd > rfStart, "modal refresh missing");
const rf = tmpl.slice(rfStart, rfEnd);

test("modal refresh sends list kind to populate mru and closed", () => {
  assert.match(rf, /sendMessage\(\{ kind: "list" \}/);
  assert.match(rf, /state\.mru = data\.mru \|\| \[\]/);
  assert.match(rf, /state\.closed = data\.closed \|\| \[\]/);
});

test("modal refresh bails when state is null or data missing", () => {
  assert.match(rf, /if \(!state \|\| !data\) return/);
});

test("modal refresh derives currentWindowId from active tab in mru", () => {
  assert.match(rf, /state\.currentWindowId = state\.mru\.find\(\(t\) => t\.active\)\?\.windowId/);
});

test("modal refresh chains scenes-list after list response", () => {
  assert.match(rf, /kind: "scenes-list"/);
  assert.match(rf, /state\.scenes = sd\?\.scenes \|\| \[\]/);
});

test("modal refresh chains history-list with HISTORY_MAX_RESULTS", () => {
  assert.match(rf, /kind: "history-list", maxResults: HISTORY_MAX_RESULTS/);
});

test("modal refresh sets historyLoaded true when history arrives", () => {
  assert.match(rf, /state\.historyLoaded = true/);
});

test("modal refresh firstRender selects row after active tab when possible", () => {
  assert.match(rf, /if \(state\.firstRender\)/);
  assert.match(rf, /state\.rowIdx = i >= 0 && i \+ 1 < items\.length \? i \+ 1 : 0/);
});

test("modal refresh clears firstRender after initial row pick", () => {
  assert.match(rf, /state\.firstRender = false/);
});

test("modal refresh calls render after data chain completes", () => {
  assert.match(rf, /render\(\)/);
});

test("modal refresh guards state null between async callbacks", () => {
  assert.match(rf, /if \(!state\) return/);
});

test("modal HISTORY_MAX_RESULTS matches popup ceiling of 5000", () => {
  assert.match(tmpl, /const HISTORY_MAX_RESULTS = 5000/);
});

test("modal currentList uses hostOf for hostname extraction in fzf scoring", () => {
  assert.match(tmpl, /function hostOf\(url\)/);
  assert.match(tmpl, /fzfMatch\(state\.filter, hostText\)/);
});

test("modal currentList closed category maps sessionId from tab or window", () => {
  assert.match(tmpl, /kind: "closed", sessionId: s\.tab\?\.sessionId \|\| s\.window\?\.sessionId/);
});

test("modal currentList fzf tiebreaker uses frecency on history rows", () => {
  assert.match(tmpl, /\(b\._score - a\._score\) \|\| \(\(b\.frecency \?\? 0\) - \(a\.frecency \?\? 0\)\)/);
});
