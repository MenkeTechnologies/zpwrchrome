// chrome.sessions restore helpers and list closed payload in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");

function fnBody(name) {
  const m = bg.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} not found`);
  return m[0];
}

test("restoreLastClosed fetches only the single most recent closed session", () => {
  const fn = fnBody("restoreLastClosed");
  assert.match(fn, /getRecentlyClosed\(\{ maxResults: 1 \}\)/);
});

test("restoreLastClosed restores tab session when entry has tab", () => {
  const fn = fnBody("restoreLastClosed");
  assert.match(fn, /if \(s\.tab\)[\s\S]*?chrome\.sessions\.restore\(s\.tab\.sessionId\)/);
});

test("restoreLastClosed restores window session when entry has window", () => {
  const fn = fnBody("restoreLastClosed");
  assert.match(fn, /if \(s\.window\)[\s\S]*?chrome\.sessions\.restore\(s\.window\.sessionId\)/);
});

test("restoreLastClosed returns early when no recently closed sessions", () => {
  const fn = fnBody("restoreLastClosed");
  assert.match(fn, /if \(!s\) return/);
});

test("list handler includes recently closed in parallel fetch", () => {
  const idx = bg.indexOf('msg?.kind === "list"');
  const sec = bg.slice(idx, idx + 700);
  assert.match(sec, /getRecentlyClosed\(\{ maxResults: 25 \}\)/);
});

test("restore handler calls chrome.sessions.restore with msg.sessionId", () => {
  const idx = bg.indexOf('msg?.kind === "restore"');
  const sec = bg.slice(idx, idx + 400);
  assert.match(sec, /chrome\.sessions\.restore\(msg\.sessionId\)/);
});

test("popup maps closed sessions extracting tab or window first tab", () => {
  assert.match(popup, /s\.tab \|\| s\.window\?\.tabs\?\.\[0\]/);
});

test("popup closed rows carry sessionId from tab or window session", () => {
  assert.match(popup, /sessionId: s\.tab\?\.sessionId \|\| s\.window\?\.sessionId/);
});

test("popup activate closed kind sends restore with sessionId", () => {
  const fn = popup.match(/function activate\(idx\)[\s\S]*?\n\}/);
  assert.match(fn[0], /t\.kind === "closed"/);
  assert.match(fn[0], /kind: "restore", sessionId: t\.sessionId/);
});

test("manifest declares sessions permission for restore feature", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  assert.ok(manifest.permissions.includes("sessions"));
});

test("switchPreviousTab reads MRU directly (no sessions.restore call)", () => {
  // After the Cmd+E flake fix we walk the MRU in a for…of loop instead of
  // delegating to mruPrevious. The negative assertion (no sessions.restore)
  // is the load-bearing one — restoreLastClosed handles that path.
  const fn = fnBody("switchPreviousTab");
  assert.match(fn, /await readMru\(\)/);
  assert.match(fn, /for \(const id of mru\)/);
  assert.ok(!fn.includes("sessions.restore"));
});

test("popup closed category id is closed in CATEGORIES", () => {
  assert.match(popup, /id: "closed",\s*label: "Recently Closed"/);
});

test("modal template also declares closed category", () => {
  const modal = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");
  assert.match(modal, /id: "closed",\s*label: "Recently Closed"/);
});

test("list response closed array passed through unchanged to popup", () => {
  const idx = bg.indexOf('msg?.kind === "list"');
  const sec = bg.slice(idx, idx + 700);
  assert.match(sec, /sendResponse\(\{ mru: mruTabs, closed \}\)/);
});
