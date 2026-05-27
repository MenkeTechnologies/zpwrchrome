// scripts.toggle handler and GM_PREFIX storage conventions.

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
  assert.ok(idx >= 0, `${kind} missing`);
  return bg.slice(idx, idx + len);
}

test("scripts.toggle finds script by msg.id in stored array", () => {
  const sec = sliceHandler("scripts.toggle", 500);
  assert.match(sec, /const s = all\.find\(\(x\) => x\.id === msg\.id\)/);
});

test("scripts.toggle coerces enabled flag with double bang", () => {
  const sec = sliceHandler("scripts.toggle", 500);
  assert.match(sec, /if \(s\) s\.enabled = !!msg\.enabled/);
});

test("scripts.toggle persists via writeScripts triggering resync", () => {
  const sec = sliceHandler("scripts.toggle", 500);
  assert.match(sec, /await writeScripts\(all\)/);
  assert.match(bg, /async function writeScripts[\s\S]*?await syncUserScripts\(\)/);
});

test("scripts.toggle responds ok true on success", () => {
  const sec = sliceHandler("scripts.toggle", 500);
  assert.match(sec, /sendResponse\(\{ ok: true \}\)/);
});

test("scripts.delete filters script out by id before writeScripts", () => {
  const sec = sliceHandler("scripts.delete", 500);
  assert.match(sec, /filter\(\(s\) => s\.id !== msg\.id\)/);
});

test("scripts.delete removes GM storage key gm: prefixed with script id", () => {
  const sec = sliceHandler("scripts.delete", 500);
  assert.match(sec, /chrome\.storage\.local\.remove\(GM_PREFIX \+ msg\.id\)/);
});

test("GM_PREFIX constant is gm: string in background.js", () => {
  assert.match(bg, /const GM_PREFIX = "gm:"/);
});

test("gm:getValue storage key uses GM_PREFIX plus script id", () => {
  const sec = sliceHandler("gm:getValue", 500);
  assert.match(sec, /GM_PREFIX \+ msg\.script/);
});

test("gm:setValue merges into map keyed by GM_PREFIX script id", () => {
  const sec = sliceHandler("gm:setValue", 600);
  assert.match(sec, /const key = GM_PREFIX \+ msg\.script/);
});

test("SCRIPTS_KEY constant names userscripts storage bucket", () => {
  assert.match(bg, /const SCRIPTS_KEY = "userscripts"/);
});

test("FIRE_LOG_KEY constant names userScripts.fireLog storage bucket", () => {
  assert.match(bg, /const FIRE_LOG_KEY = "userScripts\.fireLog"/);
});

test("FIRE_LOG_CAP constant is 200 matching appendFireLog truncation", () => {
  assert.match(bg, /const FIRE_LOG_CAP = 200/);
  const fn = bg.match(/async function appendFireLog\([\s\S]*?\n\}/);
  assert.match(fn[0], /FIRE_LOG_CAP/);
});

test("manager toggle sends enabled true when row has disabled class", () => {
  const mgr = readFileSync(join(ROOT, "scripts-manager/manager.js"), "utf8");
  assert.match(mgr, /enabled: tr\.classList\.contains\("disabled"\)/);
});
