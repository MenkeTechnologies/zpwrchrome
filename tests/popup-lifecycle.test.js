// Popup bootstrap, escape handling, and module entry in popup.js.

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

test("popup calls refresh() at module load to bootstrap data", () => {
  assert.match(popup, /^refresh\(\);$/m);
});

test("popup state.firstRender starts true for JetBrains row selection", () => {
  assert.match(popup, /firstRender:\s*true/);
});

test("popup firstRender clears flag after initial row selection", () => {
  assert.match(popup, /state\.firstRender = false/);
});

test("popup Escape clears filter before closing window", () => {
  assert.match(keydown[0], /e\.key === "Escape"/);
  assert.match(keydown[0], /\$q\.value = ""; state\.filter = ""/);
  assert.match(keydown[0], /else window\.close\(\)/);
});

test("popup history delete updates local state without full refresh", () => {
  assert.match(popup, /state\.history\.filter\(\(h\) => h\.url !== t\.url\)/);
  assert.match(popup, /renderList\(\)/);
});

test("popup loadHistory sets historyLoaded flag when response arrives", () => {
  const fn = popup.match(/function loadHistory\(done\)[\s\S]*?\n\}/);
  assert.match(fn[0], /state\.historyLoaded = true/);
});

test("popup loadHistory invokes done callback after history arrives", () => {
  const fn = popup.match(/function loadHistory\(done\)[\s\S]*?\n\}/);
  assert.match(fn[0], /done\(\)/);
});

test("popup render() toggles killHeaviest visibility from proc.available", () => {
  const fn = popup.match(/function render\(\)[\s\S]*?\n\}/);
  assert.match(fn[0], /killBtn\.classList\.toggle\("hidden", !state\.proc\.available\)/);
});

test("popup render() calls renderCats then renderList", () => {
  const fn = popup.match(/function render\(\)[\s\S]*?\n\}/);
  assert.match(fn[0], /renderCats\(\)/);
  assert.match(fn[0], /renderList\(\)/);
});

test("popup activate history rows use chrome.tabs.create not background message", () => {
  const fn = popup.match(/function activate\(idx\)[\s\S]*?\n\}/);
  assert.match(fn[0], /chrome\.tabs\.create\(\{ url: t\.url, active: true \}/);
});

test("popup activate open tree minimap kinds all route through activate message", () => {
  const fn = popup.match(/function activate\(idx\)[\s\S]*?\n\}/);
  assert.match(fn[0], /"open", "tree", "minimap"/);
  assert.match(fn[0], /kind: "activate", tabId: t\.id/);
});

test("popup CATEGORIES array declares exactly 10 entries", () => {
  const matches = [...popup.matchAll(/\{\s*id:\s*"([a-z]+)"/g)];
  const catBlock = popup.match(/const CATEGORIES = \[([\s\S]*?)\];/);
  assert.ok(catBlock);
  const ids = [...catBlock[1].matchAll(/id:\s*"([a-z]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 10);
});

test("popup open-scripts click prevents default navigation on hash href", () => {
  assert.match(popup, /getElementById\("open-scripts"\)/);
  assert.match(popup, /e\.preventDefault\(\)/);
});

test("popup queries .search element for filter input at module scope", () => {
  assert.match(popup, /document\.querySelector\("\.search"\)/);
});

test("popup state.historyLoaded starts false before first fetch", () => {
  assert.match(popup, /historyLoaded:\s*false/);
});
