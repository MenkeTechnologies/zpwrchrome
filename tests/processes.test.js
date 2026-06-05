// chrome.processes / kill-heaviest REMOVED — the API is dev/canary only
// and emits "'processes' requires dev channel or newer" on stable.
// See tests/processes-handlers.test.js for the consolidated removal pins.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const bg = read("background.js");
const popup = read("popup.js");
const manifest = JSON.parse(read("manifest.json"));

test("chrome.processes integration is fully removed from background.js", () => {
  for (const fn of ["processesApiAvailable", "snapshotProcesses", "killHeaviestTab"]) {
    assert.doesNotMatch(bg, new RegExp(`\\bfunction ${fn}\\b`), `${fn} must not exist`);
  }
  assert.doesNotMatch(bg, /chrome\.processes/);
  assert.doesNotMatch(bg, /"processes-snapshot"/);
  assert.doesNotMatch(bg, /"kill-heaviest"/);
});

test("popup.js no longer wires the kill-heaviest UI or state.proc bag", () => {
  assert.doesNotMatch(popup, /killHeaviest/);
  assert.doesNotMatch(popup, /kill-heaviest/);
  assert.doesNotMatch(popup, /state\.proc\b/);
});

test("manifest no longer declares the `processes` permission", () => {
  assert.ok(!(manifest.optional_permissions || []).includes("processes"));
  assert.ok(!(manifest.permissions || []).includes("processes"));
});

test("manifest no longer registers the kill-heaviest command", () => {
  assert.ok(!("kill-heaviest" in (manifest.commands || {})));
});
