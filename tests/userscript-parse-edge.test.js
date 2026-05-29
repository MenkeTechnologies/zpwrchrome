// parseMetadata behaviors not pinned by the existing userscript test files:
// raw map preservation for unknown directives, @include array population,
// valueless flag directives, and whitespace tolerance inside the block.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMetadata } from "../lib/userscript.js";

const HEADER = (body) => `// ==UserScript==\n${body}// ==/UserScript==\n\nconsole.log("ok");\n`;

test("parseMetadata populates includes array from @include directives", () => {
  const meta = parseMetadata(HEADER([
    "// @name      inc-script\n",
    "// @include   https://*.example.com/*\n",
    "// @include   https://other.test/path\n",
  ].join("")));
  assert.deepEqual(meta.includes, [
    "https://*.example.com/*",
    "https://other.test/path",
  ]);
  assert.deepEqual(meta.matches, [], "@include must not leak into matches array");
});

test("parseMetadata accepts tab separator between @directive and value", () => {
  // LINE_RE uses \s+ between key and value — tabs count.
  const meta = parseMetadata(HEADER("// @name\ttab-separated\n// @match\thttps://a.test/*\n"));
  assert.equal(meta.name, "tab-separated");
  assert.deepEqual(meta.matches, ["https://a.test/*"]);
});

test("parseMetadata stores unknown scalar directive into raw map", () => {
  const meta = parseMetadata(HEADER("// @name custom\n// @noframes-disabled true\n"));
  assert.equal(meta.raw["noframes-disabled"], "true");
});

test("parseMetadata skips valueless flag directives like bare @noframes", () => {
  // LINE_RE requires whitespace + at-least-one-char value. A bare flag
  // shouldn't error — it simply doesn't land in raw or any typed field.
  const meta = parseMetadata(HEADER("// @name flag-script\n// @noframes\n// @match https://x.test/*\n"));
  assert.equal(meta.raw.noframes, undefined);
  assert.equal(meta.name, "flag-script");
});

test("parseMetadata preserves @ symbol embedded in directive values", () => {
  const meta = parseMetadata(HEADER("// @name embed\n// @author me@example.com\n// @match https://x.test/*\n"));
  assert.equal(meta.author, "me@example.com");
});

test("parseMetadata tolerates blank lines inside the block", () => {
  const meta = parseMetadata(HEADER([
    "// @name blank-tolerant\n",
    "\n",
    "// @namespace https://example.com\n",
    "\n",
    "// @match https://x.test/*\n",
  ].join("")));
  assert.equal(meta.name, "blank-tolerant");
  assert.equal(meta.namespace, "https://example.com");
  assert.deepEqual(meta.matches, ["https://x.test/*"]);
});

test("parseMetadata returns structured object even when block contains only blank lines", () => {
  const meta = parseMetadata(HEADER("\n\n"));
  assert.notEqual(meta, null);
  assert.equal(meta.name, "");
  assert.deepEqual(meta.matches, []);
});

test("parseMetadata raw map keys are lowercased even when directive uses mixed case", () => {
  const meta = parseMetadata(HEADER("// @Name UpperLower\n// @MATCH https://x.test/*\n"));
  assert.equal(meta.raw.name, "UpperLower", "key should be lowered but VALUE preserved as-is");
  assert.deepEqual(meta.raw.match, ["https://x.test/*"]);
});

test("parseMetadata ignores plain non-directive comment lines without crashing", () => {
  const meta = parseMetadata(HEADER([
    "// @name comment-tolerant\n",
    "// just a comment, no @ prefix\n",
    "// @match https://x.test/*\n",
  ].join("")));
  assert.equal(meta.name, "comment-tolerant");
  assert.deepEqual(meta.matches, ["https://x.test/*"]);
});

test("parseMetadata @connect directive lands in raw array", () => {
  // @connect isn't surfaced as a typed field but does populate raw via the
  // ARRAY_KEYS set — pin so future refactor doesn't drop it.
  const meta = parseMetadata(HEADER([
    "// @name connect-script\n",
    "// @match https://x.test/*\n",
    "// @connect api.example.com\n",
    "// @connect cdn.example.com\n",
  ].join("")));
  assert.deepEqual(meta.raw.connect, ["api.example.com", "cdn.example.com"]);
});

test("parseMetadata reads @description and @version into typed fields", () => {
  const meta = parseMetadata(HEADER([
    "// @name typed-fields\n",
    "// @version 1.2.3\n",
    "// @description does a thing\n",
    "// @match https://x.test/*\n",
  ].join("")));
  assert.equal(meta.version, "1.2.3");
  assert.equal(meta.description, "does a thing");
});

test("parseMetadata stores @resource as array even for a single resource line", () => {
  const meta = parseMetadata(HEADER([
    "// @name one-resource\n",
    "// @match https://x.test/*\n",
    "// @resource css https://cdn.example.com/style.css\n",
  ].join("")));
  assert.deepEqual(meta.resources, ["css https://cdn.example.com/style.css"]);
});
