// Unit tests for lib/json-format.js — auto-detect, parse-with-pos,
// type classification, structural walk, RFC 6901 pointer formatting,
// pretty/minify, size + node counting.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  looksLikeJson,
  tryParseJson,
  jsonType,
  nodeSummary,
  walk,
  formatPath,
  prettyPrint,
  minify,
  countNodes,
  jsonByteSize,
} from "../lib/json-format.js";

// ─── looksLikeJson — auto-detect ───────────────────────────────────
test("looksLikeJson: object / array / string / number / boolean / null start chars", () => {
  for (const s of ["{}", "[]", '"x"', "0", "-1", "1.5", "true", "false", "null"]) {
    assert.equal(looksLikeJson(s), true, `expected truthy for ${JSON.stringify(s)}`);
  }
});

test("looksLikeJson: leading whitespace is tolerated", () => {
  assert.equal(looksLikeJson("   \n\t {}"), true);
  assert.equal(looksLikeJson("\r\n[1,2]"), true);
});

test("looksLikeJson: HTML / plain text / empty → false", () => {
  assert.equal(looksLikeJson("<!DOCTYPE html>"), false);
  assert.equal(looksLikeJson("<html><body>x</body></html>"), false);
  assert.equal(looksLikeJson(""), false);
  assert.equal(looksLikeJson(null), false);
  assert.equal(looksLikeJson("hello world"), false);
  assert.equal(looksLikeJson("x: 1"), false);
});

// ─── tryParseJson ──────────────────────────────────────────────────
test("tryParseJson: returns { ok:true, value } on success", () => {
  assert.deepEqual(tryParseJson('{"a":1}'),         { ok: true, value: { a: 1 } });
  assert.deepEqual(tryParseJson("[1,2,3]"),         { ok: true, value: [1, 2, 3] });
  assert.deepEqual(tryParseJson('"hello"'),         { ok: true, value: "hello" });
  assert.deepEqual(tryParseJson("42"),              { ok: true, value: 42 });
  assert.deepEqual(tryParseJson("true"),            { ok: true, value: true });
  assert.deepEqual(tryParseJson("null"),            { ok: true, value: null });
});

test("tryParseJson: returns { ok:false, error, pos? } on failure", () => {
  const out = tryParseJson('{"a":1,}');
  assert.equal(out.ok, false);
  assert.ok(out.error);
  // Older V8 reported "position N"; newer reports a slightly different
  // message — the helper should still surface a useful error string
  // either way.
  assert.ok(typeof out.error === "string");
});

test("tryParseJson: pos field is captured when V8 reports it", () => {
  const out = tryParseJson('{"a":}');
  assert.equal(out.ok, false);
  // pos may or may not be present depending on engine version, but if
  // it is, it must be a finite number > 0.
  if (out.pos !== undefined) {
    assert.ok(Number.isFinite(out.pos) && out.pos > 0);
  }
});

// ─── jsonType / nodeSummary ────────────────────────────────────────
test("jsonType: distinguishes null / array / object / primitives", () => {
  assert.equal(jsonType(null),     "null");
  assert.equal(jsonType(undefined),"undefined");
  assert.equal(jsonType([]),       "array");
  assert.equal(jsonType([1, 2]),   "array");
  assert.equal(jsonType({}),       "object");
  assert.equal(jsonType({ a: 1 }), "object");
  assert.equal(jsonType("hi"),     "string");
  assert.equal(jsonType(0),        "number");
  assert.equal(jsonType(true),     "boolean");
});

test("nodeSummary: collapsed-row label includes child count for collections", () => {
  assert.equal(nodeSummary([]),               "Array(0)");
  assert.equal(nodeSummary([1, 2, 3]),        "Array(3)");
  assert.equal(nodeSummary({}),               "Object(0)");
  assert.equal(nodeSummary({ a: 1, b: 2 }),   "Object(2)");
  assert.equal(nodeSummary("hi"),             "string");
  assert.equal(nodeSummary(null),             "null");
});

