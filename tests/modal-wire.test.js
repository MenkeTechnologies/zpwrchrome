// modal/content.template.js wire() and focus-management invariants.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const tmpl = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");

const wireFn = tmpl.match(/function wire\(\)[\s\S]*?\n  \}/);
assert.ok(wireFn, "wire() missing");

test("modal visible search input is readOnly with pointer-events disabled", () => {
  assert.match(wireFn[0], /search\.readOnly = true/);
  assert.match(wireFn[0], /search\.style\.pointerEvents = "none"/);
});

test("modal search input uses tabIndex -1 (focus stays on sink)", () => {
  assert.match(wireFn[0], /search\.tabIndex = -1/);
});

test("modal category click resets rowIdx and refocuses sink", () => {
  assert.match(wireFn[0], /state\.rowIdx = 0/);
  assert.match(wireFn[0], /sink\.focus\(\)/);
});

test("modal overlay mousedown on backdrop closes modal", () => {
  assert.match(wireFn[0], /overlay"\)\.addEventListener\("mousedown"/);
  assert.match(wireFn[0], /if \(e\.target === e\.currentTarget\) closeModal\(\)/);
});

test("modal scripts link sends open-scripts-manager then closes", () => {
  assert.match(wireFn[0], /kind: "open-scripts-manager"/);
  assert.match(wireFn[0], /closeModal\(\)/);
});

test("modal scripts link swallows chrome.runtime.lastError", () => {
  assert.match(wireFn[0], /void chrome\.runtime\.lastError/);
});

test("modal focusin handler pulls focus back to sink via queueMicrotask", () => {
  assert.match(wireFn[0], /document\.addEventListener\("focusin", state\.fi, true\)/);
  assert.match(wireFn[0], /queueMicrotask\(\(\) => \{ if \(state\) state\.sink\.focus\(\)/);
});

test("modal wire() focuses sink after short timeout on open", () => {
  assert.match(wireFn[0], /setTimeout\(\(\) => sink\.focus\(\), 0\)/);
});

test("modal MODAL_ID guards double-install via window flag", () => {
  assert.match(tmpl, /MODAL_ID/);
  assert.match(tmpl, /"-installed"/);
});

test("modal host element is appended to documentElement", () => {
  assert.match(tmpl, /document\.documentElement\.appendChild\(host\)/);
});

test("modal shadow root receives inlined CSS plus html template", () => {
  assert.match(tmpl, /shadow\.innerHTML = `<style>\$\{CSS\}<\/style>` \+ html\(\)/);
});

test("modal render() toggles category selection and repaints list", () => {
  const fn = tmpl.match(/function render\(\)[\s\S]*?\n  \}/);
  assert.match(fn[0], /shadow\.querySelectorAll\("\.cat"\)/);
  assert.match(fn[0], /const list = shadow\.querySelector\("\.list"\)/);
  assert.match(fn[0], /const items = currentList\(\)/);
});

test("modal renderList branches to renderMinimap for minimap category", () => {
  assert.match(tmpl, /if \(isMinimap\) \{ renderMinimap\(list, items\); return; \}/);
});

test("modal activate closes modal after dispatching tab action", () => {
  const fn = tmpl.match(/function activate\(idx\)[\s\S]*?\n  \}/);
  assert.match(fn[0], /closeModal\(\)/);
});

test("modal cycle() wraps rowIdx modulo list length", () => {
  const fn = tmpl.match(/function cycle\(delta\)[\s\S]*?\n  \}/);
  assert.match(fn[0], /\(state\.rowIdx \+ delta \+ items\.length\) % items\.length/);
});

test("modal setFilter resets rowIdx to 0", () => {
  const fn = tmpl.match(/function setFilter\(next\)[\s\S]*?\n  \}/);
  assert.match(fn[0], /state\.rowIdx = 0/);
});

test("modal hostOf helper extracts hostname for fzf host scoring", () => {
  assert.match(tmpl, /function hostOf\(url\)/);
  assert.match(tmpl, /new URL\(url\)\.hostname/);
});

test("modal closed category maps session tabs with kind closed", () => {
  assert.match(tmpl, /kind: "closed", sessionId:/);
});

test("modal history rows carry frecency for fzf tiebreaker", () => {
  assert.match(tmpl, /frecency: h\.frecency/);
});

test("modal scene restore/delete buttons send scenes-restore and scenes-delete", () => {
  assert.match(tmpl, /kind: "scenes-restore", slug:/);
  assert.match(tmpl, /kind: "scenes-delete", slug:/);
});
