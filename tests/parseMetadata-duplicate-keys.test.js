// parseMetadata: directive duplication semantics + line-ending tolerance.
// Pins last-writer-wins for scalar directives, accumulation for array ones,
// and the (LF-only, leftmost-//) parsing constraints that the existing
// userscript test files don't make explicit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMetadata } from "../lib/userscript.js";

const WRAP = (body) => `// ==UserScript==\n${body}// ==/UserScript==\n\nconsole.log("ok");\n`;

test("parseMetadata duplicate scalar key uses last-writer-wins (second @name overrides first)", () => {
  const meta = parseMetadata(WRAP([
    "// @name first\n",
    "// @name second\n",
    "// @match https://x.test/*\n",
  ].join("")));
  assert.equal(meta.name, "second");
  assert.equal(meta.raw.name, "second");
});

test("parseMetadata duplicate @version takes the later value", () => {
  const meta = parseMetadata(WRAP([
    "// @name v\n",
    "// @version 1.0.0\n",
    "// @version 2.0.0\n",
    "// @match https://x.test/*\n",
  ].join("")));
  assert.equal(meta.version, "2.0.0");
});

test("parseMetadata array directive (@grant) accumulates every occurrence", () => {
  const meta = parseMetadata(WRAP([
    "// @name g\n",
    "// @match https://x.test/*\n",
    "// @grant GM.setValue\n",
    "// @grant GM.getValue\n",
    "// @grant GM.notification\n",
  ].join("")));
  assert.deepEqual(meta.grants, ["GM.setValue", "GM.getValue", "GM.notification"]);
});

test("parseMetadata @grant none is parsed as a plain array entry (no special-casing)", () => {
  // Tampermonkey treats "none" as a sentinel; our parser stores it verbatim
  // and lets the caller decide. Pin the parser-level behavior.
  const meta = parseMetadata(WRAP([
    "// @name no-grant\n",
    "// @match https://x.test/*\n",
    "// @grant none\n",
  ].join("")));
  assert.deepEqual(meta.grants, ["none"]);
});

test("parseMetadata fails to parse CR-only (old-Mac) line endings inside the block", () => {
  // HEADER_RE matches the // ==UserScript== / // ==/UserScript== wrapper,
  // then split("\n") on the body. CR-only content collapses into one giant
  // line, so no directives are recognized. Pin the failure mode so a future
  // "be tolerant" patch is intentional.
  const src = WRAP("// @name cr\r// @match https://x.test/*\r");
  const meta = parseMetadata(src);
  assert.notEqual(meta, null, "block detected even when body is CR-only");
  assert.equal(meta.name, "", "but no directives parsed");
  assert.deepEqual(meta.matches, []);
});

test("parseMetadata refuses indented directive lines (LINE_RE anchors at leftmost //)", () => {
  // Leading whitespace before // breaks the LINE_RE start anchor.
  // Pin so a future "trim leading whitespace" patch is intentional.
  const meta = parseMetadata(WRAP([
    "   // @name indented\n",
    "// @match https://x.test/*\n",
  ].join("")));
  assert.equal(meta.name, "");
  assert.deepEqual(meta.matches, ["https://x.test/*"]);
});

test("parseMetadata preserves complex @version strings (semver with build/pre-release)", () => {
  const meta = parseMetadata(WRAP([
    "// @name semver\n",
    "// @version 1.2.3-rc.1+build.42\n",
    "// @match https://x.test/*\n",
  ].join("")));
  assert.equal(meta.version, "1.2.3-rc.1+build.42");
});

test("parseMetadata @author with email-style address keeps the string verbatim", () => {
  const meta = parseMetadata(WRAP([
    "// @name email\n",
    "// @author Jane Doe <jane@example.com>\n",
    "// @match https://x.test/*\n",
  ].join("")));
  assert.equal(meta.author, "Jane Doe <jane@example.com>");
});

test("parseMetadata @namespace with trailing slash is preserved verbatim", () => {
  const meta = parseMetadata(WRAP([
    "// @name ns\n",
    "// @namespace https://menketechnologies.github.io/\n",
    "// @match https://x.test/*\n",
  ].join("")));
  assert.equal(meta.namespace, "https://menketechnologies.github.io/");
});

test("parseMetadata default scalar fields are empty strings (not undefined) when omitted", () => {
  const meta = parseMetadata(WRAP("// @name minimal\n// @match https://x.test/*\n"));
  assert.equal(meta.namespace, "");
  assert.equal(meta.version, "");
  assert.equal(meta.description, "");
  assert.equal(meta.author, "");
  assert.equal(meta.icon, "");
});

test("parseMetadata default array fields are empty arrays (not undefined) when omitted", () => {
  const meta = parseMetadata(WRAP("// @name minimal\n// @match https://x.test/*\n"));
  assert.deepEqual(meta.includes, []);
  assert.deepEqual(meta.excludes, []);
  assert.deepEqual(meta.grants, []);
  assert.deepEqual(meta.requires, []);
  assert.deepEqual(meta.resources, []);
});

test("parseMetadata when both header markers missing returns null", () => {
  const meta = parseMetadata("// just code\nconsole.log('hi');\n");
  assert.equal(meta, null);
});

test("parseMetadata header without trailing end marker also returns null", () => {
  const meta = parseMetadata("// ==UserScript==\n// @name truncated\n// @match https://x.test/*\nconsole.log(1);\n");
  assert.equal(meta, null, "missing closing == marker → reject");
});
