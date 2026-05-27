// validateUserscript and userscriptId unit tests in lib/userscript.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateUserscript,
  userscriptId,
  parseMetadata,
} from "../lib/userscript.js";

const VALID = parseMetadata(`// ==UserScript==
// @name        Valid Script
// @match       https://example.com/*
// ==/UserScript==
`);

test("validateUserscript returns empty array for well-formed metadata", () => {
  assert.deepEqual(validateUserscript(VALID), []);
});

test("validateUserscript rejects null metadata with block message", () => {
  assert.ok(validateUserscript(null).some((e) => e.includes("no ==UserScript== block")));
});

test("validateUserscript flags missing @name", () => {
  const m = { ...VALID, name: "" };
  assert.ok(validateUserscript(m).some((e) => e.includes("missing @name")));
});

test("validateUserscript flags missing @match and @include together", () => {
  const m = { ...VALID, matches: [], includes: [] };
  assert.ok(validateUserscript(m).some((e) => e.includes("missing @match")));
});

test("validateUserscript accepts @include-only scripts", () => {
  const m = { ...VALID, matches: [], includes: ["https://a.com/*"] };
  assert.deepEqual(validateUserscript(m), []);
});

test("validateUserscript reports invalid @match pattern text", () => {
  const m = { ...VALID, matches: ["not-valid"] };
  assert.ok(validateUserscript(m).some((e) => e.includes("invalid @match")));
});

test("validateUserscript does not validate @include pattern syntax", () => {
  const m = { ...VALID, matches: [], includes: ["totally invalid"] };
  assert.deepEqual(validateUserscript(m), []);
});

test("userscriptId prefixes sanitized base with us_", () => {
  const id = userscriptId({ name: "My Script", namespace: "https://ns/" });
  assert.match(id, /^us_/);
});

test("userscriptId replaces disallowed characters with underscores", () => {
  const id = userscriptId({ name: "a/b:c", namespace: "https://x/" });
  assert.ok(!id.includes("/"));
  assert.ok(!id.includes(":"));
});

test("userscriptId truncates to 80 characters max", () => {
  const id = userscriptId({
    name: "X".repeat(100),
    namespace: "https://" + "y".repeat(100) + "/",
  });
  assert.ok(id.length <= 80);
});

test("userscriptId is stable for same name and namespace", () => {
  const meta = { name: "Demo", namespace: "https://demo/" };
  assert.equal(userscriptId(meta), userscriptId(meta));
});

test("userscriptId differs when name changes with same namespace", () => {
  const ns = "https://same/";
  assert.notEqual(
    userscriptId({ name: "A", namespace: ns }),
    userscriptId({ name: "B", namespace: ns })
  );
});

test("validateUserscript flags multiple invalid @match lines independently", () => {
  const m = { ...VALID, matches: ["bad1", "bad2"] };
  const errs = validateUserscript(m);
  assert.equal(errs.filter((e) => e.includes("invalid @match")).length, 2);
});
