// highlightWithIndices edge cases beyond tests/fzf.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { highlightWithIndices, fzfMatch } from "../lib/fzf.js";

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

test("highlightWithIndices wraps entire string when all indices match", () => {
  const out = highlightWithIndices("abc", [0, 1, 2], escape);
  assert.equal(out, '<mark class="fzf-hl">abc</mark>');
});

test("highlightWithIndices keeps contiguous matches in one mark element", () => {
  const out = highlightWithIndices("hello", [1, 2, 3], escape);
  assert.equal(out, 'h<mark class="fzf-hl">ell</mark>o');
});

test("highlightWithIndices escapes HTML inside matched regions", () => {
  const out = highlightWithIndices("<script>", [0, 1, 2, 3, 4, 5, 6, 7], escape);
  assert.ok(out.includes("&lt;script&gt;"));
  assert.ok(out.includes('<mark class="fzf-hl">'));
});

test("highlightWithIndices handles index 0 only", () => {
  const out = highlightWithIndices("tabs", [0], escape);
  assert.equal(out, '<mark class="fzf-hl">t</mark>abs');
});

test("highlightWithIndices handles last character index", () => {
  const out = highlightWithIndices("tabs", [3], escape);
  assert.equal(out, 'tab<mark class="fzf-hl">s</mark>');
});

test("highlightWithIndices returns escaped plain text for empty indices array", () => {
  assert.equal(highlightWithIndices("a&b", [], escape), "a&amp;b");
});

test("highlightWithIndices handles unicode code units by index", () => {
  const text = "café";
  const out = highlightWithIndices(text, [0, 1, 2], escape);
  assert.match(out, /<mark class="fzf-hl">caf<\/mark>/);
});

test("highlightWithIndices does not emit empty mark tags", () => {
  const out = highlightWithIndices("abc", [1], escape);
  assert.ok(!out.includes("<mark></mark>"));
});

test("fzfMatch indices align with highlightWithIndices for real query", () => {
  const hay = "GitHub — zpwrchrome extension";
  const m = fzfMatch("zpwr", hay);
  assert.ok(m);
  const out = highlightWithIndices(hay, m.indices, escape);
  for (const i of m.indices) {
    assert.ok(out.includes(escape(hay[i])), `highlight missing char at ${i}`);
  }
});

test("highlightWithIndices alternates mark and plain segments correctly", () => {
  const out = highlightWithIndices("a1b2c3", [0, 2, 4], escape);
  assert.equal(out,
    '<mark class="fzf-hl">a</mark>1<mark class="fzf-hl">b</mark>2<mark class="fzf-hl">c</mark>3');
});

test("highlightWithIndices handles apostrophe in matched text", () => {
  const out = highlightWithIndices("Menke's", [0, 1, 2, 3, 4], escape);
  assert.ok(out.includes("&#39;"));
});

test("highlightWithIndices single-character haystack with match", () => {
  assert.equal(highlightWithIndices("x", [0], escape), '<mark class="fzf-hl">x</mark>');
});

test("fzfMatch on hostname-like string produces highlightable indices", () => {
  const m = fzfMatch("github", "github.com/repos");
  assert.ok(m);
  const html = highlightWithIndices("github.com/repos", m.indices, escape);
  assert.match(html, /<mark class="fzf-hl">github<\/mark>/);
});

test("highlightWithIndices preserves unmatched middle segment between marks", () => {
  const out = highlightWithIndices("x-y-z", [0, 4], escape);
  assert.equal(out, '<mark class="fzf-hl">x</mark>-y-<mark class="fzf-hl">z</mark>');
});
