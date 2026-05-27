// Editor modal keyboard shortcuts and dismiss behavior in manager.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const js = readFileSync(join(ROOT, "scripts-manager/manager.js"), "utf8");

test("editor Escape closes modal when editor is visible", () => {
  assert.match(js, /e\.key === "Escape" && !\$modal\.classList\.contains\("hidden"\)\) closeEditor\(\)/);
});

test("editor Cmd/Ctrl+S prevents default and triggers save click", () => {
  assert.match(js, /\(e\.metaKey \|\| e\.ctrlKey\) && e\.key === "s" && !\$modal\.classList\.contains\("hidden"\)/);
  assert.match(js, /e\.preventDefault\(\); \$editSave\.click\(\)/);
});

test("editor backdrop click on modal overlay closes editor", () => {
  assert.match(js, /\$modal\.addEventListener\("click", \(e\) => \{ if \(e\.target === \$modal\) closeEditor\(\); \}\)/);
});

test("editCancel button calls closeEditor", () => {
  assert.match(js, /\$editCancel\.addEventListener\("click", closeEditor\)/);
});

test("closeEditor hides modal and clears editing reference", () => {
  const fn = js.match(/function closeEditor\(\)[\s\S]*?\n\}/);
  assert.match(fn[0], /\$modal\.classList\.add\("hidden"\)/);
  assert.match(fn[0], /editing = null/);
});

test("openEditor removes hidden class from modal", () => {
  const fn = js.match(/function openEditor\(script\)[\s\S]*?\n\}/);
  assert.match(fn[0], /\$modal\.classList\.remove\("hidden"\)/);
});

test("openEditor focuses editor and moves caret to end of source", () => {
  const fn = js.match(/function openEditor\(script\)[\s\S]*?\n\}/);
  assert.match(fn[0], /\$editor\.focus\(\)/);
  assert.match(fn[0], /\$editor\.setSelectionRange\(\$editor\.value\.length, \$editor\.value\.length\)/);
});

test("new script button opens editor with null script", () => {
  assert.match(js, /\$newBtn\.addEventListener\("click", \(\) => openEditor\(null\)\)/);
});

test("editor save blocks when validateUserscript returns errors", () => {
  assert.match(js, /if \(errs\.length\) \{ alert\("can't save:/);
});

test("editor save closes editor and refreshes list on success", () => {
  assert.match(js, /if \(!resp\?\.ok\)[\s\S]*?closeEditor\(\)/);
  assert.match(js, /closeEditor\(\)[\s\S]*?refresh\(\)/);
});

test("editor save alert on failure includes resp.errors joined", () => {
  assert.match(js, /alert\("save failed:\\n" \+ \(\(resp\?\.errors \|\| \[\]\)\.join/);
});

test("openEditor calls updateEditorMeta after seeding value", () => {
  const fn = js.match(/function openEditor\(script\)[\s\S]*?\n\}/);
  assert.match(fn[0], /updateEditorMeta\(\)/);
});
