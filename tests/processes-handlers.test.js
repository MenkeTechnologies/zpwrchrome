// chrome.processes integration REMOVED — the API is dev/canary-only and
// emits a warning ("'processes' requires dev channel or newer") on stable
// channels. This file used to pin processes-snapshot / kill-heaviest /
// snapshotProcesses / killHeaviestTab. It now pins the ABSENCE of all of
// those, so a future refactor can't silently re-introduce the permission
// or the dead code paths.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const manifest = JSON.parse(read("manifest.json"));
const bg      = read("background.js");
const popup   = read("popup.js");
const popupH  = read("popup.html");
const popupC  = read("popup.css");

test("manifest no longer requests `processes` permission (stable-channel safe)", () => {
  assert.ok(!manifest.permissions?.includes?.("processes"),
    "permissions must NOT include processes");
  assert.ok(!(manifest.optional_permissions || []).includes("processes"),
    "optional_permissions must NOT include processes");
  // Sanity: the whole optional_permissions key should be either absent or
  // not list processes. Most-aggressive: assert undefined entirely.
  if (manifest.optional_permissions) {
    assert.ok(!manifest.optional_permissions.includes("processes"));
  }
});

test("manifest no longer declares `kill-heaviest` command", () => {
  assert.ok(!("kill-heaviest" in (manifest.commands || {})),
    "kill-heaviest must be removed from manifest.commands");
});

test("background.js has no chrome.processes references", () => {
  assert.doesNotMatch(bg, /chrome\.processes/,         "chrome.processes call site");
  assert.doesNotMatch(bg, /processesApiAvailable/,     "processesApiAvailable helper");
  assert.doesNotMatch(bg, /\bsnapshotProcesses\b/,     "snapshotProcesses helper");
  assert.doesNotMatch(bg, /\bkillHeaviestTab\b/,       "killHeaviestTab helper");
  assert.doesNotMatch(bg, /"processes-snapshot"/,      "processes-snapshot message handler");
  assert.doesNotMatch(bg, /"kill-heaviest"/,           "kill-heaviest message handler / dispatch");
});

test("popup.js has no kill-heaviest / proc-col / state.proc references", () => {
  assert.doesNotMatch(popup, /killHeaviest/,           "killHeaviest button hook");
  assert.doesNotMatch(popup, /kill-heaviest/,          "kill-heaviest message kind");
  assert.doesNotMatch(popup, /processes-snapshot/,     "processes-snapshot refresh chain");
  assert.doesNotMatch(popup, /state\.proc\b/,          "state.proc bag");
  assert.doesNotMatch(popup, /proc-col/,               "per-row proc column");
  assert.doesNotMatch(popup, /\bfmtMb\(/,              "fmtMb byte formatter (only used by proc col)");
});

test("popup.html has no killHeaviest button", () => {
  assert.doesNotMatch(popupH, /id="killHeaviest"/, "killHeaviest button must be gone");
  assert.doesNotMatch(popupH, /kill heaviest/i,    "no 'kill heaviest' UI text");
});

test("popup.css has no .kill-heaviest or .proc-col rules", () => {
  assert.doesNotMatch(popupC, /\.kill-heaviest\b/);
  assert.doesNotMatch(popupC, /\.proc-col\b/);
});
