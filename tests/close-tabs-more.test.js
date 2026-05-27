// Batch tab-close command edge cases in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

function fnBody(name) {
  const m = bg.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} not found`);
  return m[0];
}

test("closeOthers queries current window tabs only", () => {
  const fn = fnBody("closeOthers");
  assert.match(fn, /chrome\.tabs\.query\(\{ currentWindow: true \}\)/);
});

test("closeOthers never closes the active tab", () => {
  const fn = fnBody("closeOthers");
  assert.match(fn, /!t\.active/);
});

test("closeOthers never closes pinned tabs", () => {
  const fn = fnBody("closeOthers");
  assert.match(fn, /!t\.pinned/);
});

test("closeOthers skips chrome.tabs.remove when victim list is empty", () => {
  const fn = fnBody("closeOthers");
  assert.match(fn, /if \(victims\.length\) await chrome\.tabs\.remove\(victims\)/);
});

test("closeRight finds active tab before selecting victims", () => {
  const fn = fnBody("closeRight");
  assert.match(fn, /const active = tabs\.find\(\(t\) => t\.active\)/);
  assert.match(fn, /if \(!active\) return/);
});

test("closeRight removes tabs with index greater than active only", () => {
  const fn = fnBody("closeRight");
  assert.match(fn, /t\.index > active\.index/);
});

test("closeRight preserves pinned tabs to the right of active", () => {
  const fn = fnBody("closeRight");
  assert.match(fn, /!t\.pinned/);
});

test("closeDuplicates tracks seen URLs in a Set", () => {
  const fn = fnBody("closeDuplicates");
  assert.match(fn, /const seen = new Set\(\)/);
  assert.match(fn, /seen\.has\(t\.url\)/);
  assert.match(fn, /seen\.add\(t\.url\)/);
});

test("closeDuplicates skips pinned tabs entirely", () => {
  const fn = fnBody("closeDuplicates");
  assert.match(fn, /if \(t\.pinned\) continue/);
});

test("closeDuplicates keeps leftmost tab for each duplicate URL", () => {
  const fn = fnBody("closeDuplicates");
  assert.match(fn, /if \(seen\.has\(t\.url\)\) victims\.push\(t\.id\)/);
});

test("dispatch close-others routes to closeOthers helper", () => {
  assert.match(bg, /command === "close-others"\)[\s\S]*?closeOthers\(\)/);
});

test("dispatch close-right routes to closeRight helper", () => {
  assert.match(bg, /command === "close-right"\)[\s\S]*?closeRight\(\)/);
});

test("dispatch close-duplicates routes to closeDuplicates helper", () => {
  assert.match(bg, /command === "close-duplicates"\)[\s\S]*?closeDuplicates\(\)/);
});

test("reloadAll reloads every tab in current window via Promise.all", () => {
  const fn = fnBody("reloadAll");
  assert.match(fn, /Promise\.all\(tabs\.map\(\(t\) => chrome\.tabs\.reload\(t\.id\)\)\)/);
});

test("sortByUrl moves only unpinned tabs in current window", () => {
  const fn = fnBody("sortByUrl");
  assert.match(fn, /chrome\.tabs\.query\(\{ currentWindow: true, pinned: false \}\)/);
});

test("groupByDomain requires both chrome.tabs.group and chrome.tabGroups", () => {
  const fn = fnBody("groupByDomain");
  assert.match(fn, /if \(!chrome\.tabs\.group \|\| !chrome\.tabGroups\) return/);
});
