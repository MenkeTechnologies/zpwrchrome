// single-tab command dispatch via withActive in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

const dispatch = bg.match(/async function dispatch\(command\)[\s\S]*?\n\}/);
assert.ok(dispatch, "dispatch missing");

test("duplicate-tab command duplicates active tab id", () => {
  assert.match(dispatch[0], /command === "duplicate-tab"\)[\s\S]*?chrome\.tabs\.duplicate\(t\.id\)/);
});

test("pin-tab command toggles pinned flag on active tab", () => {
  assert.match(dispatch[0], /command === "pin-tab"\)[\s\S]*?pinned: !t\.pinned/);
});

test("mute-tab command toggles muted using mutedInfo.muted", () => {
  assert.match(dispatch[0], /command === "mute-tab"\)[\s\S]*?muted: !t\.mutedInfo\?\.muted/);
});

test("move-to-new-window command creates window containing active tab", () => {
  assert.match(dispatch[0], /command === "move-to-new-window"\)[\s\S]*?chrome\.windows\.create\(\{ tabId: t\.id \}\)/);
});

test("single-tab ops route through withActive not bare getActive", () => {
  assert.match(dispatch[0], /withActive\(\(t\) => chrome\.tabs\.duplicate/);
  assert.match(dispatch[0], /withActive\(\(t\) => chrome\.tabs\.update\(t\.id, \{ pinned/);
});

test("manage-scripts opens scripts manager tab not popup", () => {
  assert.match(dispatch[0], /command === "manage-scripts"\)[\s\S]*?openScriptsManager\(\)/);
});

test("search-tabs opens toolbar popup via chrome.action.openPopup", () => {
  assert.match(dispatch[0], /command === "search-tabs"\)[\s\S]*?chrome\.action\.openPopup\(\)/);
});

test("save-scene-prompt opens popup for scene naming UI", () => {
  assert.match(dispatch[0], /command === "save-scene-prompt"\)[\s\S]*?chrome\.action\.openPopup\(\)/);
});

test("restore-last-closed routes to restoreLastClosed helper", () => {
  assert.match(dispatch[0], /command === "restore-last-closed"\)[\s\S]*?restoreLastClosed\(\)/);
});

test("commands.onCommand wraps dispatch in try catch with command name logged", () => {
  assert.match(bg, /chrome\.commands\.onCommand\.addListener\(async \(command\) => \{/);
  assert.match(bg, /catch \(e\) \{ console\.error\("\[zpwrchrome\]", command, e\); \}/);
});

test("dispatch does not handle _execute_action (browser reserved)", () => {
  assert.ok(!dispatch[0].includes("_execute_action"));
});

test("jump-to commands use startsWith guard before resolveJumpIndex", () => {
  assert.match(dispatch[0], /command\.startsWith\("jump-to-"\)[\s\S]*?jumpTo\(command\)/);
});
