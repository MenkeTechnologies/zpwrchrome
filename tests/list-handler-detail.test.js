// list handler MRU merge and activate/restore focus behavior in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

function sliceHandler(kind, len = 700) {
  const marker = `msg?.kind === "${kind}"`;
  const idx = bg.indexOf(marker);
  assert.ok(idx >= 0, `${kind} handler missing`);
  return bg.slice(idx, idx + len);
}

test("list handler builds tab lookup Map keyed by tab id", () => {
  const sec = sliceHandler("list");
  assert.match(sec, /const byId = new Map\(tabs\.map\(\(t\) => \[t\.id, t\]\)\)/);
});

test("list handler maps MRU id stack to live tab objects filtering stale ids", () => {
  const sec = sliceHandler("list");
  assert.match(sec, /const mruTabs = mru\.map\(\(id\) => byId\.get\(id\)\)\.filter\(Boolean\)/);
});

test("list handler tracks seen tab ids to avoid duplicates when appending", () => {
  const sec = sliceHandler("list");
  assert.match(sec, /const seen = new Set\(mruTabs\.map\(\(t\) => t\.id\)\)/);
});

test("list handler appends open tabs not already in MRU ordering at end", () => {
  const sec = sliceHandler("list");
  assert.match(sec, /for \(const t of tabs\) if \(!seen\.has\(t\.id\)\) mruTabs\.push\(t\)/);
});

test("list handler passes closed sessions through without transformation", () => {
  const sec = sliceHandler("list");
  assert.match(sec, /sendResponse\(\{ mru: mruTabs, closed \}\)/);
});

test("list handler uses Promise.all for parallel IO", () => {
  const sec = sliceHandler("list");
  assert.match(sec, /Promise\.all\(\[readMru\(\), chrome\.tabs\.query\(\{\}\)/);
});

test("activate handler activates tab then focuses its window", () => {
  const sec = sliceHandler("activate", 500);
  assert.match(sec, /chrome\.tabs\.update\(msg\.tabId, \{ active: true \}\)/);
  assert.match(sec, /chrome\.windows\.update\(t\.windowId, \{ focused: true \}\)/);
});

test("activate handler returns ok true in sendResponse", () => {
  const sec = sliceHandler("activate", 500);
  assert.match(sec, /sendResponse\(\{ ok: true \}\)/);
});

test("restore handler calls chrome.sessions.restore with msg.sessionId", () => {
  const sec = sliceHandler("restore", 400);
  assert.match(sec, /chrome\.sessions\.restore\(msg\.sessionId\)/);
});

test("close-tab handler removes tab by msg.tabId", () => {
  const sec = sliceHandler("close-tab", 400);
  assert.match(sec, /chrome\.tabs\.remove\(msg\.tabId\)/);
});

test("open-scripts-manager opens manager via openScriptsManager helper", () => {
  const sec = sliceHandler("open-scripts-manager", 400);
  assert.match(sec, /openScriptsManager\(\)/);
});

test("openScriptsManager creates tab with extension manager.html URL", () => {
  const fn = bg.match(/async function openScriptsManager\([\s\S]*?\n\}/);
  assert.match(fn[0], /chrome\.runtime\.getURL\("scripts-manager\/manager\.html"\)/);
  assert.match(fn[0], /chrome\.tabs\.create\(\{ url \}\)/);
});
