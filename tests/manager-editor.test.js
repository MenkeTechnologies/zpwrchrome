// Userscript manager editor, tabs, and import/export invariants.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const js = readFileSync(join(ROOT, "scripts-manager/manager.js"), "utf8");
const html = readFileSync(join(ROOT, "scripts-manager/manager.html"), "utf8");

test("manager send() wraps chrome.runtime.sendMessage in a Promise", () => {
  assert.match(js, /function send\(msg\)/);
  assert.match(js, /return new Promise\(\(resolve\) => chrome\.runtime\.sendMessage\(msg, resolve\)\)/);
});

test("manager tab click activates matching pane by data-tab id", () => {
  assert.match(js, /document\.getElementById\("pane-" \+ el\.dataset\.tab\)/);
  assert.match(js, /classList\.remove\("active"\)/);
});

test("manager switching to log tab triggers refreshLog()", () => {
  assert.match(js, /if \(el\.dataset\.tab === "log"\) refreshLog\(\)/);
});

test("manager storage.onChanged listens for userScripts.fireLog updates", () => {
  assert.match(js, /chrome\.storage\.onChanged\.addListener/);
  assert.match(js, /changes\["userScripts\.fireLog"\]/);
});

test("manager updateLogCount annotates Run Log tab with entry count", () => {
  assert.match(js, /Run Log \(\$\{logEntries\.length\}\)/);
});

test("manager editor save validates metadata before scripts.save", () => {
  assert.match(js, /const errs = validateUserscript\(meta\)/);
  assert.match(js, /if \(errs\.length\) \{ alert\("can't save:/);
});

test("manager editor save passes isNew flag from editing state", () => {
  assert.match(js, /const isNew = !editing/);
  assert.match(js, /kind: "scripts\.save"/);
  assert.match(js, /isNew,/);
});

test("manager editor Cmd/Ctrl+S triggers save when modal is open", () => {
  assert.match(js, /\(e\.metaKey \|\| e\.ctrlKey\) && e\.key === "s"/);
  assert.match(js, /\$editSave\.click\(\)/);
});

test("manager editor Escape closes modal when visible", () => {
  assert.match(js, /e\.key === "Escape" && !\$modal\.classList\.contains\("hidden"\)/);
  assert.match(js, /closeEditor\(\)/);
});

test("manager editor backdrop click closes modal", () => {
  assert.match(js, /\$modal\.addEventListener\("click"/);
  assert.match(js, /if \(e\.target === \$modal\) closeEditor\(\)/);
});

test("manager openEditor seeds new scripts from TEMPLATE constant", () => {
  assert.match(js, /const TEMPLATE = `\/\/ ==UserScript==/);
  assert.match(js, /\$editor\.value = script \? script\.src : TEMPLATE/);
});

test("manager openEditor focuses editor and moves caret to end", () => {
  assert.match(js, /\$editor\.focus\(\)/);
  assert.match(js, /\$editor\.setSelectionRange\(\$editor\.value\.length, \$editor\.value\.length\)/);
});

test("manager file import reads .user.js via File.text() then openEditor", () => {
  assert.match(js, /const src = await file\.text\(\)/);
  assert.match(js, /openEditor\(\{ src \}\)/);
});

test("manager URL import fetches remote script and surfaces HTTP errors", () => {
  assert.match(js, /const r = await fetch\(url\)/);
  assert.match(js, /if \(!r\.ok\) throw new Error\("HTTP " \+ r\.status\)/);
  assert.match(js, /alert\("fetch failed: " \+ e\.message\)/);
});

test("manager download() revokes object URL after click", () => {
  assert.match(js, /function download\(blob, name\)/);
  assert.match(js, /URL\.revokeObjectURL\(url\)/);
});

test("manager row toggle sends scripts.toggle with inverted enabled state", () => {
  assert.match(js, /kind: "scripts\.toggle", id, enabled: tr\.classList\.contains\("disabled"\)/);
});

test("manager row delete confirms GM storage removal", () => {
  assert.match(js, /confirm\("delete this script\? GM storage will also be removed\."\)/);
});

test("manager render shows disabled class on toggled-off scripts", () => {
  assert.match(js, /class="\$\{s\.enabled \? "" : "disabled"\}"/);
});

test("manager.html editor modal is hidden by default", () => {
  assert.match(html, /id="editor-modal"[^>]*class="[^"]*hidden/);
});

test("manager.html installed pane has filter input and script count", () => {
  assert.match(html, /id="filter"/);
  assert.match(html, /id="count"/);
});

test("manager.html help pane documents @match and @grant directives", () => {
  assert.match(html, /id="pane-help"/);
  assert.match(html, /@match/);
});

test("manager refresh sets stat-api cell color for native vs fallback", () => {
  assert.match(js, /apiCell\.style\.color = "var\(--yellow\)"/);
  assert.match(js, /apiCell\.style\.color = "var\(--green\)"/);
});
