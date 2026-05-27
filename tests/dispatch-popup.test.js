// Popup-opening dispatch commands and openRecentModal in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

function fnBody(name) {
  const m = bg.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n\}`));
  assert.ok(m, `${name} not found`);
  return m[0];
}

test("dispatch search-tabs opens toolbar popup via chrome.action.openPopup", () => {
  assert.match(bg, /command === "search-tabs"\)[\s\S]*?chrome\.action\.openPopup\(\)/);
});

test("dispatch recent-modal routes to openRecentModal not content script", () => {
  assert.match(bg, /command === "recent-modal"\)[\s\S]*?openRecentModal\(\)/);
});

test("openRecentModal calls chrome.action.openPopup", () => {
  const fn = fnBody("openRecentModal");
  assert.match(fn, /chrome\.action\.openPopup/);
});

test("openRecentModal does not inject modal content script", () => {
  const fn = fnBody("openRecentModal");
  assert.ok(!fn.includes("executeScript"), "must not inject in-page modal");
  assert.ok(!fn.includes("open-modal"), "must not send open-modal message");
});

test("openHistoryInPopup sets pendingCategory history in session storage", () => {
  const fn = fnBody("openHistoryInPopup");
  assert.match(fn, /pendingCategory:\s*"history"/);
  assert.match(fn, /chrome\.storage\.session\.set/);
});

test("openHistoryInPopup opens toolbar popup after stashing category", () => {
  const fn = fnBody("openHistoryInPopup");
  assert.match(fn, /await chrome\.action\.openPopup\(\)/);
});

test("dispatch open-history routes to openHistoryInPopup", () => {
  assert.match(bg, /command === "open-history"\)[\s\S]*?openHistoryInPopup\(\)/);
});

test("dispatch manage-scripts routes to openScriptsManager", () => {
  assert.match(bg, /command === "manage-scripts"\)[\s\S]*?openScriptsManager\(\)/);
});

test("openScriptsManager creates tab with manager.html extension URL", () => {
  const fn = fnBody("openScriptsManager");
  assert.match(fn, /getURL\("scripts-manager\/manager\.html"\)/);
  assert.match(fn, /chrome\.tabs\.create\(\{ url \}\)/);
});

test("dispatch save-scene-prompt opens popup for scene naming UI", () => {
  assert.match(bg, /command === "save-scene-prompt"\)[\s\S]*?chrome\.action\.openPopup\(\)/);
});

test("dispatch switch-previous-tab routes to switchPreviousTab", () => {
  assert.match(bg, /command === "switch-previous-tab"\)[\s\S]*?switchPreviousTab\(\)/);
});

test("dispatch restore-last-closed routes to restoreLastClosed", () => {
  assert.match(bg, /command === "restore-last-closed"\)[\s\S]*?restoreLastClosed\(\)/);
});

test("jumpTo queries tabs in current window only", () => {
  const fn = fnBody("jumpTo");
  assert.match(fn, /chrome\.tabs\.query\(\{ currentWindow: true \}\)/);
});

test("jumpTo activates tab at resolveJumpIndex result", () => {
  const fn = fnBody("jumpTo");
  assert.match(fn, /resolveJumpIndex\(command, tabs\.length\)/);
  assert.match(fn, /chrome\.tabs\.update\(tabs\[idx\]\.id, \{ active: true \}\)/);
});

test("jumpTo returns without update when resolveJumpIndex is negative", () => {
  const fn = fnBody("jumpTo");
  assert.match(fn, /if \(idx < 0\) return/);
});

test("manifest _execute_action opens default popup on Alt+T", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  const action = manifest.commands._execute_action;
  assert.ok(action);
  assert.equal(action.suggested_key.default, "Alt+T");
});
