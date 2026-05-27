// Userscript sync + navigation logger invariants in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

function fnBody(name) {
  const m = bg.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} not found`);
  return m[0];
}

test("syncUserScripts imports GM_SHIM_SOURCE from lib/gm-shim.js", () => {
  assert.match(bg, /import \{ GM_SHIM_SOURCE \} from "\.\/lib\/gm-shim\.js"/);
});

test("syncUserScripts clears stale userScripts.error when native API is live", () => {
  const fn = fnBody("syncUserScripts");
  assert.match(fn, /chrome\.storage\.local\.remove\("userScripts\.error"\)/);
});

test("syncUserScripts calls configureUserScriptsWorld before registering", () => {
  const fn = fnBody("syncUserScripts");
  assert.match(fn, /await configureUserScriptsWorld\(\)/);
});

test("syncUserScripts unregisters all scripts before re-registering", () => {
  const fn = fnBody("syncUserScripts");
  assert.match(fn, /chrome\.userScripts\.unregister\(\)/);
});

test("syncUserScripts skips disabled scripts with a reason", () => {
  const fn = fnBody("syncUserScripts");
  assert.match(fn, /if \(!s\.enabled\) \{ skipped\.push\(\{ id: s\.id, reason: "disabled" \}\)/);
});

test("syncUserScripts converts @include to match patterns when @match absent", () => {
  const fn = fnBody("syncUserScripts");
  assert.match(fn, /meta\.includes\.map\(includeToMatchPattern\)/);
});

test("syncUserScripts expands bare-host @match patterns via expandMatchPatterns", () => {
  const fn = fnBody("syncUserScripts");
  assert.match(fn, /const matches = expandMatchPatterns\(baseMatches\)/);
});

test("syncUserScripts wraps user code in try/catch with script name in log prefix", () => {
  const fn = fnBody("syncUserScripts");
  assert.match(fn, /catch \(e\) \{ console\.error\('\[zpwrchrome userscript\]'/);
});

test("syncUserScripts registers scripts in USER_SCRIPT world", () => {
  const fn = fnBody("syncUserScripts");
  assert.match(fn, /world:\s*"USER_SCRIPT"/);
});

test("syncUserScripts maps runAt dashes to underscores for chrome.userScripts", () => {
  const fn = fnBody("syncUserScripts");
  assert.match(fn, /runAt:\s*meta\.runAt\.replace\(\/-\/g, "_"\)/);
});

test("syncUserScripts omits excludeMatches when meta.excludes is empty", () => {
  const fn = fnBody("syncUserScripts");
  assert.match(fn, /if \(meta\.excludes\.length\) reg\.excludeMatches = meta\.excludes/);
});

test("syncUserScripts verifies registration via getScripts and persists lastSync", () => {
  const fn = fnBody("syncUserScripts");
  assert.match(fn, /chrome\.userScripts\.getScripts\(\)/);
  assert.match(fn, /"userScripts\.lastSync"/);
  assert.match(fn, /liveIds:/);
  assert.match(fn, /skipped/);
});

test("configureUserScriptsWorld enables messaging in USER_SCRIPT world", () => {
  const fn = fnBody("configureUserScriptsWorld");
  assert.match(fn, /chrome\.userScripts\.configureWorld\(/);
  assert.match(fn, /messaging:\s*true/);
});

test("enableNavigationLogger is idempotent via navListenerWired guard", () => {
  const fn = fnBody("enableNavigationLogger");
  assert.match(fn, /if \(navListenerWired\) return/);
  assert.match(fn, /navListenerWired = true/);
});

test("enableNavigationLogger wires all three webNavigation phases", () => {
  const fn = fnBody("enableNavigationLogger");
  assert.match(fn, /onCommitted\.addListener\(\(details\) => handleNav\(details, "document-start"\)\)/);
  assert.match(fn, /onDOMContentLoaded\.addListener\(\(details\) => handleNav\(details, "document-end"\)\)/);
  assert.match(fn, /onCompleted\.addListener\(\(details\) => handleNav\(details, "document-idle"\)\)/);
});

test("handleNav ignores non-top frames (frameId !== 0)", () => {
  const fn = fnBody("handleNav");
  assert.match(fn, /if \(frameId !== 0\) return/);
});

test("handleNav ignores non-http(s)/file/ftp URLs", () => {
  const fn = fnBody("handleNav");
  assert.match(fn, /if \(!url \|\| !\/\^\(https\?\|file\|ftp\):\/i\.test\(url\)\) return/);
});

test("handleNav matches runAt phase before firing", () => {
  const fn = fnBody("handleNav");
  assert.match(fn, /if \(meta\.runAt !== phase\) continue/);
});

test("handleNav honors @exclude patterns after @match hit", () => {
  const fn = fnBody("handleNav");
  assert.match(fn, /if \(meta\.excludes\.length && matchUrl\(meta\.excludes, url\)\) continue/);
});

test("handleNav logs every matching script via appendFireLog", () => {
  const fn = fnBody("handleNav");
  assert.match(fn, /await appendFireLog\(\{/);
  assert.match(fn, /mode:\s*native \? "native" : "fallback"/);
  assert.match(fn, /phase/);
});

test("handleNav skips fallback injection when native chrome.userScripts is available", () => {
  const fn = fnBody("handleNav");
  assert.match(fn, /if \(native\) continue/);
});

test("handleNav fallback path injects via chrome.scripting.executeScript", () => {
  const fn = fnBody("handleNav");
  assert.match(fn, /chrome\.scripting\.executeScript/);
});

test("initUserscripts calls syncUserScripts then enableNavigationLogger", () => {
  const fn = fnBody("initUserscripts");
  assert.match(fn, /await syncUserScripts\(\)/);
  assert.match(fn, /enableNavigationLogger\(\)/);
});

test("writeScripts persists scripts then calls syncUserScripts", () => {
  const fn = fnBody("writeScripts");
  assert.match(fn, /chrome\.storage\.local\.set\(\{ \[SCRIPTS_KEY\]/);
  assert.match(fn, /await syncUserScripts\(\)/);
});

test("scripts.resync handler re-runs syncUserScripts", () => {
  const idx = bg.indexOf('msg?.kind === "scripts.resync"');
  assert.ok(idx >= 0);
  assert.match(bg.slice(idx, idx + 200), /syncUserScripts\(\)/);
});

test("scripts.delete removes per-script GM storage key", () => {
  const idx = bg.indexOf('msg?.kind === "scripts.delete"');
  assert.ok(idx >= 0);
  assert.match(bg.slice(idx, idx + 400), /chrome\.storage\.local\.remove\(GM_PREFIX \+ msg\.id\)/);
});

test("gm:fire handler merges beacon fields into appendFireLog", () => {
  const idx = bg.indexOf('msg?.kind === "gm:fire"');
  assert.ok(idx >= 0);
  const sec = bg.slice(idx, idx + 500);
  assert.match(sec, /appendFireLog\(\{/);
  assert.match(sec, /script:\s*msg\.script/);
  assert.match(sec, /mode:\s*"native"/);
});

test("syncUserScripts sets allFrames:false on registrations", () => {
  const fn = fnBody("syncUserScripts");
  assert.match(fn, /allFrames:\s*false/);
});

test("syncUserScripts uses userscriptId(meta) as registration id", () => {
  const fn = fnBody("syncUserScripts");
  assert.match(fn, /const id = userscriptId\(meta\)/);
});

test("handleNav uses expandMatchPatterns on base patterns before matchUrl", () => {
  const fn = fnBody("handleNav");
  assert.match(fn, /const patterns = expandMatchPatterns\(basePatterns\)/);
  assert.match(fn, /matchUrl\(patterns, url\)/);
});
