// Service-worker wiring invariants — static analysis of background.js.
// Each test pins a contract that broke in a prior release.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const bg = read("background.js");

function sliceHandler(kind, len = 1400) {
  const marker = `msg?.kind === "${kind}"`;
  const idx = bg.indexOf(marker);
  assert.ok(idx >= 0, `handler for "${kind}" not found`);
  return bg.slice(idx, idx + len);
}

test("background.js imports frecencyScore from lib/util.js", () => {
  assert.match(bg, /import[\s\S]+frecencyScore[\s\S]+from\s+"\.\/lib\/util\.js"/);
});

test("history-list re-ranks chrome.history results by frecencyScore", () => {
  const sec = sliceHandler("history-list", 900);
  assert.match(sec, /frecencyScore\(/);
  assert.match(sec, /ranked\.sort\(\(a, b\) => b\.frecency - a\.frecency\)/);
});

test("history-list forwards maxResults to chrome.history.search", () => {
  const sec = sliceHandler("history-list", 900);
  assert.match(sec, /maxResults:\s*msg\.maxResults \|\| 5000/);
});

test("history-list uses empty text search to fetch the broadest candidate set", () => {
  const sec = sliceHandler("history-list", 900);
  assert.match(sec, /text:\s*""/);
});

test("history-delete calls chrome.history.deleteUrl with the client URL", () => {
  const sec = sliceHandler("history-delete", 400);
  assert.match(sec, /chrome\.history\.deleteUrl\(\{\s*url:\s*String\(msg\.url/);
});

test("list handler merges MRU order with unseen tabs appended", () => {
  const sec = sliceHandler("list", 600);
  assert.match(sec, /readMru\(\)/);
  assert.match(sec, /mru\.map\(\(id\) => byId\.get\(id\)\)/);
  assert.match(sec, /for \(const t of tabs\) if \(!seen\.has\(t\.id\)\) mruTabs\.push\(t\)/);
});

test("activate handler focuses the tab's window after switching", () => {
  const sec = sliceHandler("activate", 500);
  assert.match(sec, /chrome\.tabs\.update\(msg\.tabId,\s*\{\s*active:\s*true\s*\}/);
  assert.match(sec, /chrome\.windows\.update\(t\.windowId,\s*\{\s*focused:\s*true\s*\}/);
});

test("close-tab handler removes by msg.tabId", () => {
  const sec = sliceHandler("close-tab", 300);
  assert.match(sec, /chrome\.tabs\.remove\(msg\.tabId\)/);
});

test("restore handler delegates to chrome.sessions.restore", () => {
  const sec = sliceHandler("restore", 300);
  assert.match(sec, /chrome\.sessions\.restore\(msg\.sessionId\)/);
});

test("MRU stack uses chrome.storage.session with a fixed key", () => {
  assert.match(bg, /const MRU_KEY = "mru"/);
  assert.match(bg, /chrome\.storage\.session\.get\(MRU_KEY\)/);
  assert.match(bg, /chrome\.storage\.session\.set\(\{\s*\[MRU_KEY\]/);
});

test("pushMru routes through mruPush from lib/util.js", () => {
  assert.match(bg, /import[\s\S]+mruPush[\s\S]+from\s+"\.\/lib\/util\.js"/);
  const fn = bg.match(/async function pushMru\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /mruPush\(/);
});

test("scenes persist under SCENES_KEY in chrome.storage.local", () => {
  assert.match(bg, /const SCENES_KEY = "scenes"/);
  assert.match(bg, /chrome\.storage\.local\.get\(SCENES_KEY\)/);
  assert.match(bg, /chrome\.storage\.local\.set\(\{\s*\[SCENES_KEY\]/);
});

test("scenes-save delegates to saveSceneFromActiveWindow", () => {
  const sec = sliceHandler("scenes-save", 400);
  assert.match(sec, /saveSceneFromActiveWindow\(/);
  const fn = bg.match(/async function saveSceneFromActiveWindow\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /buildScene\(/);
});

test("restoreSceneBySlug opens a new window with saved URLs", () => {
  const fn = bg.match(/async function restoreSceneBySlug\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /chrome\.windows\.create\(\{\s*url:\s*first\.url/);
});

test("deleteSceneBySlug drops by slug via dropScene", () => {
  const fn = bg.match(/async function deleteSceneBySlug\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /dropScene\(/);
});

test("appendFireLog caps the ring buffer at FIRE_LOG_CAP", () => {
  const fn = bg.match(/async function appendFireLog\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /FIRE_LOG_CAP/);
  assert.match(fn[0], /log\.length = FIRE_LOG_CAP/);
});

test("gm:getValue reads namespaced chrome.storage.local keys", () => {
  const sec = sliceHandler("gm:getValue", 400);
  assert.match(sec, /GM_PREFIX/);
  assert.match(sec, /chrome\.storage\.local\.get\(/);
});

test("gm:setValue writes namespaced chrome.storage.local keys", () => {
  const sec = sliceHandler("gm:setValue", 500);
  assert.match(sec, /chrome\.storage\.local\.set\(/);
});

test("gm:openInTab creates a tab honoring msg.active", () => {
  const sec = sliceHandler("gm:openInTab", 400);
  assert.match(sec, /chrome\.tabs\.create\(\{\s*url:\s*msg\.url,\s*active:\s*!!msg\.active\s*\}/);
});

test("scripts.save validates metadata before persisting", () => {
  const sec = sliceHandler("scripts.save", 1200);
  assert.match(sec, /parseMetadata\(incoming\.src\)/);
  assert.match(sec, /validateUserscript\(meta\)/);
});

test("scripts.toggle sets enabled from msg.enabled then writeScripts", () => {
  const sec = sliceHandler("scripts.toggle", 500);
  assert.match(sec, /s\.enabled = !!msg\.enabled/);
  assert.match(sec, /writeScripts\(all\)/);
});

test("scripts.delete filters by id and writeScripts (which resyncs)", () => {
  const sec = sliceHandler("scripts.delete", 500);
  assert.match(sec, /\.filter\(\(s\) => s\.id !== msg\.id\)/);
  assert.match(sec, /writeScripts\(all\)/);
  assert.match(bg, /async function writeScripts\([\s\S]*?syncUserScripts\(\)/);
});

test("dispatch routes jump-to-* through resolveJumpIndex", () => {
  assert.match(bg, /if \(command\.startsWith\("jump-to-"\)\)\s+return jumpTo\(command\)/);
  const fn = bg.match(/async function jumpTo\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /resolveJumpIndex\(command, tabs\.length\)/);
});

test("switchPreviousTab walks the MRU, self-heals the head, and drops stale tab ids", () => {
  // The Cmd+E flake comes from: SW was suspended → onActivated /
  // onRemoved missed → MRU is stale. Fix asserts:
  //   1. Re-push the real active tab so the next non-self entry is
  //      genuinely "previous", even if SW missed an onActivated.
  //   2. Iterate the list and skip any tab id chrome.tabs.get() rejects,
  //      dropping each stale entry as it surfaces so the MRU self-heals.
  const fn = bg.match(/async function switchPreviousTab\([\s\S]*?\n\}\n/);
  assert.ok(fn, "switchPreviousTab not found");
  assert.match(fn[0], /if \(active\?\.id != null\) await pushMru\(active\.id\)/,
    "must self-heal MRU head with the real active tab");
  assert.match(fn[0], /for \(const id of mru\)/,
    "must iterate the MRU, not bail on the first stale id");
  assert.match(fn[0], /await dropFromMru\(id\)/,
    "must drop stale ids as they surface so future Cmd+E starts clean");
  // mruStep gets the same treatment.
  const stepFn = bg.match(/async function mruStep\(delta\)[\s\S]*?\n\}\n/);
  assert.ok(stepFn, "mruStep not found");
  assert.match(stepFn[0], /if \(active\?\.id != null\) await pushMru\(active\.id\)/);
  assert.match(stepFn[0], /await dropFromMru\(next\)/);
  assert.match(stepFn[0], /mru = await readMru\(\)/);
});

test("tab activation events feed pushMru on tabs.onActivated", () => {
  assert.match(bg, /chrome\.tabs\.onActivated\.addListener\(\(\{\s*tabId\s*\}\)\s*=>\s*\{\s*pushMru\(tabId\)/);
});

test("tab removal events feed dropFromMru on tabs.onRemoved", () => {
  assert.match(bg, /chrome\.tabs\.onRemoved\.addListener/);
  assert.match(bg, /dropFromMru\(tabId\)/);
});

test("seedMru hydrates MRU from currently open tabs at startup", () => {
  const fn = bg.match(/async function seedMru\([\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /chrome\.tabs\.query\(\{\}\)/);
  assert.match(fn[0], /writeMru\(/);
});

test("kill-heaviest handler delegates to killHeaviestTab()", () => {
  const sec = sliceHandler("kill-heaviest", 400);
  assert.match(sec, /killHeaviestTab\(\)/);
});

test("processes-snapshot handler delegates to snapshotProcesses()", () => {
  const sec = sliceHandler("processes-snapshot", 400);
  assert.match(sec, /snapshotProcesses\(\)/);
});