// ─── walk — depth-first visitor ────────────────────────────────────
test("walk: visits the root first, then descends in declaration order", () => {
  const visits = [];
  walk({ a: 1, b: [2, 3] }, ({ path, type }) => visits.push({ path, type }));
  assert.deepEqual(visits, [
    { path: [],        type: "object" },
    { path: ["a"],     type: "number" },
    { path: ["b"],     type: "array"  },
    { path: ["b", 0],  type: "number" },
    { path: ["b", 1],  type: "number" },
  ]);
});

test("walk: empty array / object visits just the root", () => {
  const v = [];
  walk([],     ({ path }) => v.push(path));
  walk({},     ({ path }) => v.push(path));
  assert.deepEqual(v, [[], []]);
});

test("walk: primitives at the root are visited as a single node", () => {
  const v = [];
  walk(42,    ({ value, path }) => v.push({ value, path }));
  walk("hi",  ({ value, path }) => v.push({ value, path }));
  walk(null,  ({ value, path }) => v.push({ value, path }));
  assert.deepEqual(v, [
    { value: 42,    path: [] },
    { value: "hi",  path: [] },
    { value: null,  path: [] },
  ]);
});

// ─── formatPath — RFC 6901 pointer ─────────────────────────────────
test("formatPath: empty array → empty string (root pointer per RFC 6901)", () => {
  assert.equal(formatPath([]), "");
});

test("formatPath: simple object + array indices", () => {
  assert.equal(formatPath(["foo"]),               "/foo");
  assert.equal(formatPath(["foo", "bar"]),        "/foo/bar");
  assert.equal(formatPath(["foo", 0, "bar"]),     "/foo/0/bar");
  assert.equal(formatPath([0, 1, 2]),             "/0/1/2");
});

test("formatPath: escapes ~ and / per RFC 6901", () => {
  assert.equal(formatPath(["a/b"]),       "/a~1b");
  assert.equal(formatPath(["a~b"]),       "/a~0b");
  assert.equal(formatPath(["a~/b"]),      "/a~0~1b");
  // Both, with order ~0 before ~1 (decoder reverses to / first then ~)
  assert.equal(formatPath(["~/~"]),       "/~0~1~0");
});

// ─── prettyPrint / minify ──────────────────────────────────────────
test("prettyPrint: stable 2-space indent by default", () => {
  assert.equal(prettyPrint({ a: 1, b: [2, 3] }), '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
});

test("prettyPrint: indent argument respected", () => {
  assert.equal(prettyPrint([1, 2], 4), "[\n    1,\n    2\n]");
});

test("prettyPrint: undefined → empty string (not 'undefined')", () => {
  assert.equal(prettyPrint(undefined), "");
});

test("minify: no whitespace, mirrors prettyPrint for non-undefined", () => {
  assert.equal(minify({ a: 1, b: [2, 3] }), '{"a":1,"b":[2,3]}');
  assert.equal(minify(undefined),           "");
});

// ─── countNodes / jsonByteSize ─────────────────────────────────────
test("countNodes: counts the root + every descendant", () => {
  assert.equal(countNodes(1),                 1);
  assert.equal(countNodes([1, 2, 3]),         4);  // array + 3 leaves
  assert.equal(countNodes({ a: 1, b: [2,3] }), 5); // root + a + b + 2 + 3
  assert.equal(countNodes(null),              1);
  assert.equal(countNodes({}),                1);
});

test("jsonByteSize: matches the UTF-8 byte length of the prettified form", () => {
  // ASCII: bytes == chars
  assert.equal(jsonByteSize("hello"),    7);   // `"hello"` is 7 bytes
  assert.equal(jsonByteSize(1234),       4);
  // Multi-byte char: "é" is 2 UTF-8 bytes; the JSON is `"é"` = 4 bytes
  assert.equal(jsonByteSize("é"),        4);
});
