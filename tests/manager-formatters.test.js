// fmtBytes and fmtDate helpers in scripts-manager/manager.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const js = readFileSync(join(ROOT, "scripts-manager/manager.js"), "utf8");

const fmtBytesFn = js.match(/function fmtBytes\(n\)[\s\S]*?\n\}/);
const fmtDateFn = js.match(/function fmtDate\(t\)[\s\S]*?\n\}/);
assert.ok(fmtBytesFn && fmtDateFn, "formatter functions missing");

test("fmtBytes returns bytes suffix below 1024", () => {
  assert.match(fmtBytesFn[0], /if \(n < 1024\) return n \+ " B"/);
});

test("fmtBytes uses KB with one decimal between 1KB and 1MB", () => {
  assert.match(fmtBytesFn[0], /if \(n < 1024 \* 1024\) return \(n \/ 1024\)\.toFixed\(1\) \+ " KB"/);
});

test("fmtBytes uses MB with two decimals at 1MB and above", () => {
  assert.match(fmtBytesFn[0], /return \(n \/ 1024 \/ 1024\)\.toFixed\(2\) \+ " MB"/);
});

test("fmtDate returns em dash for falsy timestamp", () => {
  assert.match(fmtDateFn[0], /if \(!t\) return "—"/);
});

test("fmtDate formats as M/D/Y without zero-padding", () => {
  assert.match(fmtDateFn[0], /const m = String\(d\.getMonth\(\) \+ 1\)/);
  assert.match(fmtDateFn[0], /const day = String\(d\.getDate\(\)\)/);
  assert.match(fmtDateFn[0], /`\$\{m\}\/\$\{day\}\/\$\{y\}`/);
});

test("rowHtml uses fmtBytes on script source length", () => {
  assert.match(js, /fmtBytes\(s\.src\?\.length \|\| 0\)/);
});

test("rowHtml uses fmtDate on updatedAt column", () => {
  assert.match(js, /fmtDate\(s\.updatedAt\)/);
});

test("refreshStats aggregates script bytes with fmtBytes", () => {
  assert.match(js, /fmtBytes\(scripts\.reduce\(\(s, x\) => s \+ \(x\.src\?\.length \|\| 0\), 0\)\)/);
});

test("manager escapeHtml maps all HTML metacharacters", () => {
  assert.match(js, /"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"/);
});

test("manager version header reads manifest.version with fallback", () => {
  assert.match(js, /\$ver\.textContent = "v" \+ chrome\.runtime\.getManifest\(\)\.version/);
  assert.match(js, /catch \{ \$ver\.textContent = "v\?"; \}/);
});

test("manager default sort key is name ascending", () => {
  assert.match(js, /let sort = \{ key: "name", dir: "asc" \}/);
});

test("manager editor save preserves enabled flag when editing existing script", () => {
  assert.match(js, /enabled: editing \? editing\.enabled : true/);
});
