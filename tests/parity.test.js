// Popup ↔ modal parity — shared UX contracts must stay in lockstep.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");
const modal = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");

const SHARED_CATEGORIES = [
  "all", "current", "pinned", "audible", "muted", "closed", "scenes", "tree", "minimap", "history"
];

test("popup and modal declare the same 10 category ids", () => {
  for (const id of SHARED_CATEGORIES) {
    assert.match(popup, new RegExp(`id:\\s*"${id}"`), `popup missing "${id}"`);
    assert.match(modal, new RegExp(`id:\\s*"${id}"`), `modal missing "${id}"`);
  }
});

test("popup and modal use the same Cmd+1..0 shortcut labels", () => {
  for (const key of ["⌘1", "⌘2", "⌘3", "⌘4", "⌘5", "⌘6", "⌘7", "⌘8", "⌘9", "⌘0"]) {
    assert.match(popup, new RegExp(`key:\\s*"${key}"`));
    assert.match(modal, new RegExp(`key:\\s*"${key}"`));
  }
});

test("popup and modal both use HISTORY_MAX_RESULTS = 5000", () => {
  assert.match(popup, /HISTORY_MAX_RESULTS = 5000/);
  assert.match(modal, /HISTORY_MAX_RESULTS = 5000/);
});

test("popup and modal both score title + host separately in fzf filter", () => {
  for (const [name, src] of [["popup", popup], ["modal", modal]]) {
    assert.match(src, /fzfMatch\(state\.filter, titleText\)/, `${name}: title fzf`);
    assert.match(src, /fzfMatch\(state\.filter, hostText\)/, `${name}: host fzf`);
  }
});

test("popup and modal both use frecency as fzf tiebreaker", () => {
  const re = /\(b\.frecency \?\? 0\) - \(a\.frecency \?\? 0\)/;
  assert.match(popup, re);
  assert.match(modal, re);
});

test("popup and modal both gate mouseenter on recent mousemove", () => {
  for (const [name, src] of [["popup", popup], ["modal", modal]]) {
    assert.match(src, /lastMouseMove/, `${name}: tracks mousemove`);
    assert.match(src, /Date\.now\(\) - state\.lastMouseMove > \d+/, `${name}: gates hover`);
  }
});

test("popup and modal both implement firstRender MRU row selection", () => {
  for (const [name, src] of [["popup", popup], ["modal", modal]]) {
    assert.match(src, /firstRender/, `${name}: firstRender flag`);
    assert.match(src, /findIndex\(\(t\) => t\.active\)/, `${name}: finds active tab`);
  }
});

test("popup and modal both support tree collapse via collapsedTreeIds Set", () => {
  for (const [name, src] of [["popup", popup], ["modal", modal]]) {
    assert.match(src, /collapsedTreeIds/, `${name}: collapsed set`);
    assert.match(src, /flattenTree\(roots, state\.collapsedTreeIds\)/, `${name}: flatten honors collapse`);
  }
});

test("popup and modal both render minimap with domainHueFor coloring", () => {
  for (const [name, src] of [["popup", popup], ["modal", modal]]) {
    assert.match(src, /domainHueFor\(t\.url/, `${name}: domain hue`);
    assert.match(src, /hsl\(\$\{hue\},75%,45%\)/, `${name}: hsl cell color`);
  }
});

test("popup and modal both wire scenes-save with maxlength 48 name input", () => {
  for (const [name, src] of [["popup", popup], ["modal", modal]]) {
    assert.match(src, /kind: "scenes-save"/, `${name}: save message`);
    assert.match(src, /maxlength="48"/, `${name}: name cap`);
  }
});

test("popup and modal both send scenes-restore and scenes-delete by slug", () => {
  for (const kind of ["scenes-restore", "scenes-delete"]) {
    assert.match(popup, new RegExp(`kind: "${kind}"`));
    assert.match(modal, new RegExp(`kind: "${kind}"`));
  }
});

test("popup and modal both delete history entries via history-delete", () => {
  assert.match(popup, /kind: "history-delete"/);
  assert.match(modal, /kind: "history-delete"/);
});

test("popup and modal both fetch history through background history-list", () => {
  assert.match(popup, /kind: "history-list"/);
  assert.match(modal, /kind: "history-list"/);
});

test("popup and modal both implement timeAgo with the same tier breakpoints", () => {
  for (const [name, src] of [["popup", popup], ["modal", modal]]) {
    const fn = src.match(/function timeAgo\(ms\)[\s\S]*?\n  \}/);
    assert.ok(fn, `${name}: timeAgo missing`);
    assert.match(fn[0], /604800/, `${name}: week tier`);
  }
});

test("popup and modal escapeHtml use identical character maps", () => {
  const mapRe = /"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"/;
  assert.match(popup, mapRe);
  assert.match(modal, mapRe);
});

test("modal has 6 categories in JetBrains subset; popup extends with scenes/tree/minimap/history", () => {
  // Historical note: modal.test.js pins 6 JetBrains categories in content.js
  // for the overlay era; template now matches popup's full 10.
  const modalCount = (modal.match(/id:\s*"/g) || []).length;
  assert.ok(modalCount >= 10, `modal template should declare ≥10 categories, got ${modalCount}`);
});

test("popup opens scripts dashboard in new tab; modal sends open-scripts-manager message", () => {
  assert.match(popup, /chrome\.tabs\.create\(\{ url: chrome\.runtime\.getURL\("scripts-manager/);
  assert.match(modal, /kind: "open-scripts-manager"/);
});
