// Fire log ring buffer and userscript init wiring in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

function fnBody(name) {
  const m = bg.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} not found`);
  return m[0];
}

test("appendFireLog prepends newest entry (unshift)", () => {
  const fn = fnBody("appendFireLog");
  assert.match(fn, /log\.unshift\(final\)/);
});

test("appendFireLog stamps when if missing on entry", () => {
  const fn = fnBody("appendFireLog");
  assert.match(fn, /const final = \{ when: Date\.now\(\), \.\.\.entry \}/);
});

test("appendFireLog truncates log to FIRE_LOG_CAP entries", () => {
  const fn = fnBody("appendFireLog");
  assert.match(fn, /if \(log\.length > FIRE_LOG_CAP\) log\.length = FIRE_LOG_CAP/);
  assert.match(bg, /const FIRE_LOG_CAP = 200/);
});

test("appendFireLog persists under FIRE_LOG_KEY in chrome.storage.local", () => {
  const fn = fnBody("appendFireLog");
  assert.match(fn, /chrome\.storage\.local\.get\(FIRE_LOG_KEY\)/);
  assert.match(fn, /chrome\.storage\.local\.set\(\{\s*\[FIRE_LOG_KEY\]: log\s*\}\)/);
});

test("initUserscripts calls syncUserScripts then enableNavigationLogger", () => {
  const fn = fnBody("initUserscripts");
  assert.match(fn, /await syncUserScripts\(\)/);
  assert.match(fn, /enableNavigationLogger\(\)/);
});

test("initUserscripts is registered on onInstalled and onStartup", () => {
  assert.match(bg, /chrome\.runtime\.onInstalled\.addListener\(initUserscripts\)/);
  assert.match(bg, /chrome\.runtime\.onStartup\.addListener\(initUserscripts\)/);
});

test("initUserscripts also runs once at service worker load", () => {
  assert.match(bg, /initUserscripts\(\);/);
});

test("enableNavigationLogger is idempotent via navListenerWired guard", () => {
  const fn = fnBody("enableNavigationLogger");
  assert.match(fn, /if \(navListenerWired\) return/);
  assert.match(fn, /navListenerWired = true/);
});

test("enableNavigationLogger bails when webNavigation API is missing", () => {
  const fn = fnBody("enableNavigationLogger");
  assert.match(fn, /if \(!chrome\.webNavigation\)/);
  assert.match(fn, /fire log won't update/);
});

test("enableNavigationLogger wires all three navigation phases", () => {
  const fn = fnBody("enableNavigationLogger");
  assert.match(fn, /onCommitted\.addListener\(\(details\) => handleNav\(details, "document-start"\)\)/);
  assert.match(fn, /onDOMContentLoaded\.addListener\(\(details\) => handleNav\(details, "document-end"\)\)/);
  assert.match(fn, /onCompleted\.addListener\(\(details\) => handleNav\(details, "document-idle"\)\)/);
});

test("handleNav early-returns for negative tabId", () => {
  const fn = fnBody("handleNav");
  assert.match(fn, /if \(typeof tabId !== "number" \|\| tabId < 0\) return/);
});

test("handleNav accepts http, https, file, and ftp URLs only", () => {
  const fn = fnBody("handleNav");
  assert.match(fn, /if \(!url \|\| !\/\^\(https\?\|file\|ftp\):\/i\.test\(url\)\) return/);
});

test("handleNav fallback inject uses injectImmediately for document-start phase", () => {
  const fn = fnBody("handleNav");
  assert.match(fn, /injectImmediately: phase === "document-start"/);
});

test("handleNav fallback wraps user script in IIFE with GM shim prepended", () => {
  const fn = fnBody("handleNav");
  assert.match(fn, /GM_SHIM_SOURCE\.replace\("__GM_INFO_JSON__"/);
  assert.match(fn, /"\(function \(\) \{\\n" \+/);
});

test("handleNav fallback silently skips restricted chrome:// injection errors", () => {
  const start = bg.indexOf("async function handleNav");
  const end = bg.indexOf("// Popup data API");
  const fn = bg.slice(start, end);
  assert.match(fn, /Restricted pages \(chrome:\/\/, web store\)/);
  assert.match(fn, /chromewebstore\/\.test\(e\?\.message/);
});

test("configureUserScriptsWorld enables messaging for USER_SCRIPT world", () => {
  const fn = fnBody("configureUserScriptsWorld");
  assert.match(fn, /messaging:\s*true/);
});

test("configureUserScriptsWorld sets permissive CSP for eval-heavy userscripts", () => {
  const fn = fnBody("configureUserScriptsWorld");
  assert.match(fn, /unsafe-eval/);
});
