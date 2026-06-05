// Single-tab command helpers — getActive, withActive, duplicate, pin, mute, move.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

function fnBody(name) {
  const start = bg.indexOf(`async function ${name}`);
  assert.ok(start >= 0, `${name} not found`);
  const next = bg.indexOf("\nasync function ", start + 1);
  const end = next >= 0 ? next : bg.length;
  return bg.slice(start, end);
}

test("getActive queries active tab in last focused window", () => {
  const fn = fnBody("getActive");
  assert.match(fn, /chrome\.tabs\.query\(\{ active: true, lastFocusedWindow: true \}\)/);
  assert.match(fn, /return t/);
});

test("withActive no-ops when getActive returns undefined", () => {
  const fn = fnBody("withActive");
  assert.match(fn, /if \(t\) return fn\(t\)/);
});

test("dispatch duplicate-tab calls chrome.tabs.duplicate on active tab", () => {
  assert.match(bg, /command === "duplicate-tab"\)[\s\S]*?chrome\.tabs\.duplicate\(t\.id\)/);
});

test("dispatch pin-tab toggles pinned boolean on active tab", () => {
  assert.match(bg, /command === "pin-tab"\)[\s\S]*?pinned: !t\.pinned/);
});

test("dispatch mute-tab toggles mutedInfo.muted on active tab", () => {
  assert.match(bg, /command === "mute-tab"\)[\s\S]*?muted: !t\.mutedInfo\?\.muted/);
});

test("dispatch move-to-new-window detaches active tab to new window", () => {
  assert.match(bg, /command === "move-to-new-window"\)[\s\S]*?chrome\.windows\.create\(\{ tabId: t\.id \}\)/);
});

test("dispatch copy-url routes to copyActiveUrl", () => {
  assert.match(bg, /command === "copy-url"\)[\s\S]*?copyActiveUrl\(\)/);
});

test("dispatch copy-title-md routes to copyActiveTitleMd", () => {
  assert.match(bg, /command === "copy-title-md"\)[\s\S]*?copyActiveTitleMd\(\)/);
});

test("dispatch bookmark-tab routes to bookmarkActive", () => {
  assert.match(bg, /command === "bookmark-tab"\)[\s\S]*?bookmarkActive\(\)/);
});

test("dispatch search-tabs opens action popup", () => {
  assert.match(bg, /command === "search-tabs"\)[\s\S]*?chrome\.action\.openPopup\(\)/);
});

test("dispatch restore-last-closed routes to restoreLastClosed", () => {
  assert.match(bg, /command === "restore-last-closed"\)[\s\S]*?restoreLastClosed\(\)/);
});

test("dispatch manage-scripts routes to openScriptsManager", () => {
  assert.match(bg, /command === "manage-scripts"\)[\s\S]*?openScriptsManager\(\)/);
});

test("dispatch open-history routes to openHistoryInPopup", () => {
  assert.match(bg, /command === "open-history"\)[\s\S]*?openHistoryInPopup\(\)/);
});

test("dispatch no longer handles kill-heaviest (chrome.processes removed)", () => {
  assert.doesNotMatch(bg, /command === "kill-heaviest"/);
  assert.doesNotMatch(bg, /killHeaviestTab/);
});

test("copyActiveUrl only writes when tab has a url", () => {
  const fn = fnBody("copyActiveUrl");
  assert.match(fn, /if \(t\?\.url\) await writeClipboard\(t\.url\)/);
});

test("copyActiveTitleMd falls back to url when title is empty", () => {
  const fn = fnBody("copyActiveTitleMd");
  assert.match(fn, /t\.title \|\| t\.url/);
});

test("bookmarkActive skips when url is missing", () => {
  const fn = fnBody("bookmarkActive");
  assert.match(fn, /if \(!t\?\.url\) return/);
});

test("openHistoryInPopup swallows openPopup rejection", () => {
  const fn = fnBody("openHistoryInPopup");
  assert.match(fn, /openPopup\(\)\.catch\(\(\) => \{\}\)/);
});

test("openScriptsManager opens manager.html via runtime.getURL", () => {
  const fn = fnBody("openScriptsManager");
  assert.match(fn, /getURL\("scripts-manager\/manager\.html"\)/);
});
