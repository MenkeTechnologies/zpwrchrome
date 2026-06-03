// MRU session storage and tab lifecycle wiring in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

function fnBody(name) {
  const m = bg.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} not found`);
  return m[0];
}

test("MRU_KEY is stored in chrome.storage.session not local", () => {
  assert.match(bg, /const MRU_KEY = "mru"/);
  assert.match(bg, /chrome\.storage\.session\.get\(MRU_KEY\)/);
  assert.match(bg, /chrome\.storage\.session\.set\(\{\s*\[MRU_KEY\]/);
});

test("readMru returns empty array when storage value is missing", () => {
  const fn = fnBody("readMru");
  assert.match(fn, /return Array\.isArray\(mru\) \? mru : \[\]/);
});

test("writeMru caps stored list at MRU_CAP_DEFAULT", () => {
  const fn = fnBody("writeMru");
  assert.match(fn, /mru\.slice\(0, MRU_CAP_DEFAULT\)/);
});

test("pushMru delegates to mruPush then writeMru", () => {
  const fn = fnBody("pushMru");
  assert.match(fn, /mruPush\(await readMru\(\), tabId\)/);
  assert.match(fn, /await writeMru\(next\)/);
});

test("dropFromMru skips write when id was not in stack", () => {
  const fn = fnBody("dropFromMru");
  assert.match(fn, /mruDrop\(mru, tabId\)/);
  assert.match(fn, /if \(next\.length !== mru\.length\) await writeMru\(next\)/);
});

test("tabs.onActivated listener calls pushMru with tabId", () => {
  assert.match(bg, /chrome\.tabs\.onActivated\.addListener\(\(\{\s*tabId\s*\}\)\s*=>\s*\{\s*pushMru\(tabId\)/);
});

test("tabs.onRemoved listener calls dropFromMru with tabId", () => {
  assert.match(bg, /chrome\.tabs\.onRemoved\.addListener\(\(tabId\)\s*=>\s*\{\s*dropFromMru\(tabId\)/);
});

test("tabs.onReplaced drops old id then pushes new id", () => {
  assert.match(bg, /chrome\.tabs\.onReplaced\.addListener\(\(added, removed\)/);
  assert.match(bg, /dropFromMru\(removed\)\.then\(\(\) => pushMru\(added\)\)/);
});

test("seedMru orders active tabs before inactive tabs", () => {
  const fn = fnBody("seedMru");
  assert.match(fn, /tabs\.filter\(\(t\) => t\.active\)/);
  assert.match(fn, /tabs\.filter\(\(t\) => !t\.active\)/);
  assert.match(fn, /await writeMru\(\[\.\.\.active, \.\.\.rest\]\)/);
});

test("seedMru queries all open tabs across windows", () => {
  const fn = fnBody("seedMru");
  assert.match(fn, /chrome\.tabs\.query\(\{\}\)/);
});

test("seedMru runs on extension install and browser startup", () => {
  assert.match(bg, /chrome\.runtime\.onInstalled\.addListener\(seedMru\)/);
  assert.match(bg, /chrome\.runtime\.onStartup\.addListener\(seedMru\)/);
});

test("background.js imports MRU_CAP_DEFAULT from lib/util.js", () => {
  assert.match(bg, /import[\s\S]+MRU_CAP_DEFAULT[\s\S]+from "\.\/lib\/util\.js"/);
});

test("switchPreviousTab drops stale MRU entry when tab.get throws (in-loop)", () => {
  // After the Cmd+E flake fix, the catch lives inside the for…of loop and
  // drops by `id` (the loop variable), not by `prev`.
  const fn = fnBody("switchPreviousTab");
  assert.match(fn, /catch \{\s*await dropFromMru\(id\)/);
});

test("mruStep drops stale MRU entry when tab.get throws (in-loop, then refreshes)", () => {
  // Same fix on the cycle path: drop + re-read mru + iterate.
  const fn = fnBody("mruStep");
  assert.match(fn, /catch \{\s*await dropFromMru\(next\)/);
  assert.match(fn, /mru = await readMru\(\)/);
});

test("mruStep returns early when computed next equals active tab", () => {
  const fn = fnBody("mruStep");
  assert.match(fn, /if \(typeof next !== "number" \|\| next === active\?\.id\) return/);
});

test("switchPreviousTab focuses foreign window when previous tab lives elsewhere", () => {
  const fn = fnBody("switchPreviousTab");
  assert.match(fn, /if \(tab\.windowId !== active\?\.windowId\)/);
  assert.match(fn, /chrome\.windows\.update\(tab\.windowId, \{ focused: true \}\)/);
});
