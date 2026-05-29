// Fuzz tests for lib/fzf.js: 500-iteration randomised sweep that verifies
// per-call invariants hold for any input. Uses a deterministic PRNG so CI
// reruns are reproducible — a failure here points at a specific seed and
// iteration that can be replayed verbatim.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fzfMatch, highlightWithIndices } from "../lib/fzf.js";

// mulberry32 — 32-bit PRNG, deterministic from seed, no external deps.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ASCII = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_./ ";

function randStr(rand, maxLen) {
  const len = Math.floor(rand() * maxLen) + 1;
  let s = "";
  for (let i = 0; i < len; i++) s += ASCII[Math.floor(rand() * ASCII.length)];
  return s;
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

test("fuzz: fzfMatch never throws on 500 random needle/haystack pairs", () => {
  const r = rng(0xfeedface);
  for (let i = 0; i < 500; i++) {
    const needle = randStr(r, 12);
    const haystack = randStr(r, 60);
    assert.doesNotThrow(
      () => fzfMatch(needle, haystack),
      `iteration ${i}: needle="${needle}" haystack="${haystack}"`
    );
  }
});

test("fuzz: successful fzfMatch always returns indices.length === needle.length", () => {
  const r = rng(0xdeadbeef);
  let successes = 0;
  for (let i = 0; i < 500; i++) {
    const needle = randStr(r, 6);
    const haystack = randStr(r, 40);
    const m = fzfMatch(needle, haystack);
    if (m && needle.length > 0) {
      successes++;
      assert.equal(m.indices.length, needle.length,
        `seed=${0xdeadbeef} i=${i} needle="${needle}" haystack="${haystack}" indices=${JSON.stringify(m.indices)}`);
    }
  }
  // Sanity: with ASCII + short needles vs longer haystacks, at least some
  // matches should happen. Without this the fuzz coverage is meaningless.
  assert.ok(successes > 50, `expected ≥50 successful matches across 500 iterations, got ${successes}`);
});

test("fuzz: fzfMatch indices are strictly increasing and within haystack bounds", () => {
  const r = rng(0xcafebabe);
  for (let i = 0; i < 500; i++) {
    const needle = randStr(r, 6);
    const haystack = randStr(r, 40);
    const m = fzfMatch(needle, haystack);
    if (!m) continue;
    for (let j = 0; j < m.indices.length; j++) {
      assert.ok(m.indices[j] >= 0 && m.indices[j] < haystack.length,
        `i=${i} idx[${j}]=${m.indices[j]} out of [0, ${haystack.length})`);
      if (j > 0) {
        assert.ok(m.indices[j] > m.indices[j - 1],
          `i=${i} indices not strictly increasing: ${JSON.stringify(m.indices)}`);
      }
    }
  }
});

test("fuzz: fzfMatch indices spell the needle case-insensitively", () => {
  const r = rng(0x12345678);
  for (let i = 0; i < 500; i++) {
    const needle = randStr(r, 6);
    const haystack = randStr(r, 40);
    const m = fzfMatch(needle, haystack);
    if (!m || needle.length === 0) continue;
    const matched = m.indices.map((idx) => haystack[idx]).join("");
    assert.equal(matched.toLowerCase(), needle.toLowerCase(),
      `i=${i} needle="${needle}" matched="${matched}" indices=${JSON.stringify(m.indices)}`);
  }
});

test("fuzz: fzfMatch score is always a finite number on successful matches", () => {
  const r = rng(0x87654321);
  for (let i = 0; i < 500; i++) {
    const needle = randStr(r, 6);
    const haystack = randStr(r, 40);
    const m = fzfMatch(needle, haystack);
    if (!m) continue;
    assert.equal(Number.isFinite(m.score), true,
      `i=${i} score=${m.score} not finite`);
  }
});

test("fuzz: highlightWithIndices roundtrip preserves the haystack chars", () => {
  // For any (needle, haystack), strip <mark> wrappers from the highlighter
  // and the unescaped result must equal the original haystack.
  const r = rng(0x0badf00d);
  for (let i = 0; i < 500; i++) {
    const needle = randStr(r, 6);
    const haystack = randStr(r, 40);
    const m = fzfMatch(needle, haystack);
    const html = highlightWithIndices(haystack, m ? m.indices : null, escape);
    const stripped = html.replace(/<\/?mark[^>]*>/g, "");
    const unescaped = stripped
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'");
    assert.equal(unescaped, haystack,
      `i=${i} roundtrip failed haystack="${haystack}" html="${html}"`);
  }
});

test("fuzz: fzfMatch is deterministic — same inputs produce identical outputs", () => {
  const r = rng(0xa1b2c3d4);
  for (let i = 0; i < 200; i++) {
    const needle = randStr(r, 6);
    const haystack = randStr(r, 40);
    const a = fzfMatch(needle, haystack);
    const b = fzfMatch(needle, haystack);
    assert.deepEqual(a, b, `i=${i} non-deterministic for needle="${needle}" haystack="${haystack}"`);
  }
});

test("fuzz: fzfMatch returns null OR a {score, indices} shape — never anything else", () => {
  const r = rng(0xbabecafe);
  for (let i = 0; i < 500; i++) {
    const needle = randStr(r, 8);
    const haystack = randStr(r, 40);
    const m = fzfMatch(needle, haystack);
    if (m === null) continue;
    assert.equal(typeof m, "object", `i=${i} non-object result`);
    assert.equal(typeof m.score, "number");
    assert.ok(Array.isArray(m.indices));
  }
});

test("fuzz: fzfMatch + highlight visible-length invariant (no length distortion)", () => {
  const r = rng(0x42424242);
  for (let i = 0; i < 300; i++) {
    const needle = randStr(r, 4);
    const haystack = randStr(r, 30);
    const m = fzfMatch(needle, haystack);
    if (!m) continue;
    const html = highlightWithIndices(haystack, m.indices, escape);
    const stripped = html.replace(/<\/?mark[^>]*>/g, "");
    // visible text length (after un-escaping common entities) equals haystack
    const visible = stripped
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'");
    assert.equal(visible.length, haystack.length);
  }
});

test("fuzz: empty-needle fast path always returns score=0 with no indices", () => {
  const r = rng(0x55aa55aa);
  for (let i = 0; i < 100; i++) {
    const haystack = randStr(r, 50);
    const m = fzfMatch("", haystack);
    assert.deepEqual(m, { score: 0, indices: [] }, `i=${i} haystack="${haystack}"`);
  }
});
