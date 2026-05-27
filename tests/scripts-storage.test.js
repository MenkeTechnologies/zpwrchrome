// Userscript persistence keys and read/write helpers in background.js.

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

test("SCRIPTS_KEY is userscripts in chrome.storage.local", () => {
  assert.match(bg, /const SCRIPTS_KEY = "userscripts"/);
});

test("GM_PREFIX namespaces per-script GM storage keys", () => {
  assert.match(bg, /const GM_PREFIX = "gm:"/);
});

test("FIRE_LOG_KEY stores fire log ring buffer in local storage", () => {
  assert.match(bg, /const FIRE_LOG_KEY = "userScripts\.fireLog"/);
});

test("FIRE_LOG_CAP limits fire log to 200 entries", () => {
  assert.match(bg, /const FIRE_LOG_CAP = 200/);
});

test("readScripts returns empty array when storage value is not an array", () => {
  const fn = fnBody("readScripts");
  assert.match(fn, /return Array\.isArray\(arr\) \? arr : \[\]/);
});

test("readScripts reads SCRIPTS_KEY from chrome.storage.local", () => {
  const fn = fnBody("readScripts");
  assert.match(fn, /chrome\.storage\.local\.get\(SCRIPTS_KEY\)/);
});

test("writeScripts persists scripts array then calls syncUserScripts", () => {
  const fn = fnBody("writeScripts");
  assert.match(fn, /chrome\.storage\.local\.set\(\{ \[SCRIPTS_KEY\]: scripts \}\)/);
  assert.match(fn, /await syncUserScripts\(\)/);
});

test("appendFireLog merges entry with when timestamp defaulting to Date.now", () => {
  const fn = fnBody("appendFireLog");
  assert.match(fn, /const final = \{ when: Date\.now\(\), \.\.\.entry \}/);
});

test("appendFireLog logs mode name and url to console.info", () => {
  const fn = fnBody("appendFireLog");
  assert.match(fn, /console\.info\("\[zpwrchrome\] fire logged:", final\.mode, final\.name \|\| final\.script/);
});

test("gm:getValue uses GM_PREFIX + msg.script as storage key", () => {
  const idx = bg.indexOf('msg?.kind === "gm:getValue"');
  const sec = bg.slice(idx, idx + 500);
  assert.match(sec, /bag\[GM_PREFIX \+ msg\.script\]/);
});

test("gm:setValue reads-modifies-writes map under GM_PREFIX + script id", () => {
  const idx = bg.indexOf('msg?.kind === "gm:setValue"');
  const sec = bg.slice(idx, idx + 600);
  assert.match(sec, /const key = GM_PREFIX \+ msg\.script/);
  assert.match(sec, /map\[msg\.key\] = msg\.value/);
});

test("scripts.delete filters by msg.id before writeScripts", () => {
  const idx = bg.indexOf('msg?.kind === "scripts.delete"');
  const sec = bg.slice(idx, idx + 500);
  assert.match(sec, /filter\(\(s\) => s\.id !== msg\.id\)/);
});

test("scripts.toggle finds script by msg.id and sets enabled from msg.enabled", () => {
  const idx = bg.indexOf('msg?.kind === "scripts.toggle"');
  const sec = bg.slice(idx, idx + 500);
  assert.match(sec, /all\.find\(\(x\) => x\.id === msg\.id\)/);
  assert.match(sec, /s\.enabled = !!msg\.enabled/);
});

test("background.js imports parseMetadata validateUserscript userscriptId from lib/userscript.js", () => {
  assert.match(bg, /import[\s\S]+parseMetadata[\s\S]+from "\.\/lib\/userscript\.js"/);
  assert.match(bg, /validateUserscript/);
  assert.match(bg, /userscriptId/);
});

test("background.js imports GM_SHIM_SOURCE from lib/gm-shim.js", () => {
  assert.match(bg, /import \{ GM_SHIM_SOURCE \} from "\.\/lib\/gm-shim\.js"/);
});

test("syncUserScripts stores userScripts.error when API unavailable", () => {
  const start = bg.indexOf("async function syncUserScripts");
  const end = bg.indexOf("chrome.runtime.onInstalled.addListener(initUserscripts)");
  const fn = bg.slice(start, end);
  assert.match(fn, /"userScripts\.error": "chrome\.userScripts API not available/);
});
