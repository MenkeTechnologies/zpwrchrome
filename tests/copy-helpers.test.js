// Clipboard copy helpers in background.js dispatch table.

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

test("writeClipboard requires an active tab id from getActive", () => {
  const fn = fnBody("writeClipboard");
  assert.match(fn, /const t = await getActive\(\)/);
  assert.match(fn, /if \(!t\?\.id\) return/);
});

test("writeClipboard injects navigator.clipboard.writeText into active page", () => {
  const fn = fnBody("writeClipboard");
  assert.match(fn, /navigator\.clipboard\.writeText\(s\)/);
  assert.match(fn, /chrome\.scripting\.executeScript/);
});

test("writeClipboard targets active tab only (not all frames)", () => {
  const fn = fnBody("writeClipboard");
  assert.match(fn, /target: \{ tabId: t\.id \}/);
});

test("writeClipboard swallows executeScript failures on protected pages", () => {
  const fn = fnBody("writeClipboard");
  assert.match(fn, /catch \{/);
});

test("copyActiveUrl writes tab url via writeClipboard", () => {
  const fn = fnBody("copyActiveUrl");
  assert.match(fn, /if \(t\?\.url\) await writeClipboard\(t\.url\)/);
});

test("copyActiveTitleMd formats markdown link with title fallback to url", () => {
  const fn = fnBody("copyActiveTitleMd");
  assert.match(fn, /`\[\$\{t\.title \|\| t\.url\}\]\(\$\{t\.url\}\)`/);
});

test("copyActiveTitleMd skips when url is missing", () => {
  const fn = fnBody("copyActiveTitleMd");
  assert.match(fn, /if \(t\?\.url\) await writeClipboard/);
});

test("bookmarkActive creates bookmark with title fallback to url", () => {
  const fn = fnBody("bookmarkActive");
  assert.match(fn, /chrome\.bookmarks\.create\(\{ title: t\.title \|\| t\.url, url: t\.url \}\)/);
});

test("bookmarkActive returns early when active tab has no url", () => {
  const fn = fnBody("bookmarkActive");
  assert.match(fn, /if \(!t\?\.url\) return/);
});

test("dispatch copy-url routes to copyActiveUrl", () => {
  assert.match(bg, /command === "copy-url"\)[\s\S]*?copyActiveUrl\(\)/);
});

test("dispatch copy-title-md routes to copyActiveTitleMd", () => {
  assert.match(bg, /command === "copy-title-md"\)[\s\S]*?copyActiveTitleMd\(\)/);
});

test("dispatch bookmark-tab routes to bookmarkActive", () => {
  assert.match(bg, /command === "bookmark-tab"\)[\s\S]*?bookmarkActive\(\)/);
});

test("manifest declares clipboardWrite permission for writeClipboard path", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  assert.ok(manifest.permissions.includes("clipboardWrite"));
});

test("manifest declares bookmarks permission for bookmarkActive", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  assert.ok(manifest.permissions.includes("bookmarks"));
});
