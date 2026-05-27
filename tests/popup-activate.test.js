// Popup activation/render invariants not covered by popup-ui.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");

test("popup activate() closes window after switching to open tab", () => {
  const fn = popup.match(/function activate\(idx\)[\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /kind: "activate", tabId: t\.id/);
  assert.match(fn[0], /window\.close\(\)/);
});

test("popup activate() restores closed tabs via sessions.restore", () => {
  const fn = popup.match(/function activate\(idx\)[\s\S]*?\n\}/);
  assert.match(fn[0], /t\.kind === "closed"/);
  assert.match(fn[0], /kind: "restore", sessionId: t\.sessionId/);
});

test("popup activate() restores scenes by slug", () => {
  const fn = popup.match(/function activate\(idx\)[\s\S]*?\n\}/);
  assert.match(fn[0], /kind: "scenes-restore", slug: t\.slug/);
});

test("popup cycle() wraps rowIdx modulo list length", () => {
  const fn = popup.match(/function cycle\(delta\)[\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /\(state\.rowIdx \+ delta \+ items\.length\) % items\.length/);
});

test("popup renderCats wires click handlers to switch category", () => {
  assert.match(popup, /function renderCats\(/);
  assert.match(popup, /state\.catIdx = Number\(el\.dataset\.idx\)/);
});

test("popup renderList clamps rowIdx when list shrinks after filter", () => {
  assert.match(popup, /if \(state\.rowIdx >= items\.length\) state\.rowIdx = items\.length - 1/);
  assert.match(popup, /if \(state\.rowIdx < 0\) state\.rowIdx = 0/);
});

test("popup currentList returns early for unfiltered MRU (skips fzf pass)", () => {
  assert.match(popup, /if \(!state\.filter\) return items/);
});

test("popup refresh loads history through background history-list handler", () => {
  assert.match(popup, /function loadHistory\(done\)/);
  assert.match(popup, /kind: "history-list", maxResults: HISTORY_MAX_RESULTS/);
  assert.match(popup, /state\.historyLoaded = true/);
});

test("popup pendingCategory resolves category id via CATEGORIES.findIndex", () => {
  assert.match(popup, /pendingCategory/);
  assert.match(popup, /CATEGORIES\.findIndex\(\(c\) => c\.id === pending\)/);
  assert.match(popup, /chrome\.storage\.session\.remove\("pendingCategory"\)/);
});

test("popup row badges include pin, audio, muted states", () => {
  assert.match(popup, /badge pinned/);
  assert.match(popup, /badge audible/);
  assert.match(popup, /badge muted/);
});

test("popup tree rows indent by 14px per depth level", () => {
  assert.match(popup, /padding-left:\$\{8 \+ t\._depth \* 14\}px/);
});

test("popup proc column shows memory and CPU when processes API available", () => {
  assert.match(popup, /class="proc-col"/);
  assert.match(popup, /fmtMb\(proc\.memoryBytes\)/);
  assert.match(popup, /proc\.cpu\.toFixed\(1\)/);
});

test("popup host() helper returns empty string for bad URLs", () => {
  assert.match(popup, /function host\(u\)[\s\S]*?catch \{ return ""/);
});

test("popup escapeHtml maps all HTML metacharacters", () => {
  assert.match(popup, /"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"/);
});

test("popup scene row shows tab count and slug in path line", () => {
  assert.match(popup, /tabCount.*slug:/);
});

test("popup refresh closes over list response to set state.mru", () => {
  const fn = popup.match(/function refresh\([\s\S]*?\n\}/);
  assert.match(fn[0], /state\.mru = data\.mru/);
});

test("popup render() delegates list body to renderList", () => {
  assert.match(popup, /function render\(\)[\s\S]*?renderList\(\)/);
});

test("popup favicon img uses referrerpolicy=no-referrer", () => {
  assert.match(popup, /referrerpolicy="no-referrer"/);
});
