// Modal content-script UX invariants — hold-cycle, focus sink, keyboard capture.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const tmpl = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");

test("modal template is wrapped in an IIFE with install guard", () => {
  assert.match(tmpl, /\(\(\) => \{/);
  assert.match(tmpl, /window\[MODAL_ID \+ "-installed"\]/);
});

test("modal openModal re-entrant call cycles forward instead of double-installing", () => {
  const fn = tmpl.match(/function openModal\(\)[\s\S]*?\n  \}/);
  assert.ok(fn);
  assert.match(fn[0], /if \(state\) \{[\s\S]*?cycle\(\+1\)/);
});

test("modal attaches closed shadow root for CSS isolation", () => {
  assert.match(tmpl, /attachShadow\(\{\s*mode:\s*"closed"\s*\}\)/);
});

test("modal creates Vimium-bypass focus sink input outside shadow DOM", () => {
  assert.match(tmpl, /Focus sink/);
  assert.match(tmpl, /document\.createElement\("input"\)/);
  assert.match(tmpl, /sink\.id = MODAL_ID \+ "-sink"/);
  assert.match(tmpl, /pointer-events:none/);
});

test("modal wire() registers keydown/keyup listeners in capture phase", () => {
  assert.match(tmpl, /window\.addEventListener\("keydown",\s*state\.kd, true\)/);
  assert.match(tmpl, /window\.addEventListener\("keyup",\s*state\.ku, true\)/);
});

test("modal handleKey ignores bare modifier key presses", () => {
  const fn = tmpl.match(/function handleKey\(e\)[\s\S]*?\n  \}/);
  assert.match(fn[0], /e\.key === "Shift"/);
  assert.match(fn[0], /e\.key === "Meta"/);
});

test("modal Cmd/Ctrl+E cycles MRU forward; Shift reverses direction", () => {
  const fn = tmpl.match(/function handleKey\(e\)[\s\S]*?\n  \}/);
  assert.match(fn[0], /e\.key === "e" \|\| e\.key === "E"/);
  assert.match(fn[0], /cycle\(e\.shiftKey \? -1 : \+1\)/);
});

test("modal handleKey stops propagation for owned keys (Vimium guard)", () => {
  const fn = tmpl.match(/function handleKey\(e\)[\s\S]*?\n  \}/);
  assert.match(fn[0], /e\.stopImmediatePropagation\(\)/);
});

test("modal handleKey lets Cmd+C and other modifier combos pass through", () => {
  const fn = tmpl.match(/function handleKey\(e\)[\s\S]*?\n  \}/);
  assert.match(fn[0], /if \(e\.metaKey \|\| e\.ctrlKey\) return;/);
});

test("modal Escape closes via closeModal()", () => {
  const fn = tmpl.match(/function handleKey\(e\)[\s\S]*?\n  \}/);
  assert.match(fn[0], /e\.key === "Escape"[\s\S]*?closeModal\(\)/);
});

test("modal Backspace trims filter before acting on row", () => {
  const fn = tmpl.match(/function handleKey\(e\)[\s\S]*?\n  \}/);
  assert.match(fn[0], /if \(state\.filter\.length > 0\)/);
  assert.match(fn[0], /setFilter\(state\.filter\.slice\(0, -1\)\)/);
});

test("modal history rows open via gm:openInTab (content script cannot tabs.create)", () => {
  const fn = tmpl.match(/function activate\(idx\)[\s\S]*?\n  \}/);
  assert.match(fn[0], /t\.kind === "history"/);
  assert.match(fn[0], /kind: "gm:openInTab", url: t\.url, active: true/);
});

test("modal activate swallows chrome.runtime.lastError in callback", () => {
  const fn = tmpl.match(/function activate\(idx\)[\s\S]*?\n  \}/);
  assert.match(fn[0], /void chrome\.runtime\.lastError/);
});

test("modal closeModal removes host, sink, and key listeners", () => {
  const fn = tmpl.match(/function closeModal\(\)[\s\S]*?\n  \}/);
  assert.match(fn[0], /removeEventListener\("keydown", state\.kd, true\)/);
  assert.match(fn[0], /state\.host\.remove\(\)/);
  assert.match(fn[0], /state\.sink\.remove\(\)/);
  assert.match(fn[0], /state = null/);
});

test("modal listens for open-modal and close-modal runtime messages", () => {
  assert.match(tmpl, /msg\?\.kind === "open-modal"/);
  assert.match(tmpl, /msg\?\.kind === "close-modal"/);
});

test("modal setFilter syncs visible search input and focus sink", () => {
  const fn = tmpl.match(/function setFilter\(next\)[\s\S]*?\n  \}/);
  assert.match(fn[0], /search\.value = next/);
  assert.match(fn[0], /state\.sink\.value = next/);
});

test("modal printable keys append to live filter via setFilter", () => {
  const fn = tmpl.match(/function handleKey\(e\)[\s\S]*?\n  \}/);
  assert.match(fn[0], /if \(e\.key\.length === 1\)/);
  assert.match(fn[0], /setFilter\(state\.filter \+ e\.key\)/);
});

test("modal firstRender selects row after active tab (JetBrains UX)", () => {
  assert.match(tmpl, /state\.rowIdx = i >= 0 && i \+ 1 < items\.length \? i \+ 1 : 0/);
});

test("modal template declares 10 categories (same as popup)", () => {
  const m = tmpl.match(/const CATEGORIES = \[([\s\S]*?)\];/);
  assert.ok(m);
  assert.equal([...m[1].matchAll(/id: "([^"]+)"/g)].length, 10);
});

test("modal handleKeyUp is intentionally a no-op (Enter activates)", () => {
  const fn = tmpl.match(/function handleKeyUp\(e\)[\s\S]*?\n  \}/);
  assert.ok(fn);
  assert.match(fn[0], /No-op for now/);
});

test("modal overlay uses role=dialog and aria-modal=true", () => {
  assert.match(tmpl, /role="dialog"/);
  assert.match(tmpl, /aria-modal="true"/);
});

test("modal refresh guards against stale state after async callbacks", () => {
  assert.match(tmpl, /if \(!state \|\| !data\) return/);
  assert.match(tmpl, /if \(!state\) return/);
});

test("modal scene save form stops keydown propagation from bubbling to handleKey", () => {
  assert.match(tmpl, /nameInput\.addEventListener\("keydown", \(e\) => e\.stopPropagation\(\)\)/);
});
