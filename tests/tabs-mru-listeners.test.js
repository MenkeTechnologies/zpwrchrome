// chrome.tabs MRU listener wiring in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

test("tabs.onActivated pushes activated tab id to MRU", () => {
  assert.match(bg, /chrome\.tabs\.onActivated\.addListener\(\(\{ tabId \}\) => \{ pushMru\(tabId\); \}\)/);
});

test("tabs.onRemoved drops closed tab id from MRU", () => {
  assert.match(bg, /chrome\.tabs\.onRemoved\.addListener\(\(tabId\) => \{ dropFromMru\(tabId\); \}\)/);
});

test("tabs.onReplaced drops old tab then pushes replacement tab", () => {
  assert.match(bg, /chrome\.tabs\.onReplaced\.addListener\(\(added, removed\) => \{/);
  assert.match(bg, /dropFromMru\(removed\)\.then\(\(\) => pushMru\(added\)\)/);
});

test("readMru uses chrome.storage.session not local", () => {
  const fn = bg.match(/async function readMru\([\s\S]*?\n\}/);
  assert.match(fn[0], /chrome\.storage\.session\.get\(MRU_KEY\)/);
});

test("writeMru persists to chrome.storage.session", () => {
  const fn = bg.match(/async function writeMru\([\s\S]*?\n\}/);
  assert.match(fn[0], /chrome\.storage\.session\.set\(\{ \[MRU_KEY\]: mru\.slice\(0, MRU_CAP_DEFAULT\) \}\)/);
});

test("MRU_KEY constant is mru in session storage", () => {
  assert.match(bg, /const MRU_KEY = "mru"/);
});

test("seedMru writes active tabs before inactive tabs on startup", () => {
  const fn = bg.match(/async function seedMru\([\s\S]*?\n\}/);
  assert.match(fn[0], /const active = tabs\.filter\(\(t\) => t\.active\)/);
  assert.match(fn[0], /await writeMru\(\[\.\.\.active, \.\.\.rest\]\)/);
});

test("seedMru queries all tabs across all windows", () => {
  const fn = bg.match(/async function seedMru\([\s\S]*?\n\}/);
  assert.match(fn[0], /chrome\.tabs\.query\(\{\}\)/);
});

test("pushMru uses mruPush from lib/util.js with default cap", () => {
  const fn = bg.match(/async function pushMru\([\s\S]*?\n\}/);
  assert.match(fn[0], /mruPush\(await readMru\(\), tabId\)/);
});

test("dropFromMru uses mruDrop and skips write when unchanged", () => {
  const fn = bg.match(/async function dropFromMru\([\s\S]*?\n\}/);
  assert.match(fn[0], /mruDrop\(mru, tabId\)/);
  assert.match(fn[0], /if \(next\.length !== mru\.length\) await writeMru\(next\)/);
});

test("background imports MRU_CAP_DEFAULT from lib/util.js", () => {
  assert.match(bg, /MRU_CAP_DEFAULT/);
  assert.match(bg, /from "\.\/lib\/util\.js"/);
});

test("commands.onCommand catches dispatch errors and logs command name", () => {
  assert.match(bg, /chrome\.commands\.onCommand\.addListener\(async \(command\) => \{/);
  assert.match(bg, /catch \(e\) \{ console\.error\("\[zpwrchrome\]", command, e\); \}/);
});
