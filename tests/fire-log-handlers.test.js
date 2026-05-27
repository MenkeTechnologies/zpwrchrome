// scripts.firelog and scripts.firelog.clear handlers in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

function sliceHandler(kind, len = 500) {
  const marker = `msg?.kind === "${kind}"`;
  const idx = bg.indexOf(marker);
  assert.ok(idx >= 0, `${kind} missing`);
  return bg.slice(idx, idx + len);
}

test("scripts.firelog reads log from chrome.storage.local FIRE_LOG_KEY", () => {
  const sec = sliceHandler("scripts.firelog");
  assert.match(sec, /chrome\.storage\.local\.get\(FIRE_LOG_KEY\)/);
});

test("scripts.firelog responds with ok true and log array", () => {
  const sec = sliceHandler("scripts.firelog");
  assert.match(sec, /sendResponse\(\{ ok: true, log: bag\[FIRE_LOG_KEY\] \|\| \[\] \}\)/);
});

test("scripts.firelog.clear sets empty array under FIRE_LOG_KEY", () => {
  const sec = sliceHandler("scripts.firelog.clear");
  assert.match(sec, /chrome\.storage\.local\.set\(\{ \[FIRE_LOG_KEY\]: \[\] \}\)/);
});

test("scripts.firelog.clear responds ok true", () => {
  const sec = sliceHandler("scripts.firelog.clear");
  assert.match(sec, /sendResponse\(\{ ok: true \}\)/);
});

test("appendFireLog prepends entry with unshift", () => {
  const fn = bg.match(/async function appendFireLog\([\s\S]*?\n\}/);
  assert.match(fn[0], /log\.unshift\(final\)/);
});

test("appendFireLog stamps when from entry or Date.now default", () => {
  const fn = bg.match(/async function appendFireLog\([\s\S]*?\n\}/);
  assert.match(fn[0], /when: Date\.now\(\), \.\.\.entry/);
});

test("appendFireLog truncates log length to FIRE_LOG_CAP in place", () => {
  const fn = bg.match(/async function appendFireLog\([\s\S]*?\n\}/);
  assert.match(fn[0], /if \(log\.length > FIRE_LOG_CAP\) log\.length = FIRE_LOG_CAP/);
});

test("appendFireLog logs mode name and url to console.info", () => {
  const fn = bg.match(/async function appendFireLog\([\s\S]*?\n\}/);
  assert.match(fn[0], /console\.info\("\[zpwrchrome\] fire logged:", final\.mode, final\.name \|\| final\.script/);
});

test("gm:fire handler passes tabId from sender tab", () => {
  const sec = sliceHandler("gm:fire", 700);
  assert.match(sec, /tabId:\s*_sender\?\.tab\?\.id \?\? null/);
});

test("gm:fire handler passes frameId from sender", () => {
  const sec = sliceHandler("gm:fire", 700);
  assert.match(sec, /frame:\s*_sender\?\.frameId \?\? 0/);
});

test("handleNav appendFireLog includes phase in log entry", () => {
  const fn = bg.match(/async function handleNav\([\s\S]*?\n\}/);
  assert.match(fn[0], /phase/);
});

test("FIRE_LOG_CAP is 200 entries", () => {
  assert.match(bg, /const FIRE_LOG_CAP = 200/);
});
