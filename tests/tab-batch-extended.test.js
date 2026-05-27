// Tab batch-operation helpers — extended static invariants.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

function fnSlice(name) {
  const start = bg.indexOf(`async function ${name}`);
  assert.ok(start >= 0, `${name} not found`);
  const next = bg.indexOf("\nasync function ", start + 1);
  return bg.slice(start, next >= 0 ? next : bg.length);
}

test("reloadAll uses Promise.all over tabs.reload", () => {
  const fn = fnSlice("reloadAll");
  assert.match(fn, /Promise\.all\(tabs\.map\(\(t\) => chrome\.tabs\.reload\(t\.id\)\)\)/);
});

test("reloadAll scopes query to currentWindow only", () => {
  const fn = fnSlice("reloadAll");
  assert.match(fn, /chrome\.tabs\.query\(\{ currentWindow: true \}\)/);
});

test("sortByUrl excludes pinned tabs from sort set", () => {
  const fn = fnSlice("sortByUrl");
  assert.match(fn, /pinned: false/);
});

test("sortByUrl uses localeCompare on url strings", () => {
  const fn = fnSlice("sortByUrl");
  assert.match(fn, /localeCompare\(b\.url/);
});

test("sortByUrl moves tabs sequentially starting at minimum index", () => {
  const fn = fnSlice("sortByUrl");
  assert.match(fn, /chrome\.tabs\.move\(sorted\[i\]\.id, \{ index: base \+ i \}\)/);
});

test("groupByDomain excludes pinned tabs from grouping", () => {
  const fn = fnSlice("groupByDomain");
  assert.match(fn, /pinned: false/);
});

test("groupByDomain creates tab groups with hostname title", () => {
  const fn = fnSlice("groupByDomain");
  assert.match(fn, /chrome\.tabGroups\.update\(groupId, \{ title: host, collapsed: false \}\)/);
});

test("groupByDomain buckets tab ids by hostnameOf(url)", () => {
  const fn = fnSlice("groupByDomain");
  assert.match(fn, /const h = hostnameOf\(t\.url\)/);
  assert.match(fn, /byHost\.get\(h\)\.push\(t\.id\)/);
});

test("closeDuplicates iterates tabs in window order for leftmost-wins", () => {
  const fn = fnSlice("closeDuplicates");
  assert.match(fn, /for \(const t of tabs\)/);
  assert.match(fn, /if \(seen\.has\(t\.url\)\) victims\.push/);
});

test("closeRight compares tab index against active tab index", () => {
  const fn = fnSlice("closeRight");
  assert.match(fn, /t\.index > active\.index/);
});

test("closeOthers builds victims list excluding active and pinned", () => {
  const fn = fnSlice("closeOthers");
  assert.match(fn, /!t\.active && !t\.pinned/);
});

test("restoreLastClosed handles both tab and window session entries", () => {
  const fn = fnSlice("restoreLastClosed");
  assert.match(fn, /if \(s\.tab\)/);
  assert.match(fn, /if \(s\.window\)/);
});

test("restoreLastClosed uses maxResults 1 for most recent only", () => {
  const fn = fnSlice("restoreLastClosed");
  assert.match(fn, /getRecentlyClosed\(\{ maxResults: 1 \}\)/);
});

test("jumpTo bails when resolveJumpIndex returns negative", () => {
  const fn = fnSlice("jumpTo");
  assert.match(fn, /if \(idx < 0\) return/);
});

test("writeClipboard targets active tab id for scripting injection", () => {
  const fn = fnSlice("writeClipboard");
  assert.match(fn, /target: \{ tabId: t\.id \}/);
});

test("writeClipboard uses isolated-world func injection for clipboard API", () => {
  const fn = fnSlice("writeClipboard");
  assert.match(fn, /func: \(s\) => navigator\.clipboard\.writeText\(s\)/);
});
