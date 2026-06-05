// Keyboard command dispatcher invariants — manifest.json ↔ background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const manifest = JSON.parse(read("manifest.json"));
const bg = read("background.js");

const commandNames = Object.keys(manifest.commands);

test("manifest declares at least 30 keyboard commands", () => {
  assert.ok(commandNames.length >= 30,
    `expected a large command surface, got ${commandNames.length}`);
});

test("dispatch function handles every manifest command except _execute_action", () => {
  for (const name of commandNames) {
    if (name === "_execute_action") continue;
    if (/^jump-to-[1-9]$/.test(name)) {
      assert.match(bg, /command\.startsWith\("jump-to-"\)/,
        "jump-to family must use startsWith dispatch");
      continue;
    }
    if (/^restore-scene-[1-9]$/.test(name)) {
      assert.match(bg, /command\.startsWith\("restore-scene-"\)/,
        "restore-scene family must use startsWith dispatch");
      continue;
    }
    assert.match(bg, new RegExp(`command === "${name}"`),
      `background.js missing handler for manifest command "${name}"`);
  }
});

test("open-history stashes pendingCategory=history in session storage before opening popup", () => {
  const fn = bg.match(/async function openHistoryInPopup\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /pendingCategory:\s*"history"/);
  assert.match(fn[0], /chrome\.storage\.session\.set/);
  assert.match(fn[0], /chrome\.action\.openPopup/);
});

test("popup.js reads and clears pendingCategory from session storage on init", () => {
  const popup = read("popup.js");
  assert.match(popup, /chrome\.storage\.session\.get\("pendingCategory"/);
  assert.match(popup, /chrome\.storage\.session\.remove\("pendingCategory"\)/);
});

test("manage-scripts opens scripts-manager/manager.html in a new tab", () => {
  const fn = bg.match(/async function openScriptsManager\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /scripts-manager\/manager\.html/);
  assert.match(fn[0], /chrome\.tabs\.create/);
});

test("mru-next and mru-prev delegate to mruStep with signed delta", () => {
  assert.match(bg, /command === "mru-next"\)[\s\S]*?mruStep\(\+1\)/);
  assert.match(bg, /command === "mru-prev"\)[\s\S]*?mruStep\(-1\)/);
});

test("mruStep uses mruStepPure from lib/util.js against session MRU", () => {
  const fn = bg.match(/async function mruStep\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /mruStepPure\(/);
});

test("closeOthers keeps the active tab and removes the rest", () => {
  const fn = bg.match(/async function closeOthers\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /chrome\.tabs\.remove\(/);
  assert.match(fn[0], /active/);
});

test("closeRight removes tabs with index greater than active", () => {
  const fn = bg.match(/async function closeRight\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /index > active\.index/);
});

test("closeDuplicates dedupes by URL keeping the leftmost tab", () => {
  const fn = bg.match(/async function closeDuplicates\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /seen\.has\(t\.url\)/);
});

test("groupByDomain clusters tabs using hostnameOf helper", () => {
  const fn = bg.match(/async function groupByDomain\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /hostnameOf\(/);
  assert.match(fn[0], /chrome\.tabGroups\.update/);
});

test("copyActiveUrl writes clipboard via writeClipboard helper", () => {
  const fn = bg.match(/async function copyActiveUrl\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /writeClipboard\(/);
});

test("copyActiveTitleMd formats markdown [title](url)", () => {
  const fn = bg.match(/async function copyActiveTitleMd\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /\[.*\]\(/);
});

test("bookmarkActive creates an Other Bookmarks entry", () => {
  const fn = bg.match(/async function bookmarkActive\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /chrome\.bookmarks\.create/);
});

test("restoreSceneByOrdinal resolves command via resolveSceneOrdinal", () => {
  const fn = bg.match(/async function restoreSceneByOrdinal\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /resolveSceneOrdinal\(command, scenes\.length\)/);
});

test("writeMru enforces MRU_CAP_DEFAULT from lib/util.js", () => {
  const fn = bg.match(/async function writeMru\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /MRU_CAP_DEFAULT/);
});

test("chrome.commands.onCommand wraps dispatch in try/catch", () => {
  assert.match(bg, /chrome\.commands\.onCommand\.addListener/);
  assert.match(bg, /try \{ await dispatch\(command\)/);
  assert.match(bg, /catch \(e\) \{ console\.error\("\[zpwrchrome\]", command, e\)/);
});

test("manifest minimum_chrome_version is at least 120 (userScripts era)", () => {
  const min = parseInt(manifest.minimum_chrome_version, 10);
  assert.ok(min >= 120, `minimum_chrome_version ${min} is too low for userScripts`);
});

test("manifest no longer declares `processes` (chrome.processes is dev/canary-only)", () => {
  assert.ok(!(manifest.optional_permissions || []).includes("processes"));
  assert.ok(!(manifest.permissions || []).includes("processes"));
});

test("manifest declares host_permissions <all_urls> for content script + scripting", () => {
  assert.ok(manifest.host_permissions.includes("<all_urls>"));
});

test("default-keyed commands stay within Chrome's 4-key ceiling", () => {
  const defaults = commandNames.filter((k) => manifest.commands[k].suggested_key);
  assert.ok(defaults.length <= 4,
    `Chrome caps suggested_key at 4; got ${defaults.length}: ${defaults.join(", ")}`);
});

test("switch-previous-tab owns Cmd+E on Mac (recent-modal is user-bindable)", () => {
  const prev = manifest.commands["switch-previous-tab"];
  assert.equal(prev.suggested_key.mac, "Command+E");
  assert.ok(!manifest.commands["recent-modal"]?.suggested_key,
    "recent-modal must not carry a default key");
});
