// currentList category filtering and fzf scoring invariants in popup.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");

const currentListFn = popup.match(/function currentList\(\)[\s\S]*?\n\}/);
assert.ok(currentListFn, "currentList function missing");

test("popup currentList maps closed sessions to kind:closed with sessionId", () => {
  assert.match(currentListFn[0], /cat\.id === "closed"/);
  assert.match(currentListFn[0], /kind: "closed", sessionId:/);
});

test("popup currentList scenes category uses substring filter not fzf", () => {
  assert.match(currentListFn[0], /cat\.id === "scenes"/);
  assert.match(currentListFn[0], /s\.name\.toLowerCase\(\)\.includes\(f\) \|\| s\.slug\.includes\(f\)/);
  assert.match(currentListFn[0], /kind: "scene"/);
});

test("popup currentList tree category preserves opener order via flattenTree", () => {
  assert.match(currentListFn[0], /buildTabTree\(state\.mru\)/);
  assert.match(currentListFn[0], /flattenTree\(roots, state\.collapsedTreeIds\)/);
  assert.match(currentListFn[0], /kind: "tree"/);
});

test("popup currentList history rows carry frecency from background handler", () => {
  assert.match(currentListFn[0], /frecency: h\.frecency/);
});

test("popup currentList minimap category tags rows kind:minimap", () => {
  assert.match(currentListFn[0], /cat\.id === "minimap"/);
  assert.match(currentListFn[0], /kind: "minimap"/);
});

test("popup currentList current-window filter uses state.currentWindowId", () => {
  assert.match(currentListFn[0], /cat\.id === "current"\)[\s\S]*?t\.windowId === state\.currentWindowId/);
});

test("popup currentList pinned filter checks t.pinned", () => {
  assert.match(currentListFn[0], /cat\.id === "pinned"\)[\s\S]*?t\.pinned/);
});

test("popup currentList audible filter checks t.audible", () => {
  assert.match(currentListFn[0], /cat\.id === "audible"\)[\s\S]*?t\.audible/);
});

test("popup currentList muted filter checks mutedInfo.muted", () => {
  assert.match(currentListFn[0], /cat\.id === "muted"\)[\s\S]*?t\.mutedInfo\?\.muted/);
});

test("popup currentList fzf scores both title and hostname separately", () => {
  assert.match(currentListFn[0], /fzfMatch\(state\.filter, titleText\)/);
  assert.match(currentListFn[0], /fzfMatch\(state\.filter, hostText\)/);
});

test("popup currentList fzf tiebreaker prefers higher frecency on history rows", () => {
  assert.match(currentListFn[0], /\(b\._score - a\._score\) \|\| \(\(b\.frecency \?\? 0\) - \(a\.frecency \?\? 0\)\)/);
});

test("popup currentList stores _titleHl and _hostHl index arrays on scored rows", () => {
  assert.match(currentListFn[0], /_titleHl: tm\?\.indices \|\| \[\]/);
  assert.match(currentListFn[0], /_hostHl:\s*hm\?\.indices \|\| \[\]/);
});

test("popup currentList skips fzf pass when filter is empty", () => {
  assert.match(currentListFn[0], /if \(!state\.filter\) return items/);
});

test("popup currentList default branch tags open tabs kind:open", () => {
  assert.match(currentListFn[0], /kind: "open"/);
});

test("popup HISTORY_MAX_RESULTS is 5000", () => {
  assert.match(popup, /const HISTORY_MAX_RESULTS = 5000/);
});

test("popup CATEGORIES defines exactly 11 entries", () => {
  const m = popup.match(/const CATEGORIES = \[([\s\S]*?)\];/);
  assert.ok(m);
  const ids = [...m[1].matchAll(/id: "([^"]+)"/g)].map((x) => x[1]);
  assert.equal(ids.length, 11);
  assert.deepEqual(ids, [
    "all", "current", "pinned", "audible", "muted",
    "closed", "scenes", "tree", "minimap", "history",
    "pass"
  ]);
});

test("popup renderList mouseenter ignores scroll-induced hover without recent mousemove", () => {
  assert.match(popup, /state\.lastMouseMove/);
  assert.match(popup, /Date\.now\(\) - state\.lastMouseMove > 100/);
});

test("popup renderList scrolls selected row into view with block:nearest", () => {
  assert.match(popup, /sel\.scrollIntoView\(\{ block: "nearest" \}\)/);
});
