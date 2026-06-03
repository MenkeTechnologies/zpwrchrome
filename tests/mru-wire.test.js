// MRU stack wiring in background.js — cross-window tab switching primitive.

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

test("readMru falls back to empty array when session key is missing", () => {
  const fn = fnBody("readMru");
  assert.match(fn, /Array\.isArray\(mru\) \? mru : \[\]/);
});

test("writeMru caps stored list at MRU_CAP_DEFAULT", () => {
  const fn = fnBody("writeMru");
  assert.match(fn, /mru\.slice\(0, MRU_CAP_DEFAULT\)/);
});

test("pushMru reads, mruPush-es, then writeMru-s", () => {
  const fn = fnBody("pushMru");
  assert.match(fn, /mruPush\(await readMru\(\), tabId\)/);
  assert.match(fn, /await writeMru\(next\)/);
});

test("dropFromMru skips write when tab id was not in the stack", () => {
  const fn = fnBody("dropFromMru");
  assert.match(fn, /mruDrop\(mru, tabId\)/);
  assert.match(fn, /if \(next\.length !== mru\.length\) await writeMru\(next\)/);
});

test("switchPreviousTab walks the MRU + activates cross-window when needed", () => {
  // Post-fix the iteration replaces the single-shot mruPrevious lookup so
  // the SW can self-heal stale MRU heads. Pin the loop + the focus call.
  const fn = fnBody("switchPreviousTab");
  assert.match(fn, /await readMru\(\)/);
  assert.match(fn, /for \(const id of mru\)/);
  assert.match(fn, /tab\.windowId !== active\?\.windowId/);
  assert.match(fn, /chrome\.windows\.update\(tab\.windowId, \{ focused: true \}\)/);
});

test("switchPreviousTab drops stale MRU entries inside the iteration catch", () => {
  const fn = fnBody("switchPreviousTab");
  assert.match(fn, /catch \{\s*await dropFromMru\(id\)/);
});

test("mruStep uses mruStepPure and focuses foreign windows", () => {
  const fn = fnBody("mruStep");
  assert.match(fn, /mruStepPure\(mru, active\?\.id, delta\)/);
  assert.match(fn, /tab\.windowId !== active\?\.windowId/);
});

test("mruStep drops stale entries on tab.get failure (then refreshes MRU + retries)", () => {
  const fn = fnBody("mruStep");
  assert.match(fn, /catch \{\s*await dropFromMru\(next\)/);
  assert.match(fn, /mru = await readMru\(\)/);
});

test("mruStep returns early when next equals current tab", () => {
  const fn = fnBody("mruStep");
  assert.match(fn, /next === active\?\.id\) return/);
});

test("seedMru puts active tabs before inactive tabs on startup", () => {
  const fn = fnBody("seedMru");
  assert.match(fn, /tabs\.filter\(\(t\) => t\.active\)/);
  assert.match(fn, /tabs\.filter\(\(t\) => !t\.active\)/);
  assert.match(fn, /\[\.\.\.active, \.\.\.rest\]/);
});

test("seedMru is registered on onInstalled and onStartup", () => {
  assert.match(bg, /chrome\.runtime\.onInstalled\.addListener\(seedMru\)/);
  assert.match(bg, /chrome\.runtime\.onStartup\.addListener\(seedMru\)/);
});

test("tabs.onReplaced migrates MRU from removed tab id to added tab id", () => {
  assert.match(bg, /chrome\.tabs\.onReplaced\.addListener/);
  assert.match(bg, /dropFromMru\(removed\)\.then\(\(\) => pushMru\(added\)\)/);
});

test("list handler preserves MRU order for tabs still open", () => {
  const idx = bg.indexOf('msg?.kind === "list"');
  assert.ok(idx >= 0);
  const sec = bg.slice(idx, idx + 600);
  assert.match(sec, /mruTabs = mru\.map/);
});

test("MRU_CAP_DEFAULT is imported from lib/util.js (single source of truth)", () => {
  assert.match(bg, /import[\s\S]+MRU_CAP_DEFAULT[\s\S]+from "\.\/lib\/util\.js"/);
});

test("background.js imports mruDrop alongside mruPush", () => {
  assert.match(bg, /import[\s\S]+mruDrop[\s\S]+from "\.\/lib\/util\.js"/);
});

test("switch-previous-tab command maps to switchPreviousTab()", () => {
  assert.match(bg, /command === "switch-previous-tab"\)[\s\S]*?switchPreviousTab\(\)/);
});

test("mru-next and mru-prev map to mruStep with opposite deltas", () => {
  assert.match(bg, /command === "mru-next"\)[\s\S]*?mruStep\(\+1\)/);
  assert.match(bg, /command === "mru-prev"\)[\s\S]*?mruStep\(-1\)/);
});

test("MRU lives in chrome.storage.session (not local — survives SW restarts within session)", () => {
  assert.match(bg, /chrome\.storage\.session\.get\(MRU_KEY\)/);
  assert.match(bg, /chrome\.storage\.session\.set/);
  assert.ok(!/chrome\.storage\.local\.set\(\{\s*\[MRU_KEY\]/m.test(bg),
    "MRU must not be persisted to local storage");
});
