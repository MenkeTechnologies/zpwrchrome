// Integration tests for the fzfMatch + highlightWithIndices contract.
// The popup and modal pipe fzf indices straight into the highlighter, so
// the contract that "indices == matched characters of the needle" is the
// load-bearing invariant — pin it across realistic queries.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fzfMatch, highlightWithIndices } from "../lib/fzf.js";

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

function matchedChars(haystack, indices) {
  return indices.map((i) => haystack[i]).join("");
}

test("fzfMatch indices spell the needle (case-insensitive)", () => {
  for (const [needle, haystack] of [
    ["pop",  "popup-render.js"],
    ["pop",  "lib/popup/index.js"],
    ["bg",   "background.js"],
    ["util", "lib/util.js"],
    ["mru",  "manageMru"],
  ]) {
    const m = fzfMatch(needle, haystack);
    assert.notEqual(m, null, `${needle} should match ${haystack}`);
    assert.equal(
      matchedChars(haystack, m.indices).toLowerCase(),
      needle.toLowerCase(),
      `indices for "${needle}" in "${haystack}" must spell needle`
    );
  }
});

test("fzfMatch indices count equals needle length on every successful match", () => {
  const queries = [
    ["a",    "abc"],
    ["abc",  "aaabbbccc"],
    ["xyz",  "xenonyellowzulu"],
    ["go",   "golang-good"],
  ];
  for (const [needle, hay] of queries) {
    const m = fzfMatch(needle, hay);
    assert.equal(m.indices.length, needle.length,
      `indices.length must equal needle.length for "${needle}" in "${hay}"`);
  }
});

test("highlighted output covers exactly the indices fzfMatch returned", () => {
  const m = fzfMatch("popup", "popupRender.js");
  const html = highlightWithIndices("popupRender.js", m.indices, escape);
  // Strip <mark> tags and verify the original haystack survives the round-trip.
  const stripped = html.replace(/<\/?mark[^>]*>/g, "");
  assert.equal(stripped, escape("popupRender.js"),
    "removing <mark> wrappers must restore the escaped haystack verbatim");
});

test("highlight wraps preserve the source haystack character by character", () => {
  // Even when characters are HTML-meaningful, the inner text inside marks
  // is escaped — pin so a future "skip-escape inside mark" refactor breaks.
  const haystack = '<a href="x">b</a>';
  const m = fzfMatch("href", haystack);
  const html = highlightWithIndices(haystack, m.indices, escape);
  // Stripping tags and unescaping back must yield the original.
  const stripped = html.replace(/<\/?mark[^>]*>/g, "");
  assert.equal(stripped, escape(haystack));
});

test("repeated needle character matches the optimal index sequence in haystack", () => {
  const m = fzfMatch("aaa", "abacadefa");
  assert.equal(m.indices.length, 3);
  // Indices must be strictly increasing and each point at lowercase 'a'.
  for (let i = 1; i < m.indices.length; i++) {
    assert.ok(m.indices[i] > m.indices[i - 1]);
  }
  for (const idx of m.indices) {
    assert.equal("abacadefa"[idx].toLowerCase(), "a");
  }
});

test("highlightWithIndices applied to fzfMatch output never overlaps adjacent marks", () => {
  // Pin that adjacent characters get coalesced into one <mark> (saves DOM
  // nodes and matches the existing visual behavior in the popup list).
  const m = fzfMatch("abc", "xabcy");
  const html = highlightWithIndices("xabcy", m.indices, escape);
  assert.equal(html, 'x<mark class="fzf-hl">abc</mark>y');
});

test("fzfMatch + highlight on uppercase needle still wraps the lowercase haystack chars", () => {
  const m = fzfMatch("POP", "popup");
  const html = highlightWithIndices("popup", m.indices, escape);
  assert.equal(html, '<mark class="fzf-hl">pop</mark>up');
});

test("a sorted filter pass produces stable highlighted output across runs", () => {
  const items = ["popup.js", "popup-render.js", "background.js", "modal/content.js"];
  function rank(q) {
    return items
      .map((s) => ({ s, m: fzfMatch(q, s) }))
      .filter((x) => x.m)
      .sort((a, b) => b.m.score - a.m.score)
      .map(({ s, m }) => highlightWithIndices(s, m.indices, escape));
  }
  const a = rank("pop");
  const b = rank("pop");
  assert.deepEqual(a, b);
});

test("fzfMatch followed by highlight preserves total visible length", () => {
  // Stripping HTML tags + un-escaping must reconstruct the original char count.
  const haystacks = ["popupRender.js", "lib/fzf-match.test.js", "deep/nested/path/index.html"];
  for (const h of haystacks) {
    const m = fzfMatch("p", h);
    if (!m) continue;
    const html = highlightWithIndices(h, m.indices, escape);
    const stripped = html.replace(/<\/?mark[^>]*>/g, "");
    // unescape minimum-needed entities for length check (we only inject these
    // in escape() above).
    const unescaped = stripped
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'");
    assert.equal(unescaped.length, h.length,
      `length preserved through highlight for "${h}"`);
  }
});

test("fzfMatch indices on hostname-like haystack target the dot-separated boundaries first", () => {
  // "ex" in "api.example.com" — best match is at the 'e' starting "example".
  const m = fzfMatch("ex", "api.example.com");
  assert.equal(matchedChars("api.example.com", m.indices), "ex");
  // The first matched index must land at the 'e' after the dot (boundary bonus).
  assert.equal(m.indices[0], "api.example.com".indexOf("example"));
});

test("fzfMatch + highlight on empty-needle returns the escaped haystack unchanged", () => {
  const m = fzfMatch("", "anything");
  const html = highlightWithIndices("anything", m.indices, escape);
  assert.equal(html, "anything");
});
