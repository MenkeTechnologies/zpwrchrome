// GM.* shim source invariants — lib/gm-shim.js is prepended to every userscript.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { GM_SHIM_SOURCE } from "../lib/gm-shim.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const fileSrc = readFileSync(join(ROOT, "lib/gm-shim.js"), "utf8");

test("GM_SHIM_SOURCE is exported and non-empty", () => {
  assert.ok(typeof GM_SHIM_SOURCE === "string");
  assert.ok(GM_SHIM_SOURCE.length > 500);
});

test("GM_SHIM_SOURCE is defined in gm-shim.js and importable", () => {
  assert.match(fileSrc, /export const GM_SHIM_SOURCE = `/);
  assert.ok(GM_SHIM_SOURCE.includes("const GM_info = __GM_INFO_JSON__;"));
});

test("GM_SHIM_SOURCE leaves __GM_INFO_JSON__ as a replace-time placeholder", () => {
  assert.match(GM_SHIM_SOURCE, /const GM_info = __GM_INFO_JSON__;/);
  assert.ok(!GM_SHIM_SOURCE.includes('"script":'), "placeholder must not be pre-substituted");
});

test("GM_SHIM_SOURCE exposes unsafeWindow as window alias", () => {
  assert.match(GM_SHIM_SOURCE, /const unsafeWindow = window;/);
});

test("GM_SHIM_SOURCE __gmSend uses callback-form sendMessage (not bare Promise)", () => {
  assert.match(GM_SHIM_SOURCE, /chrome\.runtime\.sendMessage\(\{ kind: "gm:" \+ kind/);
  assert.match(GM_SHIM_SOURCE, /void chrome\.runtime\.lastError/);
});

test("GM_SHIM_SOURCE __gmSend wraps sync throws in resolve({ ok: false })", () => {
  assert.match(GM_SHIM_SOURCE, /catch \{ resolve\(\{ ok: false \}\); \}/);
});

test("GM_SHIM_SOURCE fires gm:fire beacon at load with callback swallow", () => {
  assert.match(GM_SHIM_SOURCE, /kind:\s*"gm:fire"/);
  assert.match(GM_SHIM_SOURCE, /script:\s*GM_info\.script\.id/);
  assert.match(GM_SHIM_SOURCE, /url:\s*location\.href/);
  assert.match(GM_SHIM_SOURCE, /when:\s*Date\.now\(\)/);
});

test("GM_SHIM_SOURCE gm:fire beacon is wrapped in try/catch", () => {
  const idx = GM_SHIM_SOURCE.indexOf('kind: "gm:fire"');
  assert.ok(idx >= 0);
  const head = GM_SHIM_SOURCE.slice(Math.max(0, idx - 80), idx);
  assert.match(head, /try\s*\{/);
});

test("GM object exposes getValue/setValue/deleteValue/listValues", () => {
  for (const fn of ["getValue", "setValue", "deleteValue", "listValues"]) {
    assert.match(GM_SHIM_SOURCE, new RegExp(`${fn}:`));
  }
});

test("GM.getValue falls back when response is missing or value undefined", () => {
  assert.match(GM_SHIM_SOURCE, /r\.value !== undefined \? r\.value : fallback/);
});

test("GM.setValue passes script id from GM_info.script.id", () => {
  assert.match(GM_SHIM_SOURCE, /script:\s*GM_info\.script\.id,\s*key,\s*value/);
});

test("GM.setClipboard proxies through gm:setClipboard kind", () => {
  assert.match(GM_SHIM_SOURCE, /setClipboard:\s*\(text\) => __gmSend\("setClipboard"/);
});

test("GM.openInTab normalizes boolean opts to { active } object", () => {
  assert.match(GM_SHIM_SOURCE, /typeof opts === "boolean" \? \{ active: !opts \}/);
  assert.match(GM_SHIM_SOURCE, /active:\s*o\.active !== false/);
});

test("GM.addStyle appends a <style> element to document head", () => {
  assert.match(GM_SHIM_SOURCE, /document\.createElement\("style"\)/);
  assert.match(GM_SHIM_SOURCE, /document\.head \|\| document\.documentElement\)\.appendChild/);
});

test("GM.addElement supports string-tag and parent-element overloads", () => {
  assert.match(GM_SHIM_SOURCE, /if \(typeof parentOrTag === "string"\)/);
  assert.match(GM_SHIM_SOURCE, /document\.createElement\(tag\)/);
});

test("GM.notification accepts string or object payload", () => {
  assert.match(GM_SHIM_SOURCE, /typeof text === "string" \? \{ text, title \} : text/);
});

test("GM_SHIM_SOURCE exports sync GM_* aliases for Tampermonkey compatibility", () => {
  for (const alias of [
    "GM_setValue", "GM_getValue", "GM_deleteValue", "GM_listValues",
    "GM_setClipboard", "GM_openInTab", "GM_addStyle", "GM_addElement", "GM_notification"
  ]) {
    assert.match(GM_SHIM_SOURCE, new RegExp(`const ${alias}\\s*=`));
  }
});

test("background.js substitutes __GM_INFO_JSON__ before register and fallback inject", () => {
  const bg = readFileSync(join(ROOT, "background.js"), "utf8");
  assert.match(bg, /GM_SHIM_SOURCE\.replace\("__GM_INFO_JSON__", JSON\.stringify\(info\)\)/);
  assert.equal((bg.match(/GM_SHIM_SOURCE\.replace/g) || []).length, 2,
    "both native register and fallback inject must substitute GM_info JSON");
});
