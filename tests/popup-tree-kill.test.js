// popup tree keyboard nav and kill-heaviest button in popup.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");

const keydown = popup.match(/document\.addEventListener\("keydown",[\s\S]*?\n\}\);/);
assert.ok(keydown, "keydown handler missing");

test("popup tree category ArrowLeft collapses branch with children", () => {
  assert.match(keydown[0], /CATEGORIES\[state\.catIdx\]\.id === "tree"/);
  assert.match(keydown[0], /e\.key === "ArrowLeft"\)[\s\S]*?state\.collapsedTreeIds\.add\(cur\.id\)/);
});

test("popup tree category ArrowRight expands collapsed branch", () => {
  assert.match(keydown[0], /e\.key === "ArrowRight"\)[\s\S]*?state\.collapsedTreeIds\.delete\(cur\.id\)/);
});

test("popup tree arrow keys only apply when current row has children", () => {
  assert.match(keydown[0], /if \(cur && cur\._hasChildren\)/);
});

test("popup tree arrow keys call renderList not full render", () => {
  assert.match(keydown[0], /state\.collapsedTreeIds\.(add|delete)[\s\S]*?renderList\(\)/);
});

test("popup search input resets rowIdx to zero on filter change", () => {
  assert.match(popup, /\$q\.addEventListener\("input"/);
  assert.match(popup, /state\.filter = e\.target\.value/);
  assert.match(popup, /state\.rowIdx = 0/);
});

test("popup search input calls renderList not renderCats", () => {
  assert.match(popup, /state\.filter = e\.target\.value[\s\S]*?renderList\(\)/);
});

test("popup killHeaviest button sends kill-heaviest message kind", () => {
  assert.match(popup, /getElementById\("killHeaviest"\)/);
  assert.match(popup, /kind: "kill-heaviest"/);
});

test("popup killHeaviest alerts when background returns ok:false", () => {
  assert.match(popup, /if \(!r\?\.ok\) alert\("kill-heaviest: " \+ \(r\?\.error \|\| "no candidate"\)\)/);
});

test("popup killHeaviest refreshes list after attempt", () => {
  assert.match(popup, /kill-heaviest[\s\S]*?refresh\(\)/);
});

test("popup render toggles killHeaviest button visibility from proc.available", () => {
  const renderFn = popup.match(/function render\(\)[\s\S]*?\n\}/);
  assert.match(renderFn[0], /killBtn\.classList\.toggle\("hidden", !state\.proc\.available\)/);
});

test("popup state.collapsedTreeIds initialized as empty Set", () => {
  assert.match(popup, /collapsedTreeIds: new Set\(\)/);
});

test("popup host() helper returns empty string on invalid URL", () => {
  assert.match(popup, /function host\(u\) \{ try \{ return new URL\(u\)\.hostname; \} catch \{ return ""; \} \}/);
});

test("popup cycle wraps rowIdx modulo list length", () => {
  const cycle = popup.match(/function cycle\(delta\)[\s\S]*?\n\}/);
  assert.match(cycle[0], /state\.rowIdx = \(state\.rowIdx \+ delta \+ items\.length\) % items\.length/);
});

test("popup activate history kind opens new tab instead of sendMessage activate", () => {
  const act = popup.match(/function activate\(idx\)[\s\S]*?\n\}/);
  assert.match(act[0], /t\.kind === "history"/);
  assert.match(act[0], /chrome\.tabs\.create\(\{ url: t\.url, active: true \}/);
});
