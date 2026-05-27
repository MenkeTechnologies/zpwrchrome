// restoreSceneBySlug window creation and tab pinning in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

const start = bg.indexOf("async function restoreSceneBySlug");
const end = bg.indexOf("async function deleteSceneBySlug");
assert.ok(start >= 0 && end > start, "restoreSceneBySlug missing");
const fn = bg.slice(start, end);

test("restoreSceneBySlug loads scenes from readScenes before lookup", () => {
  assert.match(fn, /const scenes = await readScenes\(\)/);
  assert.match(fn, /scenes\.find\(\(s\) => s\.slug === slug\)/);
});

test("restoreSceneBySlug returns undefined when scene has zero restorable tabs", () => {
  assert.match(fn, /if \(!scene \|\| !scene\.tabs\.length\) return undefined/);
});

test("restoreSceneBySlug opens new focused window with first tab URL only", () => {
  assert.match(fn, /const \[first, \.\.\.rest\] = scene\.tabs/);
  assert.match(fn, /chrome\.windows\.create\(\{ url: first\.url, focused: true \}\)/);
});

test("restoreSceneBySlug pins first tab when entry.pinned is true", () => {
  assert.match(fn, /if \(first\.pinned && win\.tabs\?.\[0\]\?\.id != null\)/);
  assert.match(fn, /chrome\.tabs\.update\(win\.tabs\[0\]\.id, \{ pinned: true \}\)/);
});

test("restoreSceneBySlug creates remaining tabs inactive in same window", () => {
  assert.match(fn, /for \(const entry of rest\)/);
  assert.match(fn, /chrome\.tabs\.create\(\{ windowId: win\.id, url: entry\.url, active: false \}\)/);
});

test("restoreSceneBySlug pins each additional tab when entry.pinned set", () => {
  assert.match(fn, /if \(entry\.pinned && tab\?\.id != null\)/);
  assert.match(fn, /await chrome\.tabs\.update\(tab\.id, \{ pinned: true \}\)/);
});

test("restoreSceneBySlug logs warning when individual tab create fails", () => {
  assert.match(fn, /console\.warn\("\[zpwrchrome\] scene restore tab failed:", entry\.url, e\)/);
});

test("restoreSceneBySlug returns new window id on success", () => {
  assert.match(fn, /return win\.id/);
});

test("restoreSceneByOrdinal delegates to restoreSceneBySlug after ordinal resolve", () => {
  const ord = bg.match(/async function restoreSceneByOrdinal\([\s\S]*?\n\}/);
  assert.match(ord[0], /resolveSceneOrdinal\(command, scenes\.length\)/);
  assert.match(ord[0], /return restoreSceneBySlug\(scenes\[idx\]\.slug\)/);
});

test("restoreSceneByOrdinal returns early when ordinal index is negative", () => {
  const ord = bg.match(/async function restoreSceneByOrdinal\([\s\S]*?\n\}/);
  assert.match(ord[0], /if \(idx < 0\) return/);
});

test("restoreSceneBySlug swallows pin failures on first tab with empty catch", () => {
  assert.match(fn, /try \{ await chrome\.tabs\.update\(win\.tabs\[0\]\.id/);
  assert.match(fn, /catch \{\}/);
});

test("restoreSceneBySlug does not mutate existing windows — only creates new window", () => {
  assert.ok(!fn.includes("tabs.query"), "restore must not query existing tabs");
  assert.match(fn, /chrome\.windows\.create/);
});
