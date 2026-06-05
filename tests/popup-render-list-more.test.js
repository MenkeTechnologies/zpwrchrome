// renderList row rendering, tree toggles, and interaction guards in popup.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");

const rlStart = popup.indexOf("function renderList()");
// fmtMb used to mark renderList's end; it got deleted with the
// chrome.processes integration. Next sibling function is loadPass().
const rlEnd = popup.indexOf("function loadPass(");
assert.ok(rlStart >= 0 && rlEnd > rlStart, "renderList missing");
const rl = popup.slice(rlStart, rlEnd);

test("renderList delegates minimap category to renderMinimap and returns early", () => {
  assert.match(rl, /if \(isMinimap\) \{[\s\S]*?renderMinimap\(items\)/);
  assert.match(rl, /return;\s*\}/);
});

test("renderList injects scene-save form only on scenes category", () => {
  assert.match(rl, /const saveForm = isScenes \?/);
  assert.match(rl, /class="scene-save-form"/);
  assert.match(rl, /maxlength="48"/);
});

test("renderList empty state shows no scenes saved yet on scenes category", () => {
  assert.match(rl, /isScenes \? "no scenes saved yet" : "no matches"/);
});

test("renderList clamps rowIdx into valid range after list shrink", () => {
  assert.match(rl, /if \(state\.rowIdx >= items\.length\) state\.rowIdx = items\.length - 1/);
  assert.match(rl, /if \(state\.rowIdx < 0\) state\.rowIdx = 0/);
});

test("renderList scene rows expose restore and delete badge buttons", () => {
  assert.match(rl, /class="badge scene-restore-btn"/);
  assert.match(rl, /class="badge scene-delete-btn"/);
  assert.match(rl, /data-slug="\$\{escapeHtml\(t\.slug\)\}"/);
});

test("renderList uses highlightWithIndices for fzf title and host when indices present", () => {
  assert.match(rl, /t\._titleHl\?\.length \? highlightWithIndices\(titleText, t\._titleHl, escapeHtml\)/);
  assert.match(rl, /t\._hostHl\?\.length\s+\? highlightWithIndices\(h,\s+t\._hostHl/);
});

test("renderList adds pinned audible and muted badge spans when tab flags set", () => {
  assert.match(rl, /if \(t\.pinned\)\s+badges\.push/);
  assert.match(rl, /if \(t\.audible\)\s+badges\.push/);
  assert.match(rl, /if \(t\.mutedInfo\?\.muted\)\s+badges\.push/);
});

test("renderList history rows show timeAgo badge from lastVisitTime", () => {
  assert.match(rl, /t\.kind === "history" && t\.lastVisitTime/);
  assert.match(rl, /timeAgo\(t\.lastVisitTime\)/);
});

test("renderList tree rows indent by depth and show expand collapse toggle", () => {
  assert.match(rl, /padding-left:\$\{8 \+ t\._depth \* 14\}px/);
  assert.match(rl, /class="tree-toggle"/);
  assert.match(rl, /t\._collapsed \? "expand" : "collapse"/);
});

test("renderList no longer renders proc column (chrome.processes removed)", () => {
  assert.doesNotMatch(rl, /state\.proc/);
  assert.doesNotMatch(rl, /fmtMb\(/);
  assert.doesNotMatch(rl, /class="proc-col"/);
});

test("renderList hides broken favicons on img error event", () => {
  assert.match(rl, /img\.addEventListener\("error", \(\) => \{ img\.style\.visibility = "hidden"; \}\)/);
});

test("renderList mouseenter ignores hover when mouse has not moved recently", () => {
  assert.match(rl, /if \(!state\.lastMouseMove \|\| Date\.now\(\) - state\.lastMouseMove > 100\) return/);
});

test("renderList row click skips activate when scene action buttons clicked", () => {
  assert.match(rl, /ev\.target\.closest\("\.scene-restore-btn"\)/);
  assert.match(rl, /ev\.target\.closest\("\.scene-delete-btn"\)/);
});

test("renderList scene restore button sends scenes-restore then closes popup", () => {
  assert.match(rl, /kind: "scenes-restore", slug: btn\.dataset\.slug/);
  assert.match(rl, /scenes-restore[\s\S]*?window\.close\(\)/);
});

test("renderList scene delete button sends scenes-delete then refreshes", () => {
  assert.match(rl, /kind: "scenes-delete", slug: btn\.dataset\.slug/);
  assert.match(rl, /scenes-delete[\s\S]*?refresh\)/);
});

test("renderList tree toggle stopPropagation prevents row activate", () => {
  assert.match(rl, /\.tree-toggle"\)\.forEach[\s\S]*?e\.stopPropagation\(\)/);
  assert.match(rl, /state\.collapsedTreeIds\.(add|delete)\(tid\)/);
});

test("renderList scrolls selected row into view with block nearest", () => {
  assert.match(rl, /sel\.scrollIntoView\(\{ block: "nearest" \}\)/);
});

test("renderList marks active tab row with active-tab class", () => {
  assert.match(rl, /\$\{t\.active \? " active-tab" : ""\}/);
});
