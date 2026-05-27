// scenes-* message handler response contracts in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

function sliceHandler(kind, len = 600) {
  const marker = `msg?.kind === "${kind}"`;
  const idx = bg.indexOf(marker);
  assert.ok(idx >= 0, `handler for "${kind}" not found`);
  return bg.slice(idx, idx + len);
}

function fnBody(name) {
  const m = bg.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} not found`);
  return m[0];
}

test("scenes-list handler returns scenes array from readScenes", () => {
  const sec = sliceHandler("scenes-list", 300);
  assert.match(sec, /readScenes\(\)\.then\(\(scenes\) => sendResponse\(\{ scenes \}\)\)/);
});

test("scenes-save coerces msg.name to string before saveSceneFromActiveWindow", () => {
  const sec = sliceHandler("scenes-save", 400);
  assert.match(sec, /saveSceneFromActiveWindow\(String\(msg\.name \|\| ""\)\)/);
});

test("scenes-save responds ok:true only when scene object is truthy", () => {
  const sec = sliceHandler("scenes-save", 400);
  assert.match(sec, /sendResponse\(\{ ok: !!scene, scene \}\)/);
});

test("scenes-save catch path returns ok:false with stringified error", () => {
  const sec = sliceHandler("scenes-save", 400);
  assert.match(sec, /catch\(\(e\) => sendResponse\(\{ ok: false, error: String\(e\) \}\)\)/);
});

test("scenes-restore coerces msg.slug to string", () => {
  const sec = sliceHandler("scenes-restore", 400);
  assert.match(sec, /restoreSceneBySlug\(String\(msg\.slug \|\| ""\)\)/);
});

test("scenes-restore ok:true when windowId is numeric", () => {
  const sec = sliceHandler("scenes-restore", 400);
  assert.match(sec, /sendResponse\(\{ ok: typeof winId === "number", windowId: winId \}\)/);
});

test("scenes-delete coerces msg.slug to string", () => {
  const sec = sliceHandler("scenes-delete", 400);
  assert.match(sec, /deleteSceneBySlug\(String\(msg\.slug \|\| ""\)\)/);
});

test("scenes-delete returns remaining scene count on success", () => {
  const sec = sliceHandler("scenes-delete", 400);
  assert.match(sec, /sendResponse\(\{ ok: true, remaining: n \}\)/);
});

test("saveSceneFromActiveWindow reads tabs from last focused window", () => {
  const fn = fnBody("saveSceneFromActiveWindow");
  assert.match(fn, /chrome\.windows\.getLastFocused\(\{ populate: true \}\)/);
  assert.match(fn, /if \(!win\?\.tabs\?\.length\) return null/);
});

test("saveSceneFromActiveWindow returns null when buildScene rejects name", () => {
  const fn = fnBody("saveSceneFromActiveWindow");
  assert.match(fn, /const scene = buildScene\(name, win\.tabs\)/);
  assert.match(fn, /if \(!scene\) return null/);
});

test("saveSceneFromActiveWindow persists via upsertScene and writeScenes", () => {
  const fn = fnBody("saveSceneFromActiveWindow");
  assert.match(fn, /upsertScene\(await readScenes\(\), scene\)/);
  assert.match(fn, /await writeScenes\(/);
});

test("readScenes returns empty array when storage value is not an array", () => {
  const fn = fnBody("readScenes");
  assert.match(fn, /return Array\.isArray\(s\) \? s : \[\]/);
});

test("writeScenes stores under SCENES_KEY in chrome.storage.local", () => {
  const fn = fnBody("writeScenes");
  assert.match(fn, /chrome\.storage\.local\.set\(\{\s*\[SCENES_KEY\]/);
});

test("deleteSceneBySlug returns count of remaining scenes", () => {
  const fn = fnBody("deleteSceneBySlug");
  assert.match(fn, /return next\.length/);
});

test("restoreSceneBySlug returns undefined when slug not found", () => {
  const fn = fnBody("restoreSceneBySlug");
  assert.match(fn, /if \(!scene \|\| !scene\.tabs\.length\) return undefined/);
});

test("restoreSceneBySlug returns new window id on success", () => {
  const fn = fnBody("restoreSceneBySlug");
  assert.match(fn, /return win\.id/);
});

test("dispatch save-scene-prompt opens toolbar popup for scene naming", () => {
  assert.match(bg, /command === "save-scene-prompt"\)[\s\S]*?chrome\.action\.openPopup\(\)/);
});

test("dispatch restore-scene-* routes through restoreSceneByOrdinal", () => {
  assert.match(bg, /command\.startsWith\("restore-scene-"\)[\s\S]*?restoreSceneByOrdinal\(command\)/);
});
