// chrome.processes API invariants — dev/canary kill-heaviest feature.

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
  assert.ok(m, `${name} not found`);
  return m[0];
}

test("processesApiAvailable checks chrome.processes.getProcessInfo exists", () => {
  const fn = fnBody("processesApiAvailable");
  assert.match(fn, /typeof chrome\.processes === "object"/);
  assert.match(fn, /typeof chrome\.processes\.getProcessInfo === "function"/);
});

test("snapshotProcesses returns available:false when API missing", () => {
  const fn = fnBody("snapshotProcesses");
  assert.match(fn, /if \(!processesApiAvailable\(\)\)/);
  assert.match(fn, /available: false/);
  assert.match(fn, /perTab: \{\}/);
});

test("snapshotProcesses calls getProcessInfo with includeMemory=true", () => {
  const fn = fnBody("snapshotProcesses");
  assert.match(fn, /chrome\.processes\.getProcessInfo\(\[\], true,/);
});

test("snapshotProcesses aggregates memory per tabId from process tasks", () => {
  const fn = fnBody("snapshotProcesses");
  assert.match(fn, /for \(const task of \(p\.tasks/);
  assert.match(fn, /cur\.memoryBytes \+= mem/);
  assert.match(fn, /perTab\[tid\]/);
});

test("snapshotProcesses skips tasks with invalid tabId", () => {
  const fn = fnBody("snapshotProcesses");
  assert.match(fn, /typeof tid !== "number" \|\| tid < 0/);
});

test("killHeaviestTab refuses when processes API unavailable", () => {
  const fn = fnBody("killHeaviestTab");
  assert.match(fn, /if \(!snap\.available\) return undefined/);
});

test("killHeaviestTab picks tab with highest memoryBytes", () => {
  const fn = fnBody("killHeaviestTab");
  assert.match(fn, /m\.memoryBytes > worst\.mem/);
});

test("killHeaviestTab avoids killing the active tab (picks next-heaviest)", () => {
  const fn = fnBody("killHeaviestTab");
  assert.match(fn, /if \(active\?\.id === worst\.tabId\)/);
  assert.match(fn, /\.filter\(\(r\) => r\.tabId !== active\.id\)/);
});

test("killHeaviestTab removes the chosen tab via chrome.tabs.remove", () => {
  const fn = fnBody("killHeaviestTab");
  assert.match(fn, /await chrome\.tabs\.remove\(worst\.tabId\)/);
});

test("killHeaviestTab returns the removed tabId on success", () => {
  const fn = fnBody("killHeaviestTab");
  assert.match(fn, /return worst\.tabId/);
});

test("popup kill-heaviest UI toggles hidden based on proc.available", () => {
  const popup = readFileSync(join(ROOT, "popup.js"), "utf8");
  assert.match(popup, /getElementById\("killHeaviest"\)/);
  assert.match(popup, /classList\.toggle\("hidden", !state\.proc\.available\)/);
});

test("manifest lists processes under optional_permissions (not required)", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  assert.ok(manifest.optional_permissions.includes("processes"));
  assert.ok(!manifest.permissions.includes("processes"),
    "processes must be optional — stable Chrome lacks the API");
});

test("processes-snapshot message handler returns snapshotProcesses shape", () => {
  const idx = bg.indexOf('msg?.kind === "processes-snapshot"');
  assert.ok(idx >= 0);
  assert.match(bg.slice(idx, idx + 300), /snapshotProcesses\(\)/);
});

test("kill-heaviest command in dispatch delegates to killHeaviestTab", () => {
  assert.match(bg, /command === "kill-heaviest"\)[\s\S]*?killHeaviestTab\(\)/);
});
