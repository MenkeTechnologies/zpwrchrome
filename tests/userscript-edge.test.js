// validateUserscript and expandMatchPatterns edge cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMetadata,
  validateUserscript,
  expandMatchPatterns,
  matchUrl,
  userscriptId,
  RUN_AT_VALUES
} from "../lib/userscript.js";

const HEADER = (body) => `// ==UserScript==
${body}
// ==/UserScript==
console.log("x");`;

test("RUN_AT_VALUES set includes document-start/end/idle", () => {
  assert.ok(RUN_AT_VALUES.has("document-start"));
  assert.ok(RUN_AT_VALUES.has("document-end"));
  assert.ok(RUN_AT_VALUES.has("document-idle"));
});

test("parseMetadata stores unknown scalar keys in raw map", () => {
  const m = parseMetadata(HEADER("// @name t\n// @match https://a/*\n// @license MIT"));
  assert.equal(m.raw.license, "MIT");
});

test("parseMetadata ignores lines without @ directive prefix", () => {
  const m = parseMetadata(HEADER("// @name t\n// not a directive\n// @match https://a/*"));
  assert.equal(m.name, "t");
});

test("validateUserscript accepts @include-only script without @match", () => {
  const m = parseMetadata(HEADER("// @name t\n// @include https://example.com/*"));
  assert.deepEqual(validateUserscript(m), []);
});

test("validateUserscript rejects script with missing @name", () => {
  const m = parseMetadata(HEADER("// @match https://a/*"));
  assert.ok(validateUserscript(m).some((e) => e.includes("missing @name")));
});

test("validateUserscript flags each invalid @match independently", () => {
  const m = parseMetadata(HEADER("// @name t\n// @match bad\n// @match also-bad\n// @match https://ok/*"));
  const errs = validateUserscript(m);
  assert.ok(errs.filter((e) => e.includes("invalid @match")).length >= 2);
});

test("expandMatchPatterns adds *.host variant for multi-label https hosts", () => {
  const out = expandMatchPatterns(["https://docs.google.com/*"]);
  assert.ok(out.includes("https://*.docs.google.com/*"));
});

test("expandMatchPatterns does not expand host that is already wildcard", () => {
  const out = expandMatchPatterns(["https://*.github.com/*"]);
  assert.equal(out.length, 1);
});

test("expandMatchPatterns preserves ftp scheme on generated wildcard host", () => {
  const out = expandMatchPatterns(["ftp://files.example.com/*"]);
  assert.ok(out.some((p) => p.startsWith("ftp://*.files.example.com")));
});

test("matchUrl returns true when any pattern matches", () => {
  assert.ok(matchUrl(["https://a.com/*", "https://b.com/*"], "https://b.com/x"));
});

test("userscriptId is stable for same name+namespace pair", () => {
  const meta = { name: "X", namespace: "https://ns" };
  assert.equal(userscriptId(meta), userscriptId(meta));
});

test("userscriptId changes when name changes with same namespace", () => {
  assert.notEqual(
    userscriptId({ name: "A", namespace: "https://n" }),
    userscriptId({ name: "B", namespace: "https://n" })
  );
});

test("parseMetadata normalizes @run-at document-start with underscores", () => {
  const m = parseMetadata(HEADER("// @name t\n// @match https://a/*\n// @run-at document_start"));
  assert.equal(m.runAt, "document-start");
});

test("parseMetadata clamps bogus @run-at to document-idle", () => {
  const m = parseMetadata(HEADER("// @name t\n// @match https://a/*\n// @run-at instant"));
  assert.equal(m.runAt, "document-idle");
});

test("parseMetadata collects multiple @exclude patterns", () => {
  const m = parseMetadata(HEADER("// @name t\n// @match https://a/*\n// @exclude https://a/admin/*\n// @exclude https://a/private/*"));
  assert.equal(m.excludes.length, 2);
});

test("expandMatchPatterns ignores patterns without path segment", () => {
  const out = expandMatchPatterns(["https://example.com"]);
  assert.deepEqual(out, ["https://example.com"]);
});
