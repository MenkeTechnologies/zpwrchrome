// Popup UI invariants — static analysis of popup.js / popup.html / popup.css.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const popupJs  = read("popup.js");
const popupHtml = read("popup.html");
const popupCss = read("popup.css");

test("popup.js declares 10 categories with Cmd+1..0 shortcuts", () => {
  assert.match(popupJs, /const CATEGORIES = \[/);
  const ids = ["all", "current", "pinned", "audible", "muted", "closed", "scenes", "tree", "minimap", "history"];
  for (const id of ids) {
    assert.match(popupJs, new RegExp(`id:\\s*"${id}"`), `missing category "${id}"`);
  }
  for (const key of ["⌘1", "⌘2", "⌘3", "⌘4", "⌘5", "⌘6", "⌘7", "⌘8", "⌘9", "⌘0"]) {
    assert.match(popupJs, new RegExp(`key:\\s*"${key}"`), `missing shortcut ${key}`);
  }
});

test("popup.js imports fzf and util helpers as ES modules", () => {
  assert.match(popupJs, /import[\s\S]+from\s+"\.\/lib\/fzf\.js"/);
  assert.match(popupJs, /import[\s\S]+from\s+"\.\/lib\/util\.js"/);
});

test("popup.js uses HISTORY_MAX_RESULTS = 5000", () => {
  assert.match(popupJs, /const HISTORY_MAX_RESULTS = 5000/);
});

test("popup.js fetches history through background history-list", () => {
  assert.match(popupJs, /kind:\s*"history-list"/);
  assert.match(popupJs, /maxResults:\s*HISTORY_MAX_RESULTS/);
});

test("popup.js deletes history rows via history-delete message", () => {
  assert.match(popupJs, /kind:\s*"history-delete"/);
});

test("popup.js uses frecency as fzf tiebreaker when sorting history rows", () => {
  assert.match(popupJs, /frecency:\s*h\.frecency/);
  assert.match(popupJs, /\(b\.frecency \?\? 0\) - \(a\.frecency \?\? 0\)/);
});

test("popup.js tree category uses buildTabTree + flattenTree from util", () => {
  assert.match(popupJs, /buildTabTree\(state\.mru\)/);
  assert.match(popupJs, /flattenTree\(roots,\s*state\.collapsedTreeIds\)/);
});

test("popup.js minimap category colors rows with domainHueFor", () => {
  assert.match(popupJs, /domainHueFor\(/);
});

test("popup.js highlights fzf matches via highlightWithIndices", () => {
  assert.match(popupJs, /highlightWithIndices\(/);
});

test("popup.js gates mouseenter hover on recent mousemove (scroll fix)", () => {
  assert.match(popupJs, /addEventListener\("mousemove"[\s\S]{0,200}lastMouseMove/);
  assert.match(popupJs, /Date\.now\(\)\s*-\s*state\.lastMouseMove\s*>\s*\d+/);
});

test("popup.js first-render selects the row after the active tab", () => {
  assert.match(popupJs, /firstRender:\s*true/);
  assert.match(popupJs, /findIndex\(\(t\) => t\.active\)/);
});

test("popup.js sends list/activate/restore/close-tab messages", () => {
  for (const kind of ["list", "activate", "restore", "close-tab"]) {
    assert.match(popupJs, new RegExp(`kind:\\s*"${kind}"`), `popup must send "${kind}"`);
  }
});

test("popup.js scene restore sends scenes-restore with slug", () => {
  assert.match(popupJs, /kind:\s*"scenes-restore"/);
  assert.match(popupJs, /slug:/);
});

test("popup.js scene save sends scenes-save with a name", () => {
  assert.match(popupJs, /kind:\s*"scenes-save"/);
});

test("popup.html has no inline event handlers (MV3 CSP)", () => {
  const inline = /\bon(click|change|input|error|load|submit|keydown|mouseover|mouseenter|focus|blur)\s*=/i;
  assert.ok(!inline.test(popupHtml), "popup.html must not use inline event handlers");
});

test("popup.html loads popup.js as an ES module", () => {
  assert.match(popupHtml, /<script[^>]+src="popup\.js"[^>]+type="module"/);
});

test("popup.html declares search input and category/list containers", () => {
  assert.match(popupHtml, /class="search"/);
  assert.match(popupHtml, /id="cats"/);
  assert.match(popupHtml, /id="list"/);
});

test("popup.css defines strykelang palette CSS variables", () => {
  for (const v of ["--cyan", "--accent", "--magenta", "--bg-primary", "--bg-secondary"]) {
    assert.match(popupCss, new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("popup.css styles fzf highlights", () => {
  assert.match(popupCss, /\.fzf-hl/);
});

test("popup.js chrome.runtime.sendMessage calls use a callback", () => {
  const re = /chrome\.runtime\.sendMessage\(/g;
  let m;
  while ((m = re.exec(popupJs)) !== null) {
    const tail = popupJs.slice(m.index, m.index + 600);
    assert.match(tail, /,\s*\([^)]*\)\s*=>|,\s*function|,\s*\w+\s*\)/,
      `sendMessage near char ${m.index} must pass a callback`);
  }
});
