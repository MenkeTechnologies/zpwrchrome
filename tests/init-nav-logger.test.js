// initUserscripts and enableNavigationLogger wiring in background.js.

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

test("initUserscripts calls syncUserScripts on startup", () => {
  const fn = fnBody("initUserscripts");
  assert.match(fn, /await syncUserScripts\(\)/);
});

test("initUserscripts always wires navigation logger after sync", () => {
  const fn = fnBody("initUserscripts");
  assert.match(fn, /enableNavigationLogger\(\)/);
});

test("initUserscripts registered on onInstalled and onStartup listeners", () => {
  assert.match(bg, /chrome\.runtime\.onInstalled\.addListener\(initUserscripts\)/);
  assert.match(bg, /chrome\.runtime\.onStartup\.addListener\(initUserscripts\)/);
});

test("initUserscripts invoked once at service worker load", () => {
  assert.match(bg, /initUserscripts\(\);/);
});

test("enableNavigationLogger is idempotent via navListenerWired guard", () => {
  const fn = fnBody("enableNavigationLogger");
  assert.match(fn, /if \(navListenerWired\) return/);
  assert.match(fn, /navListenerWired = true/);
});

test("enableNavigationLogger warns when webNavigation API missing", () => {
  const fn = fnBody("enableNavigationLogger");
  assert.match(fn, /if \(!chrome\.webNavigation\)/);
  assert.match(fn, /console\.warn\("\[zpwrchrome\] no webNavigation API/);
});

test("enableNavigationLogger logs native vs fallback mode at activation", () => {
  const fn = fnBody("enableNavigationLogger");
  assert.match(fn, /navigation logger active \(mode:", chrome\.userScripts \? "native" : "fallback"/);
});

test("enableNavigationLogger wires onCommitted to document-start phase", () => {
  const fn = fnBody("enableNavigationLogger");
  assert.match(fn, /onCommitted\.addListener\(\(details\) => handleNav\(details, "document-start"\)\)/);
});

test("enableNavigationLogger wires onDOMContentLoaded to document-end phase", () => {
  const fn = fnBody("enableNavigationLogger");
  assert.match(fn, /onDOMContentLoaded\.addListener\(\(details\) => handleNav\(details, "document-end"\)\)/);
});

test("enableNavigationLogger wires onCompleted to document-idle phase", () => {
  const fn = fnBody("enableNavigationLogger");
  assert.match(fn, /onCompleted\.addListener\(\(details\) => handleNav\(details, "document-idle"\)\)/);
});

test("writeScripts persists scripts then triggers syncUserScripts", () => {
  const fn = fnBody("writeScripts");
  assert.match(fn, /chrome\.storage\.local\.set\(\{ \[SCRIPTS_KEY\]: scripts \}\)/);
  assert.match(fn, /await syncUserScripts\(\)/);
});

test("readScripts returns empty array when storage value is not an array", () => {
  const fn = fnBody("readScripts");
  assert.match(fn, /return Array\.isArray\(arr\) \? arr : \[\]/);
});
