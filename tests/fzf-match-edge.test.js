// fzfMatch scoring edge cases beyond fzf-more.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fzfMatch, FZF_SCORE_MATCH } from "../lib/fzf.js";

test("fzfMatch null when needle longer than haystack", () => {
  assert.equal(fzfMatch("abcdef", "abc"), null);
});

test("fzfMatch exact full-string match scores at least one char match each", () => {
  const m = fzfMatch("tab", "tab");
  assert.ok(m);
  assert.equal(m.indices.length, 3);
  assert.ok(m.score >= FZF_SCORE_MATCH * 3);
});

test("fzfMatch prefers match starting at index zero for same needle", () => {
  const atStart = fzfMatch("git", "github");
  const mid     = fzfMatch("git", "my-git-repo");
  assert.ok(atStart && mid);
  assert.ok(atStart.score >= mid.score);
});

test("fzfMatch handles needle with spaces as gapped match across words", () => {
  const m = fzfMatch("a b", "x a y b z");
  assert.ok(m);
  assert.equal(m.indices[0], 2);
  assert.equal(m.indices.at(-1), 6);
});

test("fzfMatch handles repeated characters in haystack", () => {
  const m = fzfMatch("aaa", "baaaad");
  assert.ok(m);
  assert.deepEqual(m.indices, [1, 2, 3]);
});

test("fzfMatch single character needle always picks first occurrence when tied", () => {
  const m = fzfMatch("a", "banana");
  assert.ok(m);
  assert.equal(m.indices[0], 1);
});

test("fzfMatch unicode haystack matches by code unit index", () => {
  const m = fzfMatch("caf", "café shop");
  assert.ok(m);
  assert.ok(m.indices.every((i) => i < "café shop".length));
});

test("fzfMatch returns null for whitespace-only needle with no matches in haystack", () => {
  assert.equal(fzfMatch("   ", "abc"), null);
});

test("fzfMatch underscore in haystack still matches letters", () => {
  const m = fzfMatch("user", "my_user_name");
  assert.ok(m);
});

test("fzfMatch digits in needle match digits in haystack", () => {
  const m = fzfMatch("404", "error-404-page");
  assert.ok(m);
  assert.deepEqual(m.indices, [6, 7, 8]);
});

test("fzfMatch path-like haystack matches domain segment", () => {
  const m = fzfMatch("github", "https://github.com/repos");
  assert.ok(m);
  assert.ok(m.indices[0] >= 8);
});

test("fzfMatch score increases when adding matching suffix char", () => {
  const two = fzfMatch("ab", "abc");
  const three = fzfMatch("abc", "abc");
  assert.ok(two && three);
  assert.ok(three.score > two.score);
});

test("fzfMatch null when required char missing entirely", () => {
  assert.equal(fzfMatch("z", "hello"), null);
});

test("fzfMatch treats uppercase needle matching lowercase haystack", () => {
  const m = fzfMatch("ABC", "xabcy");
  assert.ok(m);
  assert.deepEqual(m.indices, [1, 2, 3]);
});
