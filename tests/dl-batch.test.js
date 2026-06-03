// Batch URL expansion — port of Chrono / IDM / DTA bracket-range patterns.

import { test } from "node:test";
import assert from "node:assert/strict";
import { expandBatch, expandBatchSafe, hasBatchPattern, MAX_EXPANSION } from "../lib/dl-batch.js";

test("plain URL passes through unchanged", () => {
  assert.deepEqual(expandBatch("https://x.com/file.zip"), ["https://x.com/file.zip"]);
});

test("simple numeric range [1:3]", () => {
  assert.deepEqual(expandBatch("https://x.com/p[1:3].html"), [
    "https://x.com/p1.html",
    "https://x.com/p2.html",
    "https://x.com/p3.html",
  ]);
});

test("zero-padded numeric range [01:99] preserves width", () => {
  const r = expandBatch("https://x.com/img[01:05].jpg");
  assert.equal(r.length, 5);
  assert.equal(r[0], "https://x.com/img01.jpg");
  assert.equal(r[4], "https://x.com/img05.jpg");
});

test("step parameter [0:20:5] gives 5 values", () => {
  assert.deepEqual(expandBatch("https://x.com/p[0:20:5].html"), [
    "https://x.com/p0.html",
    "https://x.com/p5.html",
    "https://x.com/p10.html",
    "https://x.com/p15.html",
    "https://x.com/p20.html",
  ]);
});

test("descending numeric range [9:7]", () => {
  assert.deepEqual(expandBatch("https://x.com/p[9:7].html"),
    ["https://x.com/p9.html", "https://x.com/p8.html", "https://x.com/p7.html"]);
});

test("alpha range [a:f]", () => {
  assert.deepEqual(expandBatch("https://x.com/[a:f].txt"), [
    "https://x.com/a.txt", "https://x.com/b.txt", "https://x.com/c.txt",
    "https://x.com/d.txt", "https://x.com/e.txt", "https://x.com/f.txt",
  ]);
});

test("alpha range [Z:X] descending", () => {
  assert.deepEqual(expandBatch("https://x.com/[Z:X].txt"),
    ["https://x.com/Z.txt", "https://x.com/Y.txt", "https://x.com/X.txt"]);
});

test("cartesian product of two ranges", () => {
  const r = expandBatch("https://x.com/x[1:2]-[a:b].png");
  assert.deepEqual(r, [
    "https://x.com/x1-a.png",
    "https://x.com/x1-b.png",
    "https://x.com/x2-a.png",
    "https://x.com/x2-b.png",
  ]);
});

test("three ranges produce length(a)*length(b)*length(c) URLs", () => {
  const r = expandBatch("https://x.com/[1:2]-[a:b]-[X:Y].png");
  assert.equal(r.length, 2 * 2 * 2);
  assert.ok(r.includes("https://x.com/1-a-X.png"));
  assert.ok(r.includes("https://x.com/2-b-Y.png"));
});

test("expansion cap rejects pathological inputs", () => {
  // 1000 * 1000 = 1,000,000 → cap is 1000.
  assert.throws(() => expandBatch("https://x.com/[1:1000]-[1:1000].html"), /cap 1000/);
});

test("expandBatchSafe never throws — returns [url] on cap or bad syntax", () => {
  assert.deepEqual(expandBatchSafe("https://x.com/[1:1000]-[1:1000].html"),
    ["https://x.com/[1:1000]-[1:1000].html"]);
});

test("hasBatchPattern detects bracket ranges", () => {
  assert.equal(hasBatchPattern("https://x.com/[1:3].txt"), true);
  assert.equal(hasBatchPattern("https://x.com/[a:f].txt"), true);
  assert.equal(hasBatchPattern("https://x.com/plain.txt"), false);
  // [ and ] without colon don't count.
  assert.equal(hasBatchPattern("https://x.com/file[1].txt"), false);
});

test("empty / non-string input returns []", () => {
  assert.deepEqual(expandBatch(""), []);
  assert.deepEqual(expandBatch(undefined), []);
  assert.deepEqual(expandBatch(null), []);
});

test("MAX_EXPANSION is exposed for callers that want to pre-check", () => {
  assert.equal(typeof MAX_EXPANSION, "number");
  assert.ok(MAX_EXPANSION >= 100);
});
