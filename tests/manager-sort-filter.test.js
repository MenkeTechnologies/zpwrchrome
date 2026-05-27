// sortScripts, sortValue, filterScripts, and render count in manager.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const js = readFileSync(join(ROOT, "scripts-manager/manager.js"), "utf8");

const sortFn = js.match(/function sortScripts\(rows\)[\s\S]*?\n\}/);
const sortVal = js.match(/function sortValue\(s, key\)[\s\S]*?\n\}/);
const filterFn = js.match(/function filterScripts\(rows\)[\s\S]*?\n\}/);
const renderFn = js.match(/function render\(\)[\s\S]*?\n\}/);
assert.ok(sortFn && sortVal && filterFn && renderFn, "manager sort/filter/render missing");

test("sortScripts copies rows before sorting (non-mutating)", () => {
  assert.match(sortFn[0], /return \[\.\.\.rows\]\.sort/);
});

test("sortScripts inverts comparison when sort.dir is desc", () => {
  assert.match(sortFn[0], /const dir = sort\.dir === "asc" \? 1 : -1/);
  assert.match(sortFn[0], /return -1 \* dir/);
  assert.match(sortFn[0], /return\s+1 \* dir/);
});

test("sortValue name key lowercases parsed metadata name fallback", () => {
  assert.match(sortVal[0], /key === "name"\)[\s\S]*?toLowerCase\(\)/);
  assert.match(sortVal[0], /parseMetadata\(s\.src\)\?\.name/);
});

test("sortValue size key uses script source byte length", () => {
  assert.match(sortVal[0], /key === "size"\)[\s\S]*?s\.src\?\.length \|\| 0/);
});

test("sortValue updatedAt key uses numeric timestamp with zero default", () => {
  assert.match(sortVal[0], /key === "updatedAt"\)[\s\S]*?s\.updatedAt \|\| 0/);
});

test("sortValue unknown key returns zero for stable tie", () => {
  assert.match(sortVal[0], /return 0/);
});

test("filterScripts returns all rows when filter input is empty", () => {
  assert.match(filterFn[0], /if \(!f\) return rows/);
});

test("filterScripts matches script name case-insensitively", () => {
  assert.match(filterFn[0], /\(s\.name \|\| ""\)\.toLowerCase\(\)\.includes\(f\)/);
});

test("filterScripts matches namespace from parsed metadata", () => {
  assert.match(filterFn[0], /meta\.namespace \|\| ""\)\.toLowerCase\(\)\.includes\(f\)/);
});

test("filterScripts matches any @match or @include pattern substring", () => {
  assert.match(filterFn[0], /\[\.\.\.\(meta\.matches \|\| \[\]\), \.\.\.\(meta\.includes \|\| \[\]\)\]/);
  assert.match(filterFn[0], /\.some\(\(p\) => p\.toLowerCase\(\)\.includes\(f\)\)/);
});

test("render count shows filtered of total with singular script grammar", () => {
  assert.match(renderFn[0], /\$\{rows\.length\} of \$\{scripts\.length\} script\$\{scripts\.length === 1 \? "" : "s"\}/);
});

test("render empty filtered list shows clear filter hint when scripts exist", () => {
  assert.match(renderFn[0], /scripts\.length[\s\S]*?"no matches — clear filter or add a script"/);
});

test("render empty list with zero scripts prompts click plus to add", () => {
  assert.match(renderFn[0], /no scripts installed — click <strong>＋<\/strong>/);
});

test("sortable header click toggles direction when same key clicked twice", () => {
  assert.match(js, /if \(sort\.key === k\) sort\.dir = sort\.dir === "asc" \? "desc" : "asc"/);
});

test("sortable header click resets direction to asc when key changes", () => {
  assert.match(js, /else \{ sort\.key = k; sort\.dir = "asc"; \}/);
});

test("filter input listener calls render on every keystroke", () => {
  assert.match(js, /\$filter\.addEventListener\("input", \(\) => render\(\)\)/);
});
