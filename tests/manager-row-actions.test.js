// Row click actions, badges, and sort header wiring in manager.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const js = readFileSync(join(ROOT, "scripts-manager/manager.js"), "utf8");

const rowHtml = js.match(/function rowHtml\(s, idx\)[\s\S]*?\n\}/);
const onRowClick = js.match(/async function onRowClick\(e, tr\)[\s\S]*?\n\}/);
assert.ok(rowHtml && onRowClick, "manager row helpers missing");

test("onRowClick resolves action from closest data-act attribute", () => {
  assert.match(onRowClick[0], /e\.target\.closest\("\[data-act\]"\)\?\.dataset\.act/);
});

test("onRowClick toggle sends enabled true when row is disabled", () => {
  assert.match(onRowClick[0], /enabled: tr\.classList\.contains\("disabled"\)/);
});

test("onRowClick delete confirms before scripts.delete", () => {
  assert.match(onRowClick[0], /confirm\("delete this script\? GM storage will also be removed\."\)/);
  assert.match(onRowClick[0], /kind: "scripts\.delete", id/);
});

test("onRowClick edit opens editor with matching script record", () => {
  assert.match(onRowClick[0], /scripts\.find\(\(x\) => x\.id === id\)/);
  assert.match(onRowClick[0], /openEditor\(s\)/);
});

test("onRowClick refresh runs after toggle and delete", () => {
  assert.match(onRowClick[0], /await send[\s\S]*?refresh\(\)/);
});

test("rowHtml toggle cell uses data-act toggle on div.toggle", () => {
  assert.match(rowHtml[0], /data-act="toggle"/);
});

test("rowHtml edit and delete buttons use data-act attributes", () => {
  assert.match(rowHtml[0], /data-act="edit"/);
  assert.match(rowHtml[0], /data-act="delete"/);
});

test("rowHtml shows GM grant badge when meta.grants is non-empty", () => {
  assert.match(rowHtml[0], /grants \?.*badge on.*GM/s);
});

test("rowHtml shows requires badge when meta.requires present", () => {
  assert.match(rowHtml[0], /requires \?.*badge lock/s);
});

test("rowHtml shows document-start lightning badge when runAt is document-start", () => {
  assert.match(rowHtml[0], /meta\.runAt === "document-start"/);
  assert.match(rowHtml[0], /document-start.*⚡/);
});

test("rowHtml stores script id in tr data-id attribute escaped", () => {
  assert.match(rowHtml[0], /data-id="\$\{escapeHtml\(s\.id\)\}"/);
});

test("sortable header click toggles asc/desc when same column clicked", () => {
  assert.match(js, /if \(sort\.key === k\) sort\.dir = sort\.dir === "asc" \? "desc" : "asc"/);
});

test("sortable header click resets to asc when switching columns", () => {
  assert.match(js, /else \{ sort\.key = k; sort\.dir = "asc"; \}/);
});

test("filter input triggers full render on input event", () => {
  assert.match(js, /\$filter\.addEventListener\("input", \(\) => render\(\)\)/);
});

test("new-script button opens editor with null script", () => {
  assert.match(js, /\$newBtn\.addEventListener\("click", \(\) => openEditor\(null\)\)/);
});

test("edit cancel button calls closeEditor", () => {
  assert.match(js, /\$editCancel\.addEventListener\("click", closeEditor\)/);
});

test("file input clears value after import so same file can be re-selected", () => {
  assert.match(js, /\$fileInput\.value = ""/);
});

test("manager imports parseMetadata validateUserscript userscriptId from lib", () => {
  assert.match(js, /import[\s\S]+from "\.\.\/lib\/userscript\.js"/);
});
