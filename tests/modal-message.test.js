// Content-script modal message routing in modal/content.template.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const tmpl = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");
const built = readFileSync(join(ROOT, "modal/content.js"), "utf8");

test("modal template registers chrome.runtime.onMessage listener", () => {
  assert.match(tmpl, /chrome\.runtime\.onMessage\.addListener/);
});

test("modal template open-modal message calls openModal()", () => {
  assert.match(tmpl, /msg\?\.kind === "open-modal"\)[\s\S]*?openModal\(\)/);
});

test("modal template close-modal message calls closeModal()", () => {
  assert.match(tmpl, /msg\?\.kind === "close-modal"\)[\s\S]*?closeModal\(\)/);
});

test("built modal preserves open-modal and close-modal message handlers", () => {
  assert.match(built, /msg\?\.kind === "open-modal"/);
  assert.match(built, /msg\?\.kind === "close-modal"/);
});

test("modal MODAL_ID constant guards idempotent script injection", () => {
  assert.match(tmpl, /const MODAL_ID = "zpwrchrome-modal-host-0a1b"/);
  assert.match(tmpl, /if \(window\[MODAL_ID \+ "-installed"\]\) return/);
});

test("modal sets installed flag on window before wiring UI", () => {
  assert.match(tmpl, /window\[MODAL_ID \+ "-installed"\] = true/);
});

test("modal template uses IIFE wrapper for content script scope", () => {
  assert.match(tmpl, /\(\(\) => \{/);
});

test("modal template inlines FZF via %%FZF%% build marker", () => {
  assert.match(tmpl, /%%FZF%%/);
});

test("modal template inlines UTIL via %%UTIL%% build marker", () => {
  assert.match(tmpl, /%%UTIL%%/);
});

test("modal template inlines fonts via %%STM%% and %%ORB%% markers", () => {
  assert.match(tmpl, /%%STM%%/);
  assert.match(tmpl, /%%ORB%%/);
});

test("built modal substitutes font markers with base64 data", () => {
  assert.ok(!built.includes("%%STM%%"), "STM marker must be replaced in built output");
  assert.ok(!built.includes("%%ORB%%"), "ORB marker must be replaced in built output");
  assert.match(built, /data:font\/woff2;base64,/);
});

test("modal template documents open-modal trigger from background recent-modal", () => {
  assert.match(tmpl, /kind: "open-modal"/);
  assert.match(tmpl, /recent-modal/);
});

test("modal template shadow DOM host uses MODAL_ID as element id", () => {
  assert.match(tmpl, /host\.id = MODAL_ID/);
});

test("modal template focus sink id is MODAL_ID + -sink suffix", () => {
  assert.match(tmpl, /MODAL_ID \+ "-sink"/);
});

test("built modal is larger than template after inlining fonts fzf and util", () => {
  assert.ok(built.length > tmpl.length,
    "built modal must be at least as large as template after inlining");
  assert.ok(built.includes("function fzfMatch"), "must inline fzf");
  assert.ok(built.includes("function hostnameOf"), "must inline util");
});

test("modal template HISTORY_MAX_RESULTS matches popup ceiling of 5000", () => {
  assert.match(tmpl, /const HISTORY_MAX_RESULTS = 5000/);
});
