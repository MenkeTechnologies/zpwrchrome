// popup.js renderList/renderCats/scene-row invariants.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");

const renderList = popup.match(/function renderList\(\)[\s\S]*?\n\}/);
assert.ok(renderList, "renderList missing");

test("popup renderList delegates minimap category to renderMinimap", () => {
  assert.match(renderList[0], /if \(isMinimap\) \{[\s\S]*?renderMinimap\(items\)/);
});

test("popup renderList shows scene-save form only in scenes category", () => {
  assert.match(renderList[0], /const isScenes\s+= cat\.id === "scenes"/);
  assert.match(renderList[0], /class="scene-save-form"/);
});

test("popup renderList scene rows use scene-glyph and slug data attribute", () => {
  assert.match(renderList[0], /class="favicon scene-glyph">⌬/);
  assert.match(renderList[0], /data-kind="scene" data-slug=/);
});

test("popup renderList scene rows expose restore and delete buttons", () => {
  assert.match(renderList[0], /scene-restore-btn/);
  assert.match(renderList[0], /scene-delete-btn/);
});

test("popup renderList empty scenes state says no scenes saved yet", () => {
  assert.match(renderList[0], /isScenes \? "no scenes saved yet" : "no matches"/);
});

test("popup renderList marks active tab row with active-tab class", () => {
  assert.match(renderList[0], /t\.active \? " active-tab" : ""/);
});

test("popup renderList tree rows indent by 14px per depth level", () => {
  assert.match(renderList[0], /padding-left:\$\{8 \+ t\._depth \* 14\}px/);
});

test("popup renderList tree toggle shows collapse/expand chevrons", () => {
  assert.match(renderList[0], /t\._collapsed \? "▶" : "▼"/);
});

test("popup renderList hides broken favicons on img error", () => {
  assert.match(renderList[0], /addEventListener\("error", \(\) => \{ img\.style\.visibility = "hidden"/);
});

test("popup renderList row click ignores scene button targets", () => {
  assert.match(renderList[0], /ev\.target\.closest\("\.scene-restore-btn"\)/);
  assert.match(renderList[0], /ev\.target\.closest\("\.scene-delete-btn"\)/);
});

test("popup renderList tree-toggle click stops propagation", () => {
  assert.match(renderList[0], /e\.stopPropagation\(\)/);
});

test("popup renderCats renders category label and shortcut key", () => {
  const fn = popup.match(/function renderCats\(\)[\s\S]*?\n\}/);
  assert.match(fn[0], /\$\{c\.label\}/);
  assert.match(fn[0], /\$\{c\.key\}/);
});

test("popup renderCats highlights selected category with sel class", () => {
  const fn = popup.match(/function renderCats\(\)[\s\S]*?\n\}/);
  assert.match(fn[0], /i === state\.catIdx \? " sel" : ""/);
});

test("popup wireSceneForm rejects empty trimmed name", () => {
  const fn = popup.match(/function wireSceneForm\(\)[\s\S]*?\n\}/);
  assert.match(fn[0], /if \(!name\) \{ status\.textContent = "name required"/);
});

test("popup wireSceneForm clears name input after successful save", () => {
  const fn = popup.match(/function wireSceneForm\(\)[\s\S]*?\n\}/);
  assert.match(fn[0], /nameInput\.value = ""/);
});

test("popup wireSceneForm Enter key submits without bubbling", () => {
  const fn = popup.match(/function wireSceneForm\(\)[\s\S]*?\n\}/);
  assert.match(fn[0], /e\.key === "Enter"\)[\s\S]*?e\.preventDefault\(\); submit\(\)/);
});

test("popup scene name input maxlength is 48 (matches buildScene cap)", () => {
  assert.match(renderList[0], /maxlength="48"/);
});

test("popup fmtMb is removed (chrome.processes integration gone — see processes-handlers.test.js)", () => {
  assert.doesNotMatch(popup, /\bfunction fmtMb\(/);
});

test("popup closed tab rows carry sessionId from tab or window session", () => {
  assert.match(popup, /sessionId: s\.tab\?\.sessionId \|\| s\.window\?\.sessionId/);
});

test("popup history activate opens URL in new tab via chrome.tabs.create", () => {
  const fn = popup.match(/function activate\(idx\)[\s\S]*?\n\}/);
  assert.match(fn[0], /t\.kind === "history"/);
  assert.match(fn[0], /chrome\.tabs\.create\(\{ url: t\.url, active: true \}/);
});

test("popup renderList wires scene form after empty scenes list too", () => {
  assert.match(renderList[0], /if \(isScenes\) wireSceneForm\(\)/);
});
