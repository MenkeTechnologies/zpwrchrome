// chrome.userScripts.configureWorld invariants in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

const fn = bg.match(/async function configureUserScriptsWorld\([\s\S]*?\n\}/);
assert.ok(fn, "configureUserScriptsWorld not found");

test("configureUserScriptsWorld guards on chrome.userScripts.configureWorld presence", () => {
  assert.match(fn[0], /if \(!chrome\.userScripts\?\.configureWorld\) return/);
});

test("configureUserScriptsWorld enables messaging for USER_SCRIPT world", () => {
  assert.match(fn[0], /messaging:\s*true/);
});

test("configureUserScriptsWorld sets permissive script-src CSP for GM shim eval", () => {
  assert.match(fn[0], /csp: "script-src 'self' 'unsafe-inline' 'unsafe-eval'/);
});

test("configureUserScriptsWorld swallows configureWorld failures with console.warn", () => {
  assert.match(fn[0], /catch \(e\)/);
  assert.match(fn[0], /console\.warn\("\[zpwrchrome\] configureWorld failed:"/);
});

test("syncUserScripts calls configureUserScriptsWorld before reading scripts", () => {
  const start = bg.indexOf("async function syncUserScripts");
  const end = bg.indexOf("chrome.runtime.onInstalled.addListener(initUserscripts)");
  const sync = bg.slice(start, end);
  const cfgIdx = sync.indexOf("configureUserScriptsWorld");
  const readIdx = sync.indexOf("const scripts = await readScripts()");
  assert.ok(cfgIdx >= 0 && readIdx >= 0 && cfgIdx < readIdx);
});

test("syncUserScripts clears userScripts.error when native API becomes available", () => {
  const start = bg.indexOf("async function syncUserScripts");
  const end = bg.indexOf("chrome.runtime.onInstalled.addListener(initUserscripts)");
  const sync = bg.slice(start, end);
  assert.match(sync, /chrome\.storage\.local\.remove\("userScripts\.error"\)/);
});

test("syncUserScripts unregister runs before building new registrations", () => {
  const start = bg.indexOf("async function syncUserScripts");
  const end = bg.indexOf("chrome.runtime.onInstalled.addListener(initUserscripts)");
  const sync = bg.slice(start, end);
  const unreg = sync.indexOf("chrome.userScripts.unregister");
  const loop = sync.indexOf("for (const s of scripts)");
  assert.ok(unreg >= 0 && loop >= 0 && unreg < loop);
});

test("syncUserScripts registration uses world USER_SCRIPT not ISOLATED", () => {
  const start = bg.indexOf("async function syncUserScripts");
  const end = bg.indexOf("chrome.runtime.onInstalled.addListener(initUserscripts)");
  const sync = bg.slice(start, end);
  assert.match(sync, /world: "USER_SCRIPT"/);
});

test("syncUserScripts registration js array wraps code string", () => {
  const start = bg.indexOf("async function syncUserScripts");
  const end = bg.indexOf("chrome.runtime.onInstalled.addListener(initUserscripts)");
  const sync = bg.slice(start, end);
  assert.match(sync, /js: \[\{ code \}\]/);
});

test("syncUserScripts verifies registration via getScripts after register", () => {
  const start = bg.indexOf("async function syncUserScripts");
  const end = bg.indexOf("chrome.runtime.onInstalled.addListener(initUserscripts)");
  const sync = bg.slice(start, end);
  assert.match(sync, /chrome\.userScripts\.getScripts\(\)/);
  assert.match(sync, /liveIds: live\.map/);
});

test("syncUserScripts skips disabled scripts with reason disabled", () => {
  const start = bg.indexOf("async function syncUserScripts");
  const end = bg.indexOf("chrome.runtime.onInstalled.addListener(initUserscripts)");
  const sync = bg.slice(start, end);
  assert.match(sync, /reason: "disabled"/);
});

test("syncUserScripts logs live script ids after successful sync", () => {
  const start = bg.indexOf("async function syncUserScripts");
  const end = bg.indexOf("chrome.runtime.onInstalled.addListener(initUserscripts)");
  const sync = bg.slice(start, end);
  assert.match(sync, /live scripts after sync/);
});
