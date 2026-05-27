// Userscript manager save/delete/toggle handler invariants in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

function sliceHandler(kind, len = 3500) {
  const marker = `msg?.kind === "${kind}"`;
  const idx = bg.indexOf(marker);
  assert.ok(idx >= 0, `handler for "${kind}" not found`);
  return bg.slice(idx, idx + len);
}

test("scripts.save rejects invalid metadata before touching storage", () => {
  const sec = sliceHandler("scripts.save", 1200);
  assert.match(sec, /const errors = validateUserscript\(meta\)/);
  assert.match(sec, /if \(errors\.length\) \{ sendResponse\(\{ ok: false, errors \}\); return; \}/);
});

test("scripts.save assigns userscriptId when incoming.id is missing", () => {
  const sec = sliceHandler("scripts.save", 1200);
  assert.match(sec, /incoming\.id = incoming\.id \|\| userscriptId\(meta\)/);
});

test("scripts.save copies @name from parsed metadata onto incoming record", () => {
  const sec = sliceHandler("scripts.save", 1200);
  assert.match(sec, /incoming\.name = meta\.name/);
});

test("scripts.save stamps updatedAt on every write", () => {
  const sec = sliceHandler("scripts.save", 1200);
  assert.match(sec, /incoming\.updatedAt = Date\.now\(\)/);
});

test("scripts.save new script rejects duplicate id collision", () => {
  const sec = sliceHandler("scripts.save", 1200);
  assert.match(sec, /if \(isNew\) \{[\s\S]*?const idCollide\s+= all\.find\(\(s\) => s\.id === incoming\.id\)/);
});

test("scripts.save new script rejects duplicate name collision (case-insensitive)", () => {
  const sec = sliceHandler("scripts.save", 1200);
  assert.match(sec, /const nameLc = \(incoming\.name \|\| ""\)\.toLowerCase\(\)/);
  assert.match(sec, /nameCollide = all\.find\(\(s\) => \(s\.name \|\| ""\)\.toLowerCase\(\) === nameLc\)/);
});

test("scripts.save new collision error names the existing script id", () => {
  const sec = sliceHandler("scripts.save", 1200);
  assert.match(sec, /already exists \(id \$\{existing\.id\}\)/);
});

test("scripts.save update path refuses rename collision with a different script", () => {
  const sec = sliceHandler("scripts.save", 3500);
  assert.match(sec, /s\.id !== incoming\.id && \(s\.name \|\| ""\)\.toLowerCase\(\) === nameLc/);
});

test("scripts.save update merges into existing index when id matches", () => {
  const sec = sliceHandler("scripts.save", 3500);
  assert.match(sec, /all\[idx\] = \{ \.\.\.all\[idx\], \.\.\.incoming \}/);
});

test("scripts.save defaults enabled=true for brand-new scripts", () => {
  const sec = sliceHandler("scripts.save", 3500);
  assert.match(sec, /incoming\.enabled = incoming\.enabled !== false/);
});

test("scripts.save calls writeScripts which triggers syncUserScripts", () => {
  const sec = sliceHandler("scripts.save", 3500);
  assert.match(sec, /await writeScripts\(all\)/);
  assert.match(bg, /async function writeScripts\([\s\S]*?await syncUserScripts\(\)/);
});

test("scripts.delete removes GM storage namespace for the script id", () => {
  const sec = sliceHandler("scripts.delete", 500);
  assert.match(sec, /chrome\.storage\.local\.remove\(GM_PREFIX \+ msg\.id\)/);
});

test("scripts.list derives native mode from live chrome.userScripts API", () => {
  const sec = sliceHandler("scripts.list", 800);
  assert.match(sec, /const native = !!chrome\.userScripts/);
  assert.match(sec, /mode: native \? "native" : "fallback"/);
});

test("scripts.list clears stored error when native API is available", () => {
  const sec = sliceHandler("scripts.list", 800);
  assert.match(sec, /error: native \? null : \(meta\["userScripts\.error"\] \|\| null\)/);
});

test("scripts.list returns lastSync metadata from storage", () => {
  const sec = sliceHandler("scripts.list", 800);
  assert.match(sec, /lastSync: meta\["userScripts\.lastSync"\] \|\| null/);
});

test("scripts.resync delegates to syncUserScripts", () => {
  const sec = sliceHandler("scripts.resync", 300);
  assert.match(sec, /syncUserScripts\(\)\.then\(\(r\) => sendResponse\(\{ ok: true, \.\.\.r \}\)\)/);
});

test("scripts.firelog reads FIRE_LOG_KEY from local storage", () => {
  const sec = sliceHandler("scripts.firelog", 300);
  assert.match(sec, /chrome\.storage\.local\.get\(FIRE_LOG_KEY\)/);
  assert.match(bg, /const FIRE_LOG_KEY = "userScripts\.fireLog"/);
});

test("scripts.firelog.clear resets log to empty array", () => {
  const sec = sliceHandler("scripts.firelog.clear", 300);
  assert.match(sec, /chrome\.storage\.local\.set\(\{\s*\[FIRE_LOG_KEY\]: \[\]\s*\}\)/);
});

test("SCRIPTS_KEY and GM_PREFIX are defined for storage namespacing", () => {
  assert.match(bg, /const SCRIPTS_KEY = "userscripts"/);
  assert.match(bg, /const GM_PREFIX = "gm:"/);
});

test("gm:deleteValue removes key from per-script map before set", () => {
  const sec = sliceHandler("gm:deleteValue", 500);
  assert.match(sec, /delete map\[msg\.key\]/);
  assert.match(sec, /await chrome\.storage\.local\.set\(\{ \[key\]: map \}\)/);
});

test("gm:listValues returns Object.keys of the per-script map", () => {
  const sec = sliceHandler("gm:listValues", 400);
  assert.match(sec, /keys: Object\.keys\(map\)/);
});

test("gm:fire handler records sender tabId and frameId", () => {
  const sec = sliceHandler("gm:fire", 500);
  assert.match(sec, /tabId:\s*_sender\?\.tab\?\.id/);
  assert.match(sec, /frame:\s*_sender\?\.frameId/);
});
