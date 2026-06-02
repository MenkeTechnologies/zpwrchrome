// popup renderCats category sidebar in popup.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");

const rcStart = popup.indexOf("function renderCats()");
const rcEnd = popup.indexOf("function currentList()");
assert.ok(rcStart >= 0 && rcEnd > rcStart, "renderCats missing");
const rc = popup.slice(rcStart, rcEnd);

test("renderCats writes category HTML into cats mount element", () => {
  assert.match(rc, /\$cats\.innerHTML = CATEGORIES\.map/);
});

test("renderCats highlights selected category with sel class", () => {
  assert.match(rc, /i === state\.catIdx \? " sel" : ""/);
});

test("renderCats renders label and keyboard shortcut per category", () => {
  assert.match(rc, /\$\{c\.label\}/);
  assert.match(rc, /class="key">\$\{c\.key\}/);
});

test("renderCats click handler sets catIdx from data-idx attribute", () => {
  assert.match(rc, /state\.catIdx = Number\(el\.dataset\.idx\)/);
});

test("renderCats click resets rowIdx to zero before render", () => {
  assert.match(rc, /state\.rowIdx = 0[\s\S]*?render\(\)/);
});

test("renderCats wires click listener on each cat element", () => {
  assert.match(rc, /\$cats\.querySelectorAll\("\.cat"\)\.forEach/);
  assert.match(rc, /addEventListener\("click"/);
});

test("popup CATEGORIES includes all eleven category ids (10 tab views + pass)", () => {
  const block = popup.match(/const CATEGORIES = \[([\s\S]*?)\];/);
  const ids = [...block[1].matchAll(/id:\s*"([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.sort(), [
    "all", "audible", "closed", "current", "history", "minimap", "muted", "pass", "pinned", "scenes", "tree",
  ].sort());
});

test("popup history category uses keyboard shortcut Cmd+0 slot", () => {
  assert.match(popup, /id: "history", label: "History",\s+key: "⌘0"/);
});

test("popup all category is first with Cmd+1 shortcut", () => {
  assert.match(popup, /id: "all",\s+label: "All Tabs",\s+key: "⌘1"/);
});

test("popup escapeHtml helper escapes all five HTML metacharacters", () => {
  assert.match(popup, /"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"/);
});

test("popup imports fzfMatch and highlightWithIndices from lib/fzf.js", () => {
  assert.match(popup, /import \{ fzfMatch, highlightWithIndices \} from "\.\/lib\/fzf\.js"/);
});

test("popup imports buildTabTree flattenTree domainHueFor from lib/util.js", () => {
  assert.match(popup, /import \{ buildTabTree, flattenTree, domainHueFor \} from "\.\/lib\/util\.js"/);
});
