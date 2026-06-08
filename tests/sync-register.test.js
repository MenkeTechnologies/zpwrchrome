// chrome.userScripts registration object invariants in syncUserScripts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

const start = bg.indexOf("async function syncUserScripts");
const end = bg.indexOf("chrome.runtime.onInstalled.addListener(initUserscripts)");
const fn = bg.slice(start, end);
assert.ok(start >= 0 && end > start, "syncUserScripts body not found");

test("syncUserScripts early-returns with API unavailable error when chrome.userScripts missing", () => {
  assert.match(fn, /if \(!chrome\.userScripts\)/);
  assert.match(fn, /return \{ registered: 0, error: "API unavailable" \}/);
});

test("syncUserScripts skips scripts with no metadata block", () => {
  assert.match(fn, /if \(!meta\) \{ skipped\.push\(\{ id: s\.id, reason: "no metadata block" \}\)/);
});

test("syncUserScripts skips scripts failing validateUserscript", () => {
  assert.match(fn, /const errs = validateUserscript\(meta\)/);
  assert.match(fn, /if \(errs\.length\) \{ skipped\.push/);
});

test("syncUserScripts skips scripts with no usable @match after include conversion", () => {
  assert.match(fn, /if \(!baseMatches\.length\) \{ skipped\.push\(\{ id: s\.id, reason: "no usable @match" \}\)/);
});

test("syncUserScripts builds registration with USER_SCRIPT world and allFrames false", () => {
  assert.match(fn, /world: "USER_SCRIPT"/);
  assert.match(fn, /allFrames: false/);
});

test("syncUserScripts wraps user source in IIFE with GM shim prepended", () => {
  assert.match(fn, /const shim = GM_SHIM_SOURCE\.replace\("__GM_INFO_JSON__"/);
  assert.match(fn, /"\(function \(\) \{\\n" \+/);
  assert.match(fn, /"\}\)\.call\(window\);"/);
});

test("syncUserScripts sets scriptHandler to zpwrchrome for native registrations", () => {
  assert.match(fn, /scriptHandler: "zpwrchrome"/);
});

test("syncUserScripts embeds scriptMetaStr from the ==UserScript== header block", () => {
  assert.match(fn, /scriptMetaStr: \(s\.src\.match/);
  assert.match(fn, /==UserScript==/);
});

test("syncUserScripts converts runAt dashes to underscores for chrome.userScripts API", () => {
  assert.match(fn, /runAt: meta\.runAt\.replace\(\/-\/g, "_"\)/);
});

test("syncUserScripts only adds excludeMatches when meta.excludes is non-empty", () => {
  assert.match(fn, /if \(meta\.excludes\.length\) reg\.excludeMatches = meta\.excludes/);
});

test("syncUserScripts register failure persists userScripts.error to storage", () => {
  assert.match(fn, /catch \(e\) \{[\s\S]*?"userScripts\.error": "register: " \+ msg/);
});

test("syncUserScripts unregister failure also persists error and aborts", () => {
  assert.match(fn, /unregister failed/);
  assert.match(fn, /"userScripts.error": "unregister: " \+ msg/);
});

test("syncUserScripts persists lastSync with registered count and liveIds", () => {
  assert.match(fn, /"userScripts\.lastSync"/);
  assert.match(fn, /liveIds: live\.map/);
  assert.match(fn, /skipped/);
});

test("syncUserScripts returns registered count and skipped array", () => {
  assert.match(fn, /return \{ registered, skipped \}/);
});

test("syncUserScripts uses userscriptId(meta) as registration id", () => {
  assert.match(fn, /let id = userscriptId\(meta\)/);
  assert.match(fn, /id,/);
});

test("syncUserScripts disambiguates duplicate registration IDs at load time", () => {
  // Two stored scripts with identical @name+@namespace would otherwise collide
  // and chrome.userScripts.register would reject the whole batch. Save-time
  // isNew check rejects new dupes — load must never error on legacy dupes.
  assert.match(fn, /usedIds/);
  assert.match(fn, /duplicate userscript id at load/);
  assert.match(fn, /\$\{id\}__\$\{(\+\+suffix|suffix)\}/);
});

test("syncUserScripts serializes concurrent callers via an in-flight mutex", () => {
  // Three listeners can fire syncUserScripts in the same tick — onInstalled,
  // onStartup, and the bare boot call. Without serialization their
  // unregister()+register() pairs interleave and chrome.userScripts.register
  // sees the same id twice and rejects with "Duplicate script ID". The
  // in-flight promise lock collapses concurrent callers onto one execution.
  assert.match(fn, /_syncUserScriptsInFlight/);
  assert.match(fn, /if \(_syncUserScriptsInFlight\) return _syncUserScriptsInFlight/);
});

test("syncUserScripts logs registration and skip counts to console", () => {
  assert.match(fn, /registering", registrations\.length/);
  assert.match(fn, /skipped:", skipped/);
});

test("configureUserScriptsWorld enables messaging in USER_SCRIPT world", () => {
  const cw = bg.match(/async function configureUserScriptsWorld\([\s\S]*?\n\}/);
  assert.ok(cw);
  assert.match(cw[0], /messaging:\s*true/);
});

test("writeScripts always calls syncUserScripts after persisting scripts array", () => {
  const ws = bg.match(/async function writeScripts\([\s\S]*?\n\}/);
  assert.match(ws[0], /await syncUserScripts\(\)/);
});

test("initUserscripts wires navigation logger even when sync returns error", () => {
  const init = bg.match(/async function initUserscripts\([\s\S]*?\n\}/);
  assert.match(init[0], /enableNavigationLogger\(\)/);
});

test("syncUserScripts clears userScripts.error after successful unregister", () => {
  assert.match(fn, /await chrome\.storage\.local\.remove\("userScripts\.error"\)/);
});
