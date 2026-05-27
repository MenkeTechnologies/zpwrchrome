// Invariants for modal/content.template.js — the editable source of the
// in-page Recent Tabs overlay (built into modal/content.js).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const tmpl = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");

test("template is an IIFE with idempotent install guard", () => {
  assert.match(tmpl, /\(\(\) => \{/);
  assert.match(tmpl, /window\[MODAL_ID \+ "-installed"\]/);
  assert.match(tmpl, /if \(window\[MODAL_ID \+ "-installed"\]\) return/);
});

test("template declares build substitution markers for fonts, fzf, and util", () => {
  for (const m of ["%%STM%%", "%%ORB%%", "%%FZF%%", "%%UTIL%%"]) {
    assert.match(tmpl, new RegExp(m.replace(/%/g, "%")));
  }
});

test("template FONT_STM and FONT_ORB reference the substitution markers", () => {
  assert.match(tmpl, /const FONT_STM = "%%STM%%"/);
  assert.match(tmpl, /const FONT_ORB = "%%ORB%%"/);
});

test("template declares 10 categories matching popup.js", () => {
  const ids = ["all", "current", "pinned", "audible", "muted", "closed", "scenes", "tree", "minimap", "history"];
  for (const id of ids) {
    assert.match(tmpl, new RegExp(`id:\\s*"${id}"`), `missing category "${id}"`);
  }
});

test("template uses HISTORY_MAX_RESULTS = 5000", () => {
  assert.match(tmpl, /const HISTORY_MAX_RESULTS = 5000/);
});

test("template @font-face rules use data: URIs fed by FONT_STM / FONT_ORB", () => {
  assert.match(tmpl, /src: url\(data:font\/woff2;base64,\$\{FONT_STM\}\)/);
  assert.match(tmpl, /src: url\(data:font\/woff2;base64,\$\{FONT_ORB\}\)/);
});

test("template :host sets all:initial and font-family both !important", () => {
  assert.match(tmpl, /:host\s*\{[\s\S]*?all:\s*initial\s*!important/);
  assert.match(tmpl, /font-family:[^;]*!important/);
});

test("template currentList scores title and host separately with fzfMatch", () => {
  assert.match(tmpl, /const tm = fzfMatch\(state\.filter, titleText\)/);
  assert.match(tmpl, /const hm = fzfMatch\(state\.filter, hostText\)/);
  assert.match(tmpl, /_titleHl:/);
  assert.match(tmpl, /_hostHl:/);
});

test("template currentList uses frecency as fzf tiebreaker on history rows", () => {
  assert.match(tmpl, /frecency:\s*h\.frecency/);
  assert.match(tmpl, /\(b\.frecency \?\? 0\) - \(a\.frecency \?\? 0\)/);
});

test("template tree category bypasses fzf reshape (preserves opener order)", () => {
  assert.match(tmpl, /buildTabTree\(state\.mru\)/);
  assert.match(tmpl, /flattenTree\(roots, state\.collapsedTreeIds\)/);
  assert.match(tmpl, /kind: "tree"/);
});

test("template minimap category colors cells with domainHueFor", () => {
  assert.match(tmpl, /function renderMinimap\(/);
  assert.match(tmpl, /domainHueFor\(t\.url/);
  assert.match(tmpl, /hsl\(\$\{hue\},75%,45%\)/);
});

test("template scenes category uses substring filter (not fzf)", () => {
  assert.match(tmpl, /cat\.id === "scenes"/);
  assert.match(tmpl, /s\.name\.toLowerCase\(\)\.includes\(f\)/);
  assert.match(tmpl, /s\.slug\.includes\(f\)/);
});

test("template render() branches to renderMinimap for minimap category", () => {
  assert.match(tmpl, /if \(isMinimap\) \{ renderMinimap\(list, items\); return; \}/);
});

test("template scenes render injects scene-save-form with maxlength 48", () => {
  assert.match(tmpl, /class="scene-save-form"/);
  assert.match(tmpl, /maxlength="48"/);
  assert.match(tmpl, /scenes-save/);
});

test("template wireSceneForm stops keydown propagation on scene-name input", () => {
  assert.match(tmpl, /nameInput\.addEventListener\("keydown", \(e\) => e\.stopPropagation\(\)/);
});

test("template row() highlights fzf matches via highlightWithIndices", () => {
  assert.match(tmpl, /highlightWithIndices\(titleText, t\._titleHl, escapeHtml\)/);
  assert.match(tmpl, /highlightWithIndices\(host,      t\._hostHl,  escapeHtml\)/);
});

test("template row() renders tree toggle buttons for branches", () => {
  assert.match(tmpl, /class="tree-toggle"/);
  assert.match(tmpl, /data-tid="\$\{t\.id\}"/);
  assert.match(tmpl, /class="tree-toggle ghost"/);
});

test("template row() shows timeAgo badge on history rows", () => {
  assert.match(tmpl, /t\.kind === "history" && t\.lastVisitTime/);
  assert.match(tmpl, /timeAgo\(t\.lastVisitTime\)/);
});

test("template activate() routes closed tabs through restore message", () => {
  assert.match(tmpl, /t\.kind === "closed"/);
  assert.match(tmpl, /kind: "restore", sessionId: t\.sessionId/);
});

test("template activate() routes history rows through gm:openInTab", () => {
  assert.match(tmpl, /t\.kind === "history"/);
  assert.match(tmpl, /kind: "gm:openInTab"/);
});

test("template activate() swallows chrome.runtime.lastError on sendMessage", () => {
  assert.match(tmpl, /const swallow = \(\) => \{ void chrome\.runtime\.lastError; \}/);
});

test("template list fetch sends list then scenes-list then history-list", () => {
  assert.match(tmpl, /kind: "list"/);
  assert.match(tmpl, /kind: "scenes-list"/);
  assert.match(tmpl, /kind: "history-list", maxResults: HISTORY_MAX_RESULTS/);
});

test("template refresh on scenes-delete re-fetches list data", () => {
  assert.match(tmpl, /kind: "scenes-delete"/);
});

test("template mousemove guard uses 100ms threshold on mouseenter", () => {
  assert.match(tmpl, /state\.lastMouseMove = Date\.now\(\)/);
  assert.match(tmpl, /Date\.now\(\) - state\.lastMouseMove > 100/);
});

test("template favicon img hides itself on error (no broken-icon flash)", () => {
  assert.match(tmpl, /addEventListener\("error", \(\) => \{ img\.style\.visibility = "hidden"; \}/);
});

test("template scrollIntoView keeps selection visible after keyboard nav", () => {
  assert.match(tmpl, /scrollIntoView\(\{ block: "nearest" \}\)/);
});

test("template handleKey supports Cmd/Ctrl+0..9 category jumps (0 → History)", () => {
  assert.match(tmpl, /const idx = n === 0 \? 9 : n - 1/);
  assert.match(tmpl, /\[0-9\]/);
});

test("template handleKey supports tree collapse/expand on ArrowLeft/ArrowRight", () => {
  assert.match(tmpl, /CATEGORIES\[state\.catIdx\]\.id === "tree" && \(e\.key === "ArrowLeft" \|\| e\.key === "ArrowRight"\)/);
  assert.match(tmpl, /if \(cur && cur\._hasChildren\)/);
  assert.match(tmpl, /state\.collapsedTreeIds\.delete\(cur\.id\)/);
});

test("template handleKey deletes history URL via history-delete on Backspace", () => {
  assert.match(tmpl, /t\?\.kind === "history" && t\.url/);
  assert.match(tmpl, /kind: "history-delete", url/);
});

test("template handleKey closes open tab on Backspace/Delete when filter empty", () => {
  assert.match(tmpl, /kind: "close-tab", tabId: t\.id/);
});

test("template open-modal message handler focuses the focus-sink", () => {
  assert.match(tmpl, /msg\?\.kind === "open-modal"/);
  assert.match(tmpl, /sink\.focus\(\)/);
});

test("template close-modal message handler tears down the overlay", () => {
  assert.match(tmpl, /msg\?\.kind === "close-modal"/);
});

test("template header scripts link sends open-scripts-manager", () => {
  assert.match(tmpl, /kind: "open-scripts-manager"/);
});

test("template timeAgo formats seconds through weeks", () => {
  const fn = tmpl.match(/function timeAgo\(ms\)[\s\S]*?\n  \}/);
  assert.ok(fn);
  assert.match(fn[0], /sec < 60/);
  assert.match(fn[0], /604800/);
  assert.match(fn[0], /"w ago"/);
});

test("template escapeHtml neutralizes HTML metacharacters", () => {
  assert.match(tmpl, /"&": "&amp;"/);
  assert.match(tmpl, /"<": "&lt;"/);
});

test("template mm-cell click activates by data-idx", () => {
  assert.match(tmpl, /mm-cell[\s\S]*?activate\(Number\(el\.dataset\.idx\)\)/);
});

test("template state.firstRender selects row after active tab on first paint", () => {
  assert.match(tmpl, /firstRender/);
  assert.match(tmpl, /i >= 0 && i \+ 1 < items\.length \? i \+ 1 : 0/);
});
