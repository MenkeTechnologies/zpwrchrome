// parseMetadata directive parsing edge cases in lib/userscript.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMetadata, RUN_AT_VALUES } from "../lib/userscript.js";

const BLOCK = (body) => `// ==UserScript==\n${body}\n// ==/UserScript==\nconsole.log(1);`;

test("parseMetadata returns null when UserScript header block is absent", () => {
  assert.equal(parseMetadata("// just code"), null);
});

test("parseMetadata collects multiple @match lines into matches array", () => {
  const m = parseMetadata(BLOCK(
    "// @name        x\n// @match       https://a.com/*\n// @match       https://b.com/*"
  ));
  assert.deepEqual(m.matches, ["https://a.com/*", "https://b.com/*"]);
});

test("parseMetadata collects @grant lines into grants array", () => {
  const m = parseMetadata(BLOCK(
    "// @name        x\n// @match       *://*/*\n// @grant       GM.setValue\n// @grant       GM.getValue"
  ));
  assert.deepEqual(m.grants, ["GM.setValue", "GM.getValue"]);
});

test("parseMetadata normalizes @run-at document_start underscores to dashes", () => {
  const m = parseMetadata(BLOCK(
    "// @name        x\n// @match       *://*/*\n// @run-at      document_start"
  ));
  assert.equal(m.runAt, "document-start");
});

test("parseMetadata defaults invalid @run-at to document-idle", () => {
  const m = parseMetadata(BLOCK(
    "// @name        x\n// @match       *://*/*\n// @run-at      window-load"
  ));
  assert.equal(m.runAt, "document-idle");
  assert.ok(RUN_AT_VALUES.has("document-idle"));
});

test("parseMetadata accepts document-end run-at value", () => {
  const m = parseMetadata(BLOCK(
    "// @name        x\n// @match       *://*/*\n// @run-at      document-end"
  ));
  assert.equal(m.runAt, "document-end");
});

test("parseMetadata maps @iconurl alias to icon field", () => {
  const m = parseMetadata(BLOCK(
    "// @name        x\n// @match       *://*/*\n// @iconurl     https://cdn/icon.png"
  ));
  assert.equal(m.icon, "https://cdn/icon.png");
});

test("parseMetadata stores @require in requires array", () => {
  const m = parseMetadata(BLOCK(
    "// @name        x\n// @match       *://*/*\n// @require     https://lib/jquery.js"
  ));
  assert.deepEqual(m.requires, ["https://lib/jquery.js"]);
});

test("parseMetadata stores @resource in resources array", () => {
  const m = parseMetadata(BLOCK(
    "// @name        x\n// @match       *://*/*\n// @resource    logo https://x/logo.png"
  ));
  assert.deepEqual(m.resources, ["logo https://x/logo.png"]);
});

test("parseMetadata ignores non-directive comment lines inside block", () => {
  const m = parseMetadata(BLOCK(
    "// @name        x\n// @match       *://*/*\n// not a directive\n// @description hello"
  ));
  assert.equal(m.description, "hello");
});

test("parseMetadata directive keys are case-insensitive via toLowerCase", () => {
  const m = parseMetadata(BLOCK(
    "// @Name        Caps\n// @MATCH       https://z/*"
  ));
  assert.equal(m.name, "Caps");
  assert.deepEqual(m.matches, ["https://z/*"]);
});

test("parseMetadata trims trailing whitespace on directive values", () => {
  const m = parseMetadata(BLOCK(
    "// @name        spaced   \n// @match       https://a/*   "
  ));
  assert.equal(m.name, "spaced");
  assert.deepEqual(m.matches, ["https://a/*"]);
});

test("parseMetadata preserves raw map for repeated array keys", () => {
  const m = parseMetadata(BLOCK(
    "// @name        x\n// @exclude     https://a/*\n// @exclude     https://b/*"
  ));
  assert.deepEqual(m.excludes, ["https://a/*", "https://b/*"]);
  assert.deepEqual(m.raw.exclude, ["https://a/*", "https://b/*"]);
});

test("parseMetadata defaults empty scalar fields to empty strings", () => {
  const m = parseMetadata(BLOCK("// @name        only\n// @match       *://*/*"));
  assert.equal(m.namespace, "");
  assert.equal(m.version, "");
  assert.equal(m.author, "");
});

test("parseMetadata returns structured object even when @name omitted", () => {
  const m = parseMetadata(BLOCK("// @match       https://anon/*"));
  assert.ok(m);
  assert.equal(m.name, "");
  assert.deepEqual(m.matches, ["https://anon/*"]);
});
