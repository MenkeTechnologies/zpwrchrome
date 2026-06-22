// Additional popup ↔ modal parity contracts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");
const modal = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");

test("popup and modal both escape HTML via identical escapeHtml helper", () => {
  for (const [name, src] of [["popup", popup], ["modal", modal]]) {
    assert.match(src, /function escapeHtml\(s\)/, `${name}: escapeHtml`);
    assert.match(src, /"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"/);
  }
});

test("popup and modal both clamp rowIdx when list shrinks", () => {
  for (const [name, src] of [["popup", popup], ["modal", modal]]) {
    assert.match(src, /state\.rowIdx >= items\.length/, `${name}: clamp high`);
    assert.match(src, /state\.rowIdx < 0/, `${name}: clamp low`);
  }
});

test("popup and modal both render scene rows with restore/delete actions", () => {
  for (const [name, src] of [["popup", popup], ["modal", modal]]) {
    assert.match(src, /scene-restore-btn/, `${name}: restore btn`);
    assert.match(src, /scene-delete-btn/, `${name}: delete btn`);
  }
});

test("popup and modal both use buildTabTree + flattenTree for tree category", () => {
  assert.match(popup, /from "\.\/lib\/util\.js"/);
  assert.match(modal, /buildTabTree\(/);
  assert.match(modal, /flattenTree\(/);
});

test("popup and modal both import fzfMatch and highlightWithIndices", () => {
  assert.match(popup, /import \{ fzfMatch, highlightWithIndices \}/);
  assert.match(modal, /fzfMatch\(/);
  assert.match(modal, /highlightWithIndices\(/);
});

test("popup and modal both show pin/audio/muted badges on open rows", () => {
  for (const [name, src] of [["popup", popup], ["modal", modal]]) {
    assert.match(src, /badge pinned/, `${name}: pin badge`);
    assert.match(src, /badge audible/, `${name}: audio badge`);
    assert.match(src, /badge muted/, `${name}: muted badge`);
  }
});

test("popup and modal both delete history rows via history-delete message", () => {
  for (const [name, src] of [["popup", popup], ["modal", modal]]) {
    assert.match(src, /kind: "history-delete", url/, `${name}: history delete`);
  }
});

test("popup and modal both close/delete open tabs via close-tab message", () => {
  for (const [name, src] of [["popup", popup], ["modal", modal]]) {
    assert.match(src, /kind: "close-tab", tabId/, `${name}: close tab`);
  }
});

test("popup and modal scenes category fzf-filters name+slug with highlight", () => {
  for (const [name, src] of [["popup", popup], ["modal", modal]]) {
    assert.match(src, /fzfFields\(state\.filter, s\.name, s\.slug\)/, `${name}: scene fzf filter`);
    assert.match(src, /_nameHl: hl/, `${name}: scene name highlight`);
  }
});

test("popup and modal tree category fzf-filters title+host but preserves opener order", () => {
  for (const [name, src] of [["popup", popup], ["modal", modal]]) {
    assert.match(src, /cat\.id === "tree"/, `${name}: tree branch`);
    assert.match(src, /const tm = f \? fzfMatch\(f, titleText\) : null/, `${name}: tree fzf title`);
    assert.match(src, /flattenTree\(roots, state\.collapsedTreeIds\)/, `${name}: tree order preserved`);
    assert.doesNotMatch(src, /const matchesLite/, `${name}: no substring matchesLite in tree`);
  }
});

test("popup and modal both fetch scenes-list during refresh", () => {
  assert.match(popup, /kind: "scenes-list"/);
  assert.match(modal, /kind: "scenes-list"/);
});

test("popup and modal both fetch history-list with HISTORY_MAX_RESULTS", () => {
  assert.match(popup, /kind: "history-list", maxResults: HISTORY_MAX_RESULTS/);
  assert.match(modal, /kind: "history-list", maxResults: HISTORY_MAX_RESULTS/);
});

test("popup and modal category labels include Tree and Minimap", () => {
  assert.match(popup, /label: "Tree \(by opener\)"/);
  assert.match(modal, /label: "Tree \(by opener\)"/);
  assert.match(popup, /label: "Minimap"/);
  assert.match(modal, /label: "Minimap"/);
});

test("popup and modal both wire scene save with maxlength 48", () => {
  for (const [name, src] of [["popup", popup], ["modal", modal]]) {
    assert.match(src, /maxlength="48"/, `${name}: scene name cap`);
  }
});

test("popup and modal refresh guard stale state after list response", () => {
  assert.match(popup, /if \(!data\) return/);
  assert.match(modal, /if \(!state \|\| !data\) return/);
});

test("popup and modal both scroll selected row into view", () => {
  assert.match(popup, /scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(modal, /scrollIntoView\(\{ block: "nearest" \}\)/);
});
