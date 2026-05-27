// syncUserScripts error and unavailable API paths in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

const syncStart = bg.indexOf("async function syncUserScripts");
const syncEnd = bg.indexOf("chrome.runtime.onInstalled.addListener(initUserscripts)");
assert.ok(syncStart >= 0 && syncEnd > syncStart, "syncUserScripts missing");
const sync = bg.slice(syncStart, syncEnd);

test("syncUserScripts returns early when chrome.userScripts is undefined", () => {
  assert.match(sync, /if \(!chrome\.userScripts\) \{/);
  assert.match(sync, /return \{ registered: 0, error: "API unavailable" \}/);
});

test("syncUserScripts persists userScripts.error when API unavailable", () => {
  assert.match(sync, /"userScripts\.error": "chrome\.userScripts API not available/);
});

test("syncUserScripts unregister failure stores error and returns zero registered", () => {
  assert.match(sync, /catch \(e\) \{[\s\S]*?"userScripts\.error": "unregister: " \+ msg/);
  assert.match(sync, /return \{ registered: 0, error: msg \}/);
});

test("syncUserScripts clears userScripts.error after successful unregister", () => {
  const unreg = sync.indexOf("chrome.userScripts.unregister");
  const removeErr = sync.indexOf('chrome.storage.local.remove("userScripts.error")', unreg);
  assert.ok(unreg >= 0 && removeErr > unreg);
});

test("syncUserScripts register failure stores register error in storage", () => {
  assert.match(sync, /"userScripts.error": "register: " \+ msg/);
  assert.match(sync, /return \{ registered: 0, error: msg, skipped \}/);
});

test("syncUserScripts skips scripts with no metadata block", () => {
  assert.match(sync, /if \(!meta\) \{ skipped\.push\(\{ id: s\.id, reason: "no metadata block" \}\)/);
});

test("syncUserScripts skips scripts failing validateUserscript with joined reasons", () => {
  assert.match(sync, /if \(errs\.length\) \{ skipped\.push\(\{ id: s\.id, reason: errs\.join\(", "\) \}\)/);
});

test("syncUserScripts skips scripts with no usable match patterns", () => {
  assert.match(sync, /if \(!baseMatches\.length\) \{ skipped\.push\(\{ id: s\.id, reason: "no usable @match" \}\)/);
});

test("syncUserScripts embeds scriptMetaStr from UserScript header block", () => {
  assert.match(sync, /scriptMetaStr: \(s\.src\.match\(/);
  assert.match(sync, /==\\\/UserScript==/);
});

test("syncUserScripts sets scriptHandler to zpwrchrome in GM_info payload", () => {
  assert.match(sync, /scriptHandler: "zpwrchrome"/);
});

test("syncUserScripts fallback info uses zpwrchrome-fallback handler label in handleNav only", () => {
  const hn = bg.match(/async function handleNav\([\s\S]*?\n\}/);
  assert.match(hn[0], /scriptHandler: "zpwrchrome-fallback"/);
});

test("syncUserScripts registration sets allFrames false", () => {
  assert.match(sync, /allFrames: false/);
});

test("syncUserScripts logs registration and skip counts to console.info", () => {
  assert.match(sync, /console\.info\("\[zpwrchrome\] registering"/);
  assert.match(sync, /console\.info\("\[zpwrchrome\] skipped:", skipped\)/);
});

test("syncUserScripts getScripts verification failure is console.warn not fatal", () => {
  assert.match(sync, /console\.warn\("\[zpwrchrome\] getScripts verification failed:"/);
});
