// GM.* background handlers not covered by scripts-save.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

function sliceHandler(kind, len = 600) {
  const marker = `msg?.kind === "${kind}"`;
  const idx = bg.indexOf(marker);
  assert.ok(idx >= 0, `handler for "${kind}" not found`);
  return bg.slice(idx, idx + len);
}

test("gm:getValue reads per-script map from chrome.storage.local", () => {
  const sec = sliceHandler("gm:getValue", 500);
  assert.match(sec, /const map = bag\[GM_PREFIX \+ msg\.script\] \|\| \{\}/);
  assert.match(sec, /value: map\[msg\.key\]/);
});

test("gm:setValue merges key into per-script map then persists", () => {
  const sec = sliceHandler("gm:setValue", 600);
  assert.match(sec, /map\[msg\.key\] = msg\.value/);
  assert.match(sec, /await chrome\.storage\.local\.set\(\{ \[key\]: map \}\)/);
});

test("gm:setClipboard delegates to writeClipboard helper", () => {
  const sec = sliceHandler("gm:setClipboard", 400);
  assert.match(sec, /writeClipboard\(msg\.text\)/);
});

test("gm:openInTab creates tab with active flag from msg.active", () => {
  const sec = sliceHandler("gm:openInTab", 400);
  assert.match(sec, /chrome\.tabs\.create\(\{\s*url: msg\.url,\s*active: !!msg\.active\s*\}/);
});

test("gm:openInTab returns tabId in response", () => {
  const sec = sliceHandler("gm:openInTab", 400);
  assert.match(sec, /tabId: t\.id/);
});

test("gm:fire appendFireLog uses native mode label", () => {
  const sec = sliceHandler("gm:fire", 600);
  assert.match(sec, /mode:\s*"native"/);
});

test("gm:fire catches appendFireLog rejection and responds ok:false", () => {
  const sec = sliceHandler("gm:fire", 600);
  assert.match(sec, /\.catch\(\(\) => sendResponse\(\{ ok: false \}\)\)/);
});

test("gm:notification uses extension icon128 when notifications API exists", () => {
  const sec = sliceHandler("gm:notification", 600);
  assert.match(sec, /if \(chrome\.notifications\)/);
  assert.match(sec, /iconUrl: chrome\.runtime\.getURL\("icons\/icon128\.png"\)/);
});

test("gm:notification defaults title when msg.title is missing", () => {
  const sec = sliceHandler("gm:notification", 600);
  assert.match(sec, /title: msg\.title \|\| "zpwrchrome userscript"/);
});

test("gm:notification returns ok:false when notifications API unavailable", () => {
  const sec = sliceHandler("gm:notification", 600);
  assert.match(sec, /else \{[\s\S]*?sendResponse\(\{ ok: false \}\)/);
});

test("gm:deleteValue removes key then writes map back", () => {
  const sec = sliceHandler("gm:deleteValue", 600);
  assert.match(sec, /delete map\[msg\.key\]/);
});

test("gm:listValues responds with ok:true and keys array", () => {
  const sec = sliceHandler("gm:listValues", 500);
  assert.match(sec, /sendResponse\(\{ ok: true, keys: Object\.keys\(map\) \}\)/);
});

test("scripts.delete removes GM_PREFIX storage namespace for script id", () => {
  const sec = sliceHandler("scripts.delete", 600);
  assert.match(sec, /chrome\.storage\.local\.remove\(GM_PREFIX \+ msg\.id\)/);
});

test("GM_PREFIX constant namespaces per-script GM storage", () => {
  assert.match(bg, /const GM_PREFIX = "gm:"/);
});

test("gm handlers return true to keep sendResponse channel open", () => {
  for (const kind of ["gm:getValue", "gm:setValue", "gm:setClipboard", "gm:openInTab"]) {
    const idx = bg.indexOf(`msg?.kind === "${kind}"`);
    const tail = bg.slice(idx, idx + 800);
    assert.match(tail, /return true/, `${kind} must return true for async sendResponse`);
  }
});
