// processes-snapshot and kill-heaviest message handlers in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

function sliceHandler(kind, len = 500) {
  const marker = `msg?.kind === "${kind}"`;
  const idx = bg.indexOf(marker);
  assert.ok(idx >= 0, `handler for "${kind}" not found`);
  return bg.slice(idx, idx + len);
}

function fnBody(name) {
  const m = bg.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} not found`);
  return m[0];
}

test("processes-snapshot handler delegates to snapshotProcesses", () => {
  const sec = sliceHandler("processes-snapshot", 400);
  assert.match(sec, /snapshotProcesses\(\)/);
  assert.match(sec, /\.then\(\(data\) => sendResponse\(data\)\)/);
});

test("processes-snapshot catch returns available:false with empty perTab", () => {
  const sec = sliceHandler("processes-snapshot", 400);
  assert.match(sec, /catch\(\(e\) => sendResponse\(\{ available: false, error: String\(e\), perTab: \{\} \}\)\)/);
});

test("kill-heaviest handler delegates to killHeaviestTab", () => {
  const sec = sliceHandler("kill-heaviest", 400);
  assert.match(sec, /killHeaviestTab\(\)/);
});

test("kill-heaviest ok:true when tabId is numeric", () => {
  const sec = sliceHandler("kill-heaviest", 400);
  assert.match(sec, /sendResponse\(\{ ok: typeof tabId === "number", tabId \}\)/);
});

test("kill-heaviest catch returns ok:false with error string", () => {
  const sec = sliceHandler("kill-heaviest", 400);
  assert.match(sec, /catch\(\(e\) => sendResponse\(\{ ok: false, error: String\(e\) \}\)\)/);
});

test("snapshotProcesses unavailable path includes human-readable reason", () => {
  const fn = fnBody("snapshotProcesses");
  assert.match(fn, /reason: "chrome\.processes unavailable on this channel"/);
});

test("snapshotProcesses sums cpu across all process tasks for a tab", () => {
  const fn = fnBody("snapshotProcesses");
  assert.match(fn, /cur\.cpu \+= cpu/);
});

test("snapshotProcesses treats missing privateMemory as zero", () => {
  const fn = fnBody("snapshotProcesses");
  assert.match(fn, /typeof p\.privateMemory === "number" \? p\.privateMemory : 0/);
});

test("killHeaviestTab ranks tabs by memoryBytes descending", () => {
  const fn = fnBody("killHeaviestTab");
  assert.match(fn, /\.sort\(\(a, b\) => b\.mem - a\.mem\)/);
});

test("killHeaviestTab removes tab via chrome.tabs.remove", () => {
  const fn = fnBody("killHeaviestTab");
  assert.match(fn, /await chrome\.tabs\.remove\(worst\.tabId\)/);
});

test("killHeaviestTab returns undefined when no process data exists", () => {
  const fn = fnBody("killHeaviestTab");
  assert.match(fn, /if \(!worst\) return undefined/);
});

test("killHeaviestTab catch on tabs.remove returns undefined", () => {
  const fn = fnBody("killHeaviestTab");
  assert.match(fn, /catch \{ return undefined; \}/);
});

test("dispatch kill-heaviest routes to killHeaviestTab function", () => {
  assert.match(bg, /command === "kill-heaviest"\)[\s\S]*?killHeaviestTab\(\)/);
});

test("popup renderList shows proc column only when state.proc.available", () => {
  const popup = readFileSync(join(ROOT, "popup.js"), "utf8");
  assert.match(popup, /state\.proc\.available/);
  assert.match(popup, /class="proc-col"/);
});

test("popup proc column shows cpu percentage with one decimal", () => {
  const popup = readFileSync(join(ROOT, "popup.js"), "utf8");
  assert.match(popup, /proc\.cpu\.toFixed\(1\)/);
});
