// chrome.history wrapper handlers and list response shape in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

function sliceHandler(kind, len = 900) {
  const marker = `msg?.kind === "${kind}"`;
  const idx = bg.indexOf(marker);
  assert.ok(idx >= 0, `handler for "${kind}" not found`);
  return bg.slice(idx, idx + len);
}

test("history-list returns ok:false when chrome.history API is missing", () => {
  const sec = sliceHandler("history-list", 900);
  assert.match(sec, /if \(!chrome\.history\) \{ sendResponse\(\{ ok: false, history: \[\] \}\)/);
});

test("history-list uses empty text query for broadest candidate set", () => {
  const sec = sliceHandler("history-list", 900);
  assert.match(sec, /text: ""/);
});

test("history-list defaults maxResults to 5000 when msg omits it", () => {
  const sec = sliceHandler("history-list", 900);
  assert.match(sec, /maxResults: msg\.maxResults \|\| 5000/);
});

test("history-list sets startTime to 0 for full history sweep", () => {
  const sec = sliceHandler("history-list", 900);
  assert.match(sec, /startTime: 0/);
});

test("history-list attaches frecency field to each ranked row", () => {
  const sec = sliceHandler("history-list", 900);
  assert.match(sec, /frecency: frecencyScore\(h, now\)/);
});

test("history-list sorts ranked results by descending frecency", () => {
  const sec = sliceHandler("history-list", 900);
  assert.match(sec, /ranked\.sort\(\(a, b\) => b\.frecency - a\.frecency\)/);
});

test("history-list response includes ok:true and history array", () => {
  const sec = sliceHandler("history-list", 900);
  assert.match(sec, /sendResponse\(\{ ok: true, history: ranked \}\)/);
});

test("history-delete returns ok:false when chrome.history missing", () => {
  const sec = sliceHandler("history-delete", 400);
  assert.match(sec, /if \(!chrome\.history\) \{ sendResponse\(\{ ok: false \}\)/);
});

test("history-delete coerces msg.url to string before deleteUrl", () => {
  const sec = sliceHandler("history-delete", 400);
  assert.match(sec, /url: String\(msg\.url \|\| ""\)/);
});

test("history-delete uses callback form of chrome.history.deleteUrl", () => {
  const sec = sliceHandler("history-delete", 400);
  assert.match(sec, /chrome\.history\.deleteUrl\([\s\S]*?\(\) => sendResponse\(\{ ok: true \}\)/);
});

test("list handler fetches MRU, open tabs, and recently closed in parallel", () => {
  const sec = sliceHandler("list", 700);
  assert.match(sec, /Promise\.all\(\[readMru\(\), chrome\.tabs\.query/, "list must batch-fetch");
  assert.match(sec, /getRecentlyClosed\(\{ maxResults: 25 \}\)/);
});

test("list handler appends unseen open tabs after MRU-ordered tabs", () => {
  const sec = sliceHandler("list", 700);
  assert.match(sec, /for \(const t of tabs\) if \(!seen\.has\(t\.id\)\) mruTabs\.push\(t\)/);
});

test("list response shape is { mru, closed }", () => {
  const sec = sliceHandler("list", 700);
  assert.match(sec, /sendResponse\(\{ mru: mruTabs, closed \}\)/);
});

test("activate handler returns ok:true after focusing window", () => {
  const sec = sliceHandler("activate", 500);
  assert.match(sec, /sendResponse\(\{ ok: true \}\)/);
});

test("restore handler returns ok:true after sessions.restore", () => {
  const sec = sliceHandler("restore", 400);
  assert.match(sec, /sendResponse\(\{ ok: true \}\)/);
});

test("close-tab handler returns ok:true after tabs.remove", () => {
  const sec = sliceHandler("close-tab", 400);
  assert.match(sec, /sendResponse\(\{ ok: true \}\)/);
});

test("open-scripts-manager handler returns ok:true", () => {
  const sec = sliceHandler("open-scripts-manager", 400);
  assert.match(sec, /sendResponse\(\{ ok: true \}\)/);
});
