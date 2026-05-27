// Popup UI behavior invariants — keyboard nav, minimap, scenes, tree, history.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");
const css   = readFileSync(join(ROOT, "popup.css"), "utf8");

test("popup.js Cmd/Ctrl+0 maps to History category (index 9)", () => {
  assert.match(popup, /const idx = n === 0 \? 9 : n - 1/);
});

test("popup.js tree view collapses branch on ArrowLeft", () => {
  assert.match(popup, /CATEGORIES\[state\.catIdx\]\.id === "tree"/);
  assert.match(popup, /e\.key === "ArrowLeft"\)[\s\S]*?state\.collapsedTreeIds\.add\(cur\.id\)/);
});

test("popup.js tree view expands branch on ArrowRight", () => {
  assert.match(popup, /e\.key === "ArrowRight"\)[\s\S]*?state\.collapsedTreeIds\.delete\(cur\.id\)/);
});

test("popup.js Backspace in search input trims filter instead of closing tab", () => {
  assert.match(popup, /e\.key === "Backspace" && document\.activeElement === \$q && \$q\.value/);
  assert.match(popup, /return;/);
});

test("popup.js Backspace on history row sends history-delete", () => {
  assert.match(popup, /t\?\.kind === "history" && t\.url/);
  assert.match(popup, /kind: "history-delete", url: t\.url/);
  assert.match(popup, /state\.history = state\.history\.filter\(\(h\) => h\.url !== t\.url\)/);
});

test("popup.js Escape clears filter first, then closes popup", () => {
  assert.match(popup, /e\.key === "Escape"/);
  assert.match(popup, /\$q\.value\) \{ \$q\.value = ""; state\.filter = "";/);
  assert.match(popup, /else window\.close\(\)/);
});

test("popup.js renderMinimap groups tabs by windowId", () => {
  const fn = popup.match(/function renderMinimap\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /grouped\.set\(winId/);
  assert.match(fn[0], /mm-window-label/);
});

test("popup.js minimap marks current window with star in label", () => {
  assert.match(popup, /winId === state\.currentWindowId \? "★"/);
});

test("popup.js minimap marks active tab with mm-active class", () => {
  assert.match(popup, /mm-active/);
  assert.match(popup, /t\.active/);
});

test("popup.js minimap marks pinned tabs with mm-pinned class", () => {
  assert.match(popup, /t\.pinned \? " mm-pinned"/);
});

test("popup.js wireSceneForm validates non-empty name before save", () => {
  assert.match(popup, /if \(!name\) \{ status\.textContent = "name required"/);
});

test("popup.js wireSceneForm sends scenes-save and reports tab count", () => {
  assert.match(popup, /kind: "scenes-save", name/);
  assert.match(popup, /saved \$\{resp\.scene\?\.tabs\?\.length/);
});

test("popup.js scene rows expose restore and delete buttons", () => {
  assert.match(popup, /scene-restore-btn/);
  assert.match(popup, /scene-delete-btn/);
});

test("popup.js row rendering uses highlightWithIndices for fzf hits", () => {
  assert.match(popup, /highlightWithIndices\(titleText, t\._titleHl, escapeHtml\)/);
  assert.match(popup, /highlightWithIndices\(h,\s+t\._hostHl,\s+escapeHtml\)/);
});

test("popup.js history rows show timeAgo from lastVisitTime", () => {
  assert.match(popup, /function timeAgo\(ms\)/);
  assert.match(popup, /timeAgo\(t\.lastVisitTime\)/);
});

test("popup.js fmtMb formats memory for kill-heaviest display", () => {
  assert.match(popup, /function fmtMb\(bytes\)/);
  assert.match(popup, /bytes \/ \(1024 \* 1024\)/);
});

test("popup.js kill-heaviest button calls background kill-heaviest handler", () => {
  assert.match(popup, /getElementById\("killHeaviest"\)/);
  assert.match(popup, /kind: "kill-heaviest"/);
});

test("popup.js processes-snapshot fetched lazily on refresh", () => {
  assert.match(popup, /kind: "processes-snapshot"/);
});

test("popup.js open-scripts opens manager.html via chrome.runtime.getURL", () => {
  assert.match(popup, /getElementById\("open-scripts"\)/);
  assert.match(popup, /getURL\("scripts-manager\/manager\.html"\)/);
});

test("popup.js refresh() chains list → scenes-list → processes-snapshot", () => {
  const fn = popup.match(/function refresh\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /kind: "list"/);
  assert.match(fn[0], /kind: "scenes-list"/);
  assert.match(fn[0], /kind: "processes-snapshot"/);
});

test("popup.js loadHistory is deferred until History category selected", () => {
  assert.match(popup, /historyLoaded/);
  assert.match(popup, /function loadHistory\(/);
});

test("popup.js currentList closed category maps session IDs from chrome.sessions shape", () => {
  assert.match(popup, /s\.tab\?\.sessionId \|\| s\.window\?\.sessionId/);
});

test("popup.js pinned/audible/muted filters apply per category id", () => {
  assert.match(popup, /cat\.id === "pinned"\)[\s\S]*?t\.pinned/);
  assert.match(popup, /cat\.id === "audible"\)[\s\S]*?t\.audible/);
  assert.match(popup, /cat\.id === "muted"\)[\s\S]*?t\.mutedInfo\?\.muted/);
});

test("popup.js scrollIntoView keeps keyboard selection in view", () => {
  assert.match(popup, /scrollIntoView\(\{ block: "nearest" \}\)/);
});

test("popup.js favicon error handler hides broken images", () => {
  assert.match(popup, /addEventListener\("error", \(\) => \{ img\.style\.visibility = "hidden"; \}/);
});

test("popup.js filter input drives state.filter and re-renders list", () => {
  assert.match(popup, /\$q\.addEventListener\("input"/);
  assert.match(popup, /state\.filter = e\.target\.value/);
});

test("popup.css styles minimap grid cells", () => {
  assert.match(css, /\.mm-cell/);
  assert.match(css, /\.mm-grid/);
  assert.match(css, /\.mm-window/);
});

test("popup.css styles scene save form", () => {
  assert.match(css, /\.scene-save-form/);
  assert.match(css, /\.scene-name/);
});

test("popup.css styles tree rows with indent support", () => {
  assert.match(css, /\.tree-row/);
  assert.match(css, /\.tree-toggle/);
});

test("popup.js kill-heaviest button toggles hidden based on proc.available", () => {
  assert.match(popup, /getElementById\("killHeaviest"\)/);
  assert.match(popup, /classList\.toggle\("hidden", !state\.proc\.available\)/);
});
