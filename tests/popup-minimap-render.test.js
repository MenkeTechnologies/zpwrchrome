// renderMinimap window grouping and cell interaction in popup.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");

const mmStart = popup.indexOf("function renderMinimap(");
const mmEnd = popup.indexOf("function wireSceneForm(");
assert.ok(mmStart >= 0 && mmEnd > mmStart, "renderMinimap missing");
const mm = popup.slice(mmStart, mmEnd);

test("renderMinimap shows no tabs empty state when items array is empty", () => {
  assert.match(mm, /if \(!items\.length\)/);
  assert.match(mm, /no tabs/);
});

test("renderMinimap groups tabs by windowId defaulting missing to zero", () => {
  assert.match(mm, /const winId = t\.windowId \?\? 0/);
  assert.match(mm, /grouped\.get\(winId\)\.push\(t\)/);
});

test("renderMinimap colors each cell with domainHueFor on tab URL", () => {
  assert.match(mm, /domainHueFor\(t\.url \|\| ""\)/);
  assert.match(mm, /background:hsl\(\$\{hue\},75%,45%\)/);
});

test("renderMinimap marks pinned tabs with mm-pinned class", () => {
  assert.match(mm, /t\.pinned \? " mm-pinned" : ""/);
});

test("renderMinimap marks active tab in current window with mm-active class", () => {
  assert.match(mm, /t\.windowId === state\.currentWindowId && t\.active/);
  assert.match(mm, /mm-active/);
});

test("renderMinimap cell data-idx uses items.indexOf for activate routing", () => {
  assert.match(mm, /data-idx="\$\{items\.indexOf\(t\)\}"/);
});

test("renderMinimap cell title escapes HTML and truncates to 80 chars", () => {
  assert.match(mm, /title="\$\{escapeHtml\(\(t\.title \|\| t\.url \|\| ""\)\.slice\(0, 80\)\)\}"/);
});

test("renderMinimap window label stars current window id", () => {
  assert.match(mm, /win \$\{winId === state\.currentWindowId \? "★" : ""\}/);
});

test("renderMinimap window label shows tab count per window", () => {
  assert.match(mm, /· \$\{tabs\.length\}/);
});

test("renderMinimap wraps output in minimap container div", () => {
  assert.match(mm, /\$list\.innerHTML = `<div class="minimap">\$\{winRows\}<\/div>`/);
});

test("renderMinimap cell click calls activate with dataset idx", () => {
  assert.match(mm, /mm-cell"\)\.forEach[\s\S]*?activate\(Number\(el\.dataset\.idx\)\)/);
});

test("renderMinimap uses Map for grouped window buckets", () => {
  assert.match(mm, /const grouped = new Map\(\)/);
});

test("currentList minimap branch returns early before fzf when filter empty", () => {
  assert.match(popup, /cat\.id === "minimap"[\s\S]*?return state\.mru/);
});

test("currentList minimap applies matchesLite filter on title url and host", () => {
  assert.match(popup, /cat\.id === "minimap"[\s\S]*?host\(t\.url/);
});
