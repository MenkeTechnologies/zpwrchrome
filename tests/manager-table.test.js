// Installed-scripts table sort, filter, and row rendering in manager.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const js = readFileSync(join(ROOT, "scripts-manager/manager.js"), "utf8");

test("filterScripts matches against name namespace and match patterns", () => {
  const fn = js.match(/function filterScripts\(rows\)[\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /meta\.namespace/);
  assert.match(fn[0], /meta\.matches/);
  assert.match(fn[0], /meta\.includes/);
});

test("sortScripts supports name size and updatedAt keys", () => {
  const fn = js.match(/function sortValue\(s, key\)[\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /key === "name"/);
  assert.match(fn[0], /key === "size"/);
  assert.match(fn[0], /key === "updatedAt"/);
});

test("sortScripts name key falls back to parseMetadata name", () => {
  const fn = js.match(/function sortValue\(s, key\)[\s\S]*?\n\}/);
  assert.match(fn[0], /parseMetadata\(s\.src\)\?\.name/);
});

test("render shows filtered count of total scripts", () => {
  assert.match(js, /\$\{rows\.length\} of \$\{scripts\.length\} script/);
});

test("render empty-with-filter prompts to clear filter", () => {
  assert.match(js, /scripts\.length[\s\S]*?"no matches — clear filter/);
});

test("render empty-without-scripts prompts add via plus button", () => {
  assert.match(js, /no scripts installed — click <strong>＋<\/strong>/);
});

test("rowHtml marks disabled scripts with disabled class on tr", () => {
  const fn = js.match(/function rowHtml\(s, idx\)[\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /class="\$\{s\.enabled \? "" : "disabled"\}"/);
});

test("rowHtml shows homepage link when namespace is http(s) URL", () => {
  const fn = js.match(/function rowHtml\(s, idx\)[\s\S]*?\n\}/);
  assert.ok(fn[0].includes("/^https?:\\/\\//.test(meta.namespace)"));
  assert.match(fn[0], /class="home-link"/);
});

test("rowHtml truncates description to 80 characters in table cell", () => {
  const fn = js.match(/function rowHtml\(s, idx\)[\s\S]*?\n\}/);
  assert.match(fn[0], /meta\.description\.slice\(0, 80\)/);
});

test("rowHtml counts match and include patterns for sites column", () => {
  const fn = js.match(/function rowHtml\(s, idx\)[\s\S]*?\n\}/);
  assert.match(fn[0], /meta\.matches\?\.length/);
  assert.match(fn[0], /meta\.includes\?\.length/);
});

test("refreshStats updates stat-count with scripts.length", () => {
  assert.match(js, /getElementById\("stat-count"\)/);
  assert.match(js, /c\.textContent = String\(scripts\.length\)/);
});

test("refreshStats sums script source bytes for stat-bytes", () => {
  assert.match(js, /getElementById\("stat-bytes"\)/);
  assert.match(js, /scripts\.reduce\(\(s, x\) => s \+ \(x\.src\?\.length \|\| 0\)/);
});

test("refresh shows red error banner when resp.error and not fallback mode", () => {
  assert.match(js, /if \(resp\?\.error && !isFallback\)/);
  assert.match(js, /\$error\.classList\.remove\("hidden"\)/);
});

test("refresh shows yellow info banner in fallback mode", () => {
  assert.match(js, /else if \(isFallback\)/);
  assert.match(js, /\$info\.classList\.remove\("hidden"\)/);
});

test("refresh stat-api labels native mode green when chrome.userScripts available", () => {
  assert.match(js, /available \(native chrome\.userScripts\)/);
  assert.match(js, /var\(--green\)/);
});

test("refresh stat-live renders skipped scripts from lastSync metadata", () => {
  assert.match(js, /sync\.skipped\?\.length/);
  assert.match(js, /sync\.skipped\.map\(x => x\.id/);
});

test("render attaches click handler to each table row for selection", () => {
  assert.match(js, /\$list\.querySelectorAll\("tr"\)\.forEach\(\(tr\) =>/);
  assert.match(js, /onRowClick\(e, tr\)/);
});

test("sortable column headers toggle sort-asc and sort-desc classes", () => {
  assert.match(js, /th\.classList\.add\(sort\.dir === "asc" \? "sort-asc" : "sort-desc"\)/);
});
