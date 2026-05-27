// processesApiAvailable and snapshotProcesses aggregation in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

function fnBody(name) {
  const m = bg.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} missing`);
  return m[0];
}

test("processesApiAvailable checks getProcessInfo function exists", () => {
  const fn = fnBody("processesApiAvailable");
  assert.match(fn, /typeof chrome\.processes === "object"/);
  assert.match(fn, /typeof chrome\.processes\.getProcessInfo === "function"/);
});

test("snapshotProcesses returns available false with reason when API missing", () => {
  const fn = fnBody("snapshotProcesses");
  assert.match(fn, /if \(!processesApiAvailable\(\)\)/);
  assert.match(fn, /available: false, reason:/);
});

test("snapshotProcesses calls getProcessInfo with empty ids and includeMemory true", () => {
  const fn = fnBody("snapshotProcesses");
  assert.match(fn, /chrome\.processes\.getProcessInfo\(\[\], true/);
});

test("snapshotProcesses wraps getProcessInfo callback in Promise", () => {
  const fn = fnBody("snapshotProcesses");
  assert.match(fn, /await new Promise\(\(resolve\) => \{/);
});

test("snapshotProcesses getProcessInfo sync throw resolves empty object", () => {
  const fn = fnBody("snapshotProcesses");
  assert.match(fn, /catch \{ resolve\(\{\}\); \}/);
});

test("snapshotProcesses skips tasks with non-numeric or negative tabId", () => {
  const fn = fnBody("snapshotProcesses");
  assert.match(fn, /typeof tid !== "number" \|\| tid < 0/);
  assert.match(fn, /continue/);
});

test("snapshotProcesses aggregates memoryBytes per tab across tasks", () => {
  const fn = fnBody("snapshotProcesses");
  assert.match(fn, /cur\.memoryBytes \+= mem/);
});

test("snapshotProcesses returns available true with perTab map on success", () => {
  const fn = fnBody("snapshotProcesses");
  assert.match(fn, /return \{ available: true, perTab \}/);
});

test("killHeaviestTab refuses to kill active tab picking next heaviest instead", () => {
  const fn = fnBody("killHeaviestTab");
  assert.match(fn, /if \(active\?\.id === worst\.tabId\)/);
  assert.match(fn, /filter\(\(r\) => r\.tabId !== active\.id\)/);
});

test("killHeaviestTab uses snapshotProcesses for memory ranking", () => {
  const fn = fnBody("killHeaviestTab");
  assert.match(fn, /const snap = await snapshotProcesses\(\)/);
  assert.match(fn, /if \(!snap\.available\) return undefined/);
});

test("killHeaviestTab compares memoryBytes not cpu when picking worst", () => {
  const fn = fnBody("killHeaviestTab");
  assert.match(fn, /m\.memoryBytes > worst\.mem/);
});

test("manifest includes tabs permission required for processes tab mapping", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  assert.ok(manifest.permissions.includes("tabs"));
});
