// renderMinimap layout and interaction invariants in popup.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");

const fn = popup.match(/function renderMinimap\(items\)[\s\S]*?\n\}/);
assert.ok(fn, "renderMinimap missing");

test("renderMinimap shows empty state when no tabs match filter", () => {
  assert.match(fn[0], /if \(!items\.length\)/);
  assert.match(fn[0], /no tabs/);
});

test("renderMinimap groups tabs by windowId in a Map", () => {
  assert.match(fn[0], /const grouped = new Map\(\)/);
  assert.match(fn[0], /const winId = t\.windowId \?\? 0/);
});

test("renderMinimap colors each cell with domainHueFor on tab URL", () => {
  assert.match(fn[0], /domainHueFor\(t\.url \|\| ""\)/);
  assert.match(fn[0], /background:hsl\(\$\{hue\},75%,45%\)/);
});

test("renderMinimap marks pinned tabs with mm-pinned class", () => {
  assert.match(fn[0], /t\.pinned \? " mm-pinned" : ""/);
});

test("renderMinimap marks active tab in current window with mm-active class", () => {
  assert.match(fn[0], /t\.windowId === state\.currentWindowId && t\.active/);
  assert.match(fn[0], /mm-active/);
});

test("renderMinimap window label shows star for current window", () => {
  assert.match(fn[0], /winId === state\.currentWindowId \? "★" : ""/);
});

test("renderMinimap window label includes tab count per window", () => {
  assert.match(fn[0], /\$\{tabs\.length\}/);
});

test("renderMinimap cell title truncates tab title to 80 chars", () => {
  assert.match(fn[0], /\.slice\(0, 80\)/);
});

test("renderMinimap cell click calls activate with row index", () => {
  assert.match(fn[0], /activate\(Number\(el\.dataset\.idx\)\)/);
});

test("renderMinimap stores data-tab-id on each cell for debugging", () => {
  assert.match(fn[0], /data-tab-id="\$\{t\.id\}"/);
});

test("renderMinimap wraps windows in mm-window and mm-grid containers", () => {
  assert.match(fn[0], /class="mm-window"/);
  assert.match(fn[0], /class="mm-grid"/);
});

test("renderMinimap outer wrapper uses minimap class", () => {
  assert.match(fn[0], /class="minimap"/);
});

test("renderMinimap escapes HTML in cell title attribute", () => {
  assert.match(fn[0], /escapeHtml\(\(t\.title \|\| t\.url \|\| ""\)/);
});

test("renderMinimap resolves item index via items.indexOf for click routing", () => {
  assert.match(fn[0], /data-idx="\$\{items\.indexOf\(t\)\}"/);
});

test("popup killHeaviest button hidden when processes API unavailable", () => {
  assert.match(popup, /killBtn\.classList\.toggle\("hidden", !state\.proc\.available\)/);
});

test("popup killHeaviest click sends kill-heaviest message then refresh", () => {
  assert.match(popup, /getElementById\("killHeaviest"\)/);
  assert.match(popup, /kind: "kill-heaviest"/);
  assert.match(popup, /refresh\(\)/);
});

test("popup killHeaviest alerts when background returns ok:false", () => {
  assert.match(popup, /if \(!r\?\.ok\) alert\("kill-heaviest: "/);
});

test("popup refresh stores processes snapshot in state.proc", () => {
  const refresh = popup.match(/function refresh\(\)[\s\S]*?\n\}/);
  assert.match(refresh[0], /state\.proc = pd && pd\.available \? pd : \{ available: false, perTab: \{\} \}/);
});
