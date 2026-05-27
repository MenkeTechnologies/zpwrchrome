// updateEditorMeta live validation display in manager editor.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const js = readFileSync(join(ROOT, "scripts-manager/manager.js"), "utf8");

const metaStart = js.indexOf("function updateEditorMeta()");
const metaEnd = js.indexOf('$editor.addEventListener("input", updateEditorMeta)');
assert.ok(metaStart >= 0 && metaEnd > metaStart, "updateEditorMeta missing");
const fn = js.slice(metaStart, metaEnd);

test("updateEditorMeta parses editor textarea via parseMetadata", () => {
  assert.match(fn, /parseMetadata\(\$editor\.value\)/);
});

test("updateEditorMeta shows bad state when no UserScript block found", () => {
  assert.match(fn, /if \(!meta\) \{ \$editMeta\.innerHTML = `<span class="bad">no ==UserScript== block<\/span>`/);
});

test("updateEditorMeta runs validateUserscript on parsed metadata", () => {
  assert.match(fn, /const errs = validateUserscript\(meta\)/);
});

test("updateEditorMeta displays script name version and runAt", () => {
  assert.match(fn, /meta\.name/);
  assert.match(fn, /meta\.version/);
  assert.match(fn, /meta\.runAt/);
});

test("updateEditorMeta counts match include and grant directives", () => {
  assert.match(fn, /meta\.matches\.length/);
  assert.match(fn, /meta\.includes\.length/);
  assert.match(fn, /meta\.grants\.length/);
});

test("updateEditorMeta shows valid ok span when no validation errors", () => {
  assert.match(fn, /span class="ok">valid<\/span>/);
});

test("updateEditorMeta shows bad span with joined errors when invalid", () => {
  assert.match(fn, /span class="bad">\$\{escapeHtml\(errs\.join\("; "\)\)\}<\/span>/);
});

test("updateEditorMeta escapes HTML in displayed metadata fields", () => {
  assert.match(fn, /escapeHtml\(meta\.name/);
  assert.match(fn, /escapeHtml\(meta\.version\)/);
  assert.match(fn, /escapeHtml\(meta\.grants\.join/);
});

test("editor textarea input event triggers updateEditorMeta", () => {
  assert.match(js, /\$editor\.addEventListener\("input", updateEditorMeta\)/);
});

test("openEditor calls updateEditorMeta after seeding editor value", () => {
  const open = js.match(/function openEditor\(script\)[\s\S]*?\n\}/);
  assert.match(open[0], /updateEditorMeta\(\)/);
});

test("openEditor sets title to new script for blank editor", () => {
  const open = js.match(/function openEditor\(script\)[\s\S]*?\n\}/);
  assert.match(open[0], /: "new script"/);
});

test("openEditor sets title to edit plus script name when editing", () => {
  const open = js.match(/function openEditor\(script\)[\s\S]*?\n\}/);
  assert.match(open[0], /edit · \$\{script\.name/);
});

test("scripts.save failure surfaces resp.errors in alert", () => {
  assert.match(js, /alert\("save failed:\\n" \+ \(\(resp\?\.errors \|\| \[\]\)\.join/);
});

test("editor save uses userscriptId when creating new script id", () => {
  assert.match(js, /const id = editing\?\.id \|\| userscriptId\(meta\)/);
});
