// highlightWithIndices defensive-input tests: out-of-bounds indices, negative
// indices, fractional indices, unsorted indices. The fzf-highlight-more and
// fzf-more files cover the normal contiguous + non-contiguous cases — these
// pin behavior on inputs that misbehaving callers may produce.

import { test } from "node:test";
import assert from "node:assert/strict";
import { highlightWithIndices } from "../lib/fzf.js";

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

test("highlightWithIndices ignores indices past text length without crashing", () => {
  assert.equal(highlightWithIndices("abc", [5, 10], escape), "abc");
});

test("highlightWithIndices ignores fractional indices (Set membership exact-equal)", () => {
  // The Set holds the raw number; comparing `i` (integer) against 1.5
  // never matches, so no wrap happens.
  assert.equal(highlightWithIndices("abc", [1.5], escape), "abc");
});

test("highlightWithIndices ignores negative indices and wraps only valid ones", () => {
  // Loop iterates `i` from 0..text.length-1. Negative entries in the Set
  // never match an iteration value.
  assert.equal(
    highlightWithIndices("abc", [-1, 0], escape),
    '<mark class="fzf-hl">a</mark>bc'
  );
});

test("highlightWithIndices mixes valid and out-of-bounds indices, wrapping only valid ones", () => {
  assert.equal(
    highlightWithIndices("abc", [1, 99], escape),
    'a<mark class="fzf-hl">b</mark>c'
  );
});

test("highlightWithIndices does not require indices to be sorted", () => {
  // Set-membership is position-based, so unsorted input still wraps the
  // correct characters in source order.
  assert.equal(
    highlightWithIndices("abcdef", [4, 0, 2], escape),
    '<mark class="fzf-hl">a</mark>b<mark class="fzf-hl">c</mark>d<mark class="fzf-hl">e</mark>f'
  );
});

test("highlightWithIndices closes <mark> at end-of-string when last char is matched", () => {
  // Defensive against an off-by-one that would leave a stray open <mark>.
  assert.equal(
    highlightWithIndices("xy", [1], escape),
    'x<mark class="fzf-hl">y</mark>'
  );
});

test("highlightWithIndices handles all-out-of-bounds indices on non-empty text", () => {
  assert.equal(
    highlightWithIndices("hello", [100, 200, 300], escape),
    "hello"
  );
});

test("highlightWithIndices preserves marked HTML entities in escaped output", () => {
  // The matched '<' must still be escaped to &lt; inside the <mark> wrap.
  assert.equal(
    highlightWithIndices("<a>", [0, 1, 2], escape),
    '<mark class="fzf-hl">&lt;a&gt;</mark>'
  );
});

test("highlightWithIndices on single-char text with index 0 wraps entire output", () => {
  assert.equal(
    highlightWithIndices("z", [0], escape),
    '<mark class="fzf-hl">z</mark>'
  );
});

test("highlightWithIndices does not emit an empty <mark> tag pair", () => {
  // Pin that valid input never yields the malformed `<mark></mark>` shape.
  const out = highlightWithIndices("abc", [0, 2], escape);
  assert.equal(out.includes("<mark class=\"fzf-hl\"></mark>"), false);
});

test("highlightWithIndices with sparse mid-string indices alternates correctly", () => {
  assert.equal(
    highlightWithIndices("xyzwq", [1, 3], escape),
    'x<mark class="fzf-hl">y</mark>z<mark class="fzf-hl">w</mark>q'
  );
});
