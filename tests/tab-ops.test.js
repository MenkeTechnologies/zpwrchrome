// Tab batch-operation invariants in background.js dispatch helpers.

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

test("closeOthers spares the active tab and pinned tabs", () => {
  const fn = fnBody("closeOthers");
  assert.match(fn, /!t\.active && !t\.pinned/);
  assert.match(fn, /chrome\.tabs\.remove\(victims\)/);
});

test("closeOthers queries only the current window", () => {
  const fn = fnBody("closeOthers");
  assert.match(fn, /chrome\.tabs\.query\(\{ currentWindow: true \}\)/);
});

test("closeRight removes tabs with index greater than active (pinned spared)", () => {
  const fn = fnBody("closeRight");
  assert.match(fn, /t\.index > active\.index && !t\.pinned/);
});

test("closeRight is a no-op when no active tab exists", () => {
  const fn = fnBody("closeRight");
  assert.match(fn, /if \(!active\) return/);
});

test("closeDuplicates keeps the leftmost tab for each URL", () => {
  const fn = fnBody("closeDuplicates");
  assert.match(fn, /if \(seen\.has\(t\.url\)\) victims\.push/);
  assert.match(fn, /else seen\.add\(t\.url\)/);
});

test("closeDuplicates never closes pinned tabs", () => {
  const fn = fnBody("closeDuplicates");
  assert.match(fn, /if \(t\.pinned\) continue/);
});

test("reloadAll reloads every tab in the current window", () => {
  const fn = fnBody("reloadAll");
  assert.match(fn, /chrome\.tabs\.query\(\{ currentWindow: true \}\)/);
  assert.match(fn, /chrome\.tabs\.reload\(t\.id\)/);
});

test("sortByUrl sorts unpinned tabs by URL via localeCompare", () => {
  const fn = fnBody("sortByUrl");
  assert.match(fn, /pinned: false/);
  assert.match(fn, /localeCompare/);
  assert.match(fn, /chrome\.tabs\.move/);
});

test("sortByUrl packs sorted tabs starting at the minimum original index", () => {
  const fn = fnBody("sortByUrl");
  assert.match(fn, /tabs\.reduce\(\(m, t\) => Math\.min\(m, t\.index\)/);
  assert.match(fn, /index: base \+ i/);
});

test("groupByDomain skips hosts with fewer than two tabs", () => {
  const fn = fnBody("groupByDomain");
  assert.match(fn, /if \(ids\.length < 2\) continue/);
});

test("groupByDomain names groups after hostnameOf(url)", () => {
  const fn = fnBody("groupByDomain");
  assert.match(fn, /const h = hostnameOf\(t\.url\)/);
  assert.match(fn, /title: host/);
});

test("groupByDomain guards when tabGroups API is unavailable", () => {
  const fn = fnBody("groupByDomain");
  assert.match(fn, /if \(!chrome\.tabs\.group \|\| !chrome\.tabGroups\) return/);
});

test("writeClipboard injects navigator.clipboard.writeText into the active tab", () => {
  const fn = fnBody("writeClipboard");
  assert.match(fn, /chrome\.scripting\.executeScript/);
  assert.match(fn, /navigator\.clipboard\.writeText\(s\)/);
});

test("writeClipboard swallows injection failures on protected pages", () => {
  const fn = fnBody("writeClipboard");
  assert.match(fn, /catch \{/);
});

test("copyActiveTitleMd formats markdown [title](url)", () => {
  const fn = fnBody("copyActiveTitleMd");
  assert.match(fn, /`\[\$\{t\.title \|\| t\.url\}\]\(\$\{t\.url\}\)`/);
});

test("bookmarkActive creates a bookmark with title and url", () => {
  const fn = fnBody("bookmarkActive");
  assert.match(fn, /chrome\.bookmarks\.create/);
  assert.match(fn, /title: t\.title \|\| t\.url, url: t\.url/);
});

test("restoreLastClosed restores tab or window session from getRecentlyClosed", () => {
  const fn = fnBody("restoreLastClosed");
  assert.match(fn, /getRecentlyClosed\(\{ maxResults: 1 \}\)/);
  assert.match(fn, /s\.tab\)[\s\S]*?chrome\.sessions\.restore\(s\.tab\.sessionId\)/);
  assert.match(fn, /s\.window\)[\s\S]*?chrome\.sessions\.restore\(s\.window\.sessionId\)/);
});

test("jumpTo activates tab by index in the current window only", () => {
  const fn = fnBody("jumpTo");
  assert.match(fn, /chrome\.tabs\.query\(\{ currentWindow: true \}\)/);
  assert.match(fn, /resolveJumpIndex\(command, tabs\.length\)/);
  assert.match(fn, /chrome\.tabs\.update\(tabs\[idx\]\.id, \{ active: true \}\)/);
});

test("openRecentModal uses chrome.action.openPopup (not content-script injection)", () => {
  const fn = fnBody("openRecentModal");
  assert.match(fn, /chrome\.action\.openPopup/);
  assert.ok(!/executeScript/.test(fn), "must not inject modal into page");
});

test("withActive bails when no active tab is found", () => {
  const fn = fnBody("withActive");
  assert.match(fn, /if \(t\) return fn\(t\)/);
});

test("getActive queries active:true on the last-focused window", () => {
  const fn = fnBody("getActive");
  assert.match(fn, /active: true, lastFocusedWindow: true/);
});

test("duplicate-tab command uses withActive + chrome.tabs.duplicate", () => {
  assert.match(bg, /command === "duplicate-tab"\)[\s\S]*?chrome\.tabs\.duplicate\(t\.id\)/);
});

test("pin-tab command toggles pinned on the active tab", () => {
  assert.match(bg, /command === "pin-tab"\)[\s\S]*?pinned: !t\.pinned/);
});

test("mute-tab command toggles muted on the active tab", () => {
  assert.match(bg, /command === "mute-tab"\)[\s\S]*?muted: !t\.mutedInfo\?\.muted/);
});

test("move-to-new-window detaches the active tab into a new window", () => {
  assert.match(bg, /command === "move-to-new-window"\)[\s\S]*?chrome\.windows\.create\(\{ tabId: t\.id \}\)/);
});

test("save-scene-prompt opens the popup (same anchor as other scene UX)", () => {
  assert.match(bg, /command === "save-scene-prompt"\)[\s\S]*?chrome\.action\.openPopup/);
});

test("search-tabs opens the popup for live filter focus", () => {
  assert.match(bg, /command === "search-tabs"\)[\s\S]*?chrome\.action\.openPopup/);
});

test("gm:notification uses chrome.notifications with extension icon", () => {
  const idx = bg.indexOf('msg?.kind === "gm:notification"');
  assert.ok(idx >= 0);
  const sec = bg.slice(idx, idx + 400);
  assert.match(sec, /chrome\.notifications\.create/);
  assert.match(sec, /icons\/icon128\.png/);
});

test("scripts.firelog.clear resets the ring buffer key to empty array", () => {
  const idx = bg.indexOf('msg?.kind === "scripts.firelog.clear"');
  assert.ok(idx >= 0);
  assert.match(bg.slice(idx, idx + 200), /FIRE_LOG_KEY\]: \[\]/);
});
