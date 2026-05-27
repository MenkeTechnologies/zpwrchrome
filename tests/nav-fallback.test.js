// handleNav fallback injection path and fire-log contracts in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

const start = bg.indexOf("async function handleNav");
const end = bg.indexOf("// Popup data API");
const fn = bg.slice(start, end);
assert.ok(start >= 0 && end > start, "handleNav body not found");

test("handleNav returns immediately when tabId is not a non-negative number", () => {
  assert.match(fn, /if \(typeof tabId !== "number" \|\| tabId < 0\) return/);
});

test("handleNav rejects chrome-extension and about: URLs", () => {
  assert.match(fn, /if \(!url \|\| !\/\^\(https\?\|file\|ftp\):\/i\.test\(url\)\) return/);
});

test("handleNav ignores iframe navigations (frameId !== 0)", () => {
  assert.match(fn, /if \(frameId !== 0\) return/);
});

test("handleNav bails when no saved scripts exist", () => {
  assert.match(fn, /if \(!scripts\.length\) return/);
});

test("handleNav skips disabled scripts", () => {
  assert.match(fn, /if \(!s\.enabled\) continue/);
});

test("handleNav skips scripts whose metadata block fails to parse", () => {
  assert.match(fn, /if \(!meta\) continue/);
});

test("handleNav matches runAt phase before evaluating URL patterns", () => {
  assert.match(fn, /if \(meta\.runAt !== phase\) continue/);
});

test("handleNav falls back to @include patterns when @match is empty", () => {
  assert.match(fn, /meta\.matches\.length[\s\S]*?meta\.includes\.map\(includeToMatchPattern\)/);
});

test("handleNav expands bare-host @match patterns before matchUrl", () => {
  assert.match(fn, /const patterns = expandMatchPatterns\(basePatterns\)/);
});

test("handleNav skips URL when @exclude patterns match", () => {
  assert.match(fn, /if \(meta\.excludes\.length && matchUrl\(meta\.excludes, url\)\) continue/);
});

test("handleNav appendFireLog records native vs fallback mode label", () => {
  assert.match(fn, /mode:\s*native \? "native" : "fallback"/);
});

test("handleNav native mode skips chrome.scripting injection", () => {
  assert.match(fn, /if \(native\) continue/);
});

test("handleNav fallback requires chrome.scripting API", () => {
  assert.match(fn, /if \(!chrome\.scripting\) continue/);
});

test("handleNav fallback inject uses ISOLATED world", () => {
  assert.match(fn, /world: "ISOLATED"/);
});

test("handleNav fallback sets injectImmediately only for document-start", () => {
  assert.match(fn, /injectImmediately: phase === "document-start"/);
});

test("handleNav fallback executes wrapped code via new Function inside page", () => {
  assert.match(fn, /try \{ \(new Function\(src\)\)\(\); \}/);
});

test("handleNav fallback silently skips chrome:// and web store injection errors", () => {
  assert.ok(fn.includes("Cannot access"));
  assert.ok(fn.includes("chromewebstore"));
});

test("handleNav fallback logs non-restricted injection failures to console.warn", () => {
  assert.match(fn, /console\.warn\("\[zpwrchrome\] fallback inject failed for"/);
});

test("enableNavigationLogger is idempotent via navListenerWired guard", () => {
  assert.match(bg, /let navListenerWired = false/);
  assert.match(bg, /if \(navListenerWired\) return/);
  assert.match(bg, /navListenerWired = true/);
});

test("initUserscripts always calls enableNavigationLogger after syncUserScripts", () => {
  const init = bg.match(/async function initUserscripts\([\s\S]*?\n\}/);
  assert.ok(init);
  assert.match(init[0], /await syncUserScripts\(\)/);
  assert.match(init[0], /enableNavigationLogger\(\)/);
});
