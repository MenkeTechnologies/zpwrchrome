// Scene save/restore/delete invariants in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { buildScene, upsertScene, dropScene, resolveSceneOrdinal } from "../lib/util.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

function fnBody(name) {
  const m = bg.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} not found`);
  return m[0];
}

function sliceHandler(kind, len = 600) {
  const marker = `msg?.kind === "${kind}"`;
  const idx = bg.indexOf(marker);
  assert.ok(idx >= 0, `handler for "${kind}" not found`);
  return bg.slice(idx, idx + len);
}

test("restoreSceneBySlug opens focused window with first tab URL only", () => {
  const fn = fnBody("restoreSceneBySlug");
  assert.match(fn, /const \[first, \.\.\.rest\] = scene\.tabs/);
  assert.match(fn, /chrome\.windows\.create\(\{\s*url:\s*first\.url,\s*focused:\s*true\s*\}/);
});

test("restoreSceneBySlug pins first tab when scene entry is pinned", () => {
  const fn = fnBody("restoreSceneBySlug");
  assert.match(fn, /if \(first\.pinned && win\.tabs\?\.\[0\]\?\.id != null\)/);
  assert.match(fn, /chrome\.tabs\.update\(win\.tabs\[0\]\.id, \{ pinned: true \}\)/);
});

test("restoreSceneBySlug creates remaining tabs inactive in same window", () => {
  const fn = fnBody("restoreSceneBySlug");
  assert.match(fn, /chrome\.tabs\.create\(\{\s*windowId:\s*win\.id,\s*url:\s*entry\.url,\s*active:\s*false\s*\}/);
});

test("restoreSceneBySlug applies pinned flag to each additional tab", () => {
  const fn = fnBody("restoreSceneBySlug");
  assert.match(fn, /if \(entry\.pinned && tab\?\.id != null\)/);
  assert.match(fn, /chrome\.tabs\.update\(tab\.id, \{ pinned: true \}\)/);
});

test("restoreSceneBySlug logs tab failures without aborting the whole restore", () => {
  const fn = fnBody("restoreSceneBySlug");
  assert.match(fn, /catch \(e\) \{[\s\S]*?console\.warn\("\[zpwrchrome\] scene restore tab failed:"/);
});

test("restoreSceneBySlug returns undefined when slug is missing", () => {
  const fn = fnBody("restoreSceneBySlug");
  assert.match(fn, /if \(!scene \|\| !scene\.tabs\.length\) return undefined/);
});

test("restoreSceneByOrdinal delegates to restoreSceneBySlug by index", () => {
  const fn = fnBody("restoreSceneByOrdinal");
  assert.match(fn, /resolveSceneOrdinal\(command, scenes\.length\)/);
  assert.match(fn, /return restoreSceneBySlug\(scenes\[idx\]\.slug\)/);
});

test("saveSceneFromActiveWindow uses last-focused populated window", () => {
  const fn = fnBody("saveSceneFromActiveWindow");
  assert.match(fn, /chrome\.windows\.getLastFocused\(\{\s*populate:\s*true\s*\}\)/);
});

test("saveSceneFromActiveWindow returns null when window has no tabs", () => {
  const fn = fnBody("saveSceneFromActiveWindow");
  assert.match(fn, /if \(!win\?\.tabs\?\.length\) return null/);
});

test("saveSceneFromActiveWindow upserts via upsertScene and writeScenes", () => {
  const fn = fnBody("saveSceneFromActiveWindow");
  assert.match(fn, /const scene = buildScene\(name, win\.tabs\)/);
  assert.match(fn, /upsertScene\(await readScenes\(\), scene\)/);
  assert.match(fn, /await writeScenes\(scenes\)/);
});

test("scenes-save handler stringifies name before saveSceneFromActiveWindow", () => {
  const sec = sliceHandler("scenes-save", 400);
  assert.match(sec, /saveSceneFromActiveWindow\(String\(msg\.name \|\| ""\)\)/);
});

test("scenes-restore handler stringifies slug before restoreSceneBySlug", () => {
  const sec = sliceHandler("scenes-restore", 400);
  assert.match(sec, /restoreSceneBySlug\(String\(msg\.slug \|\| ""\)\)/);
});

test("scenes-delete handler returns remaining count after dropScene", () => {
  const sec = sliceHandler("scenes-delete", 400);
  assert.match(sec, /deleteSceneBySlug\(String\(msg\.slug \|\| ""\)\)/);
  const fn = fnBody("deleteSceneBySlug");
  assert.match(fn, /return next\.length/);
});

test("scenes-list handler reads from readScenes", () => {
  const sec = sliceHandler("scenes-list", 300);
  assert.match(sec, /readScenes\(\)\.then\(\(scenes\) => sendResponse\(\{ scenes \}\)\)/);
});

test("buildScene stores pendingUrl when url is empty", () => {
  const s = buildScene("launch", [{ url: "", pendingUrl: "https://pending/", title: "P" }]);
  assert.equal(s.tabs.length, 1);
  assert.equal(s.tabs[0].url, "https://pending/");
});

test("buildScene truncates display name to 48 characters", () => {
  const s = buildScene("X".repeat(80), [{ url: "https://a/" }]);
  assert.equal(s.name.length, 48);
});

test("upsertScene preserves other scenes when inserting new slug", () => {
  const a = { slug: "a", tabs: [] };
  const b = { slug: "b", tabs: [] };
  const c = { slug: "c", tabs: [{ url: "https://c/" }] };
  const out = upsertScene([a, b], c);
  assert.deepEqual(out.map((s) => s.slug), ["c", "a", "b"]);
});

test("dropScene is idempotent when slug is absent", () => {
  const scenes = [{ slug: "keep" }];
  assert.deepEqual(dropScene(scenes, "ghost"), scenes);
});

test("resolveSceneOrdinal rejects restore-scene-10 (only 1..9 supported)", () => {
  assert.equal(resolveSceneOrdinal("restore-scene-10", 20), -1);
});

test("dispatch routes restore-scene-* commands to restoreSceneByOrdinal", () => {
  assert.match(bg, /if \(command\.startsWith\("restore-scene-"\)\)\s+return restoreSceneByOrdinal\(command\)/);
});

test("dispatch save-scene-prompt opens the action popup", () => {
  assert.match(bg, /if \(command === "save-scene-prompt"\)\s+return chrome\.action\.openPopup\(\)/);
});
