// chrome.processes API detection REMOVED — processesApiAvailable +
// snapshotProcesses + killHeaviestTab are all gone (the API is dev/canary
// only). Kept as a thin pin file so a future re-introduction of the
// helpers is caught loudly. See tests/processes-handlers.test.js +
// tests/processes.test.js for the broader removal pins.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

test("processesApiAvailable helper is removed", () => {
  assert.doesNotMatch(bg, /\bfunction processesApiAvailable\b/);
  assert.doesNotMatch(bg, /\bprocessesApiAvailable\(\)/);
});

test("snapshotProcesses helper is removed", () => {
  assert.doesNotMatch(bg, /\bfunction snapshotProcesses\b/);
  assert.doesNotMatch(bg, /\bsnapshotProcesses\(\)/);
});

test("killHeaviestTab helper is removed", () => {
  assert.doesNotMatch(bg, /\bfunction killHeaviestTab\b/);
  assert.doesNotMatch(bg, /\bkillHeaviestTab\(\)/);
});
