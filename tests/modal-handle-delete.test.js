// modal handleKey Delete and printable filter keys in content.template.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const tmpl = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");

const hkStart = tmpl.indexOf("function handleKey(e)");
const hkEnd = tmpl.indexOf("function handleKeyUp(e)");
assert.ok(hkStart >= 0 && hkEnd > hkStart, "handleKey missing");
const hk = tmpl.slice(hkStart, hkEnd);

test("modal handleKey Delete closes open tab via close-tab message", () => {
  assert.match(hk, /e\.key === "Delete"/);
  assert.match(hk, /t\?\.kind === "open"/);
  assert.match(hk, /kind: "close-tab", tabId: t\.id/);
});

test("modal handleKey Delete deletes history URL via history-delete", () => {
  assert.match(hk, /t\?\.kind === "history" && t\.url/);
  assert.match(hk, /kind: "history-delete", url/);
});

test("modal handleKey Delete removes history row locally after delete", () => {
  assert.match(hk, /state\.history = state\.history\.filter\(\(h\) => h\.url !== url\)/);
});

test("modal handleKey Backspace trims filter before acting on row", () => {
  assert.match(hk, /if \(state\.filter\.length > 0\)/);
  assert.match(hk, /setFilter\(state\.filter\.slice\(0, -1\)\)/);
});

test("modal handleKey Backspace on open tab sends close-tab when filter empty", () => {
  assert.match(hk, /t\?\.kind === "open"[\s\S]*?close-tab/);
});

test("modal handleKey printable single char appends to filter", () => {
  assert.match(hk, /if \(e\.key\.length === 1\)/);
  assert.match(hk, /setFilter\(state\.filter \+ e\.key\)/);
});

test("modal handleKey ignores lone Shift Control Alt Meta modifiers", () => {
  assert.match(hk, /e\.key === "Shift" \|\| e\.key === "Control"/);
  assert.match(hk, /e\.key === "Alt" \|\| e\.key === "Meta"/);
});

test("modal handleKey Cmd/Ctrl+E cycles MRU with shift reversing direction", () => {
  assert.match(hk, /e\.key === "e" \|\| e\.key === "E"/);
  assert.match(hk, /cycle\(e\.shiftKey \? -1 : \+1\)/);
});

test("modal handleKey stops immediate propagation for owned keys", () => {
  assert.match(hk, /e\.stopImmediatePropagation\(\)/);
});

test("modal handleKey Enter activates current row index", () => {
  assert.match(hk, /e\.key === "Enter"[\s\S]*?activate\(state\.rowIdx\)/);
});

test("modal handleKey returns early when state is null", () => {
  assert.match(hk, /if \(!state\) return/);
});

test("modal handleKeyUp is documented no-op placeholder", () => {
  const ku = tmpl.match(/function handleKeyUp\(e\)[\s\S]*?\n  \}/);
  assert.match(ku[0], /No-op for now/);
});
