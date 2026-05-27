// Chrome extensions banner buttons and manager tab UI in manager.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const js = readFileSync(join(ROOT, "scripts-manager/manager.js"), "utf8");

test("banner buttons open-chrome-ext and open-chrome-ext-err share click handler loop", () => {
  assert.match(js, /for \(const id of \["open-chrome-ext", "open-chrome-ext-err"\]\)/);
});

test("chrome extensions button opens chrome://extensions with extension id", () => {
  assert.match(js, /chrome\.tabs\.create\(\{ url: "chrome:\/\/extensions\/\?id=" \+ chrome\.runtime\.id \}\)/);
});

test("manager tab click activates pane by data-tab attribute", () => {
  assert.match(js, /document\.getElementById\("pane-" \+ el\.dataset\.tab\)\.classList\.add\("active"\)/);
});

test("manager tab click removes active class from all tabs and panes first", () => {
  assert.match(js, /querySelectorAll\("\.tab"\)\.forEach[\s\S]*?classList\.remove\("active"\)/);
  assert.match(js, /querySelectorAll\("\.pane"\)\.forEach[\s\S]*?classList\.remove\("active"\)/);
});

test("switching to log tab triggers refreshLog", () => {
  assert.match(js, /if \(el\.dataset\.tab === "log"\) refreshLog\(\)/);
});

test("manager calls refresh on initial page load", () => {
  assert.match(js, /^refresh\(\);$/m);
});

test("send helper wraps chrome.runtime.sendMessage in Promise", () => {
  const fn = js.match(/function send\(msg\)[\s\S]*?\n\}/);
  assert.match(fn[0], /return new Promise\(\(resolve\) => chrome\.runtime\.sendMessage\(msg, resolve\)\)/);
});

test("manager imports parseMetadata validateUserscript userscriptId", () => {
  assert.match(js, /import[\s\S]+parseMetadata[\s\S]+validateUserscript[\s\S]+userscriptId[\s\S]+from "\.\.\/lib\/userscript\.js"/);
});

test("manager default sort state is name ascending", () => {
  assert.match(js, /let sort = \{ key: "name", dir: "asc" \}/);
});

test("manager scripts array starts empty before first refresh", () => {
  assert.match(js, /let scripts = \[\]/);
});

test("manager editing reference starts null", () => {
  assert.match(js, /let editing = null/);
});
