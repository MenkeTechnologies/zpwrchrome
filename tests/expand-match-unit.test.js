// expandMatchPatterns behavioral unit tests in lib/userscript.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { expandMatchPatterns, matchUrl } from "../lib/userscript.js";

test("expandMatchPatterns adds wildcard subdomain for https apex host", () => {
  const out = expandMatchPatterns(["https://amazon.com/*"]);
  assert.ok(out.includes("https://amazon.com/*"));
  assert.ok(out.includes("https://*.amazon.com/*"));
});

test("expandMatchPatterns preserves order with original before generated", () => {
  const out = expandMatchPatterns(["https://a.com/*"]);
  assert.equal(out[0], "https://a.com/*");
  assert.equal(out[1], "https://*.a.com/*");
});

test("expandMatchPatterns does not expand when host already has wildcard prefix", () => {
  const out = expandMatchPatterns(["https://*.google.com/*"]);
  assert.equal(out.length, 1);
});

test("expandMatchPatterns leaves localhost single-label host unchanged", () => {
  const out = expandMatchPatterns(["http://localhost/*"]);
  assert.deepEqual(out, ["http://localhost/*"]);
});

test("expandMatchPatterns leaves numeric IP host unchanged", () => {
  const out = expandMatchPatterns(["http://10.0.0.1/*"]);
  assert.deepEqual(out, ["http://10.0.0.1/*"]);
});

test("expandMatchPatterns skips <all_urls> expansion", () => {
  assert.deepEqual(expandMatchPatterns(["<all_urls>"]), ["<all_urls>"]);
});

test("expandMatchPatterns deduplicates when input repeats same pattern", () => {
  const out = expandMatchPatterns(["https://x.com/*", "https://x.com/*"]);
  assert.equal(out.filter((p) => p === "https://x.com/*").length, 1);
});

test("expandMatchPatterns handles ftp scheme on multi-label host", () => {
  const out = expandMatchPatterns(["ftp://files.example.com/*"]);
  assert.ok(out.includes("ftp://*.files.example.com/*"));
});

test("expandMatchPatterns ignores null and empty string entries", () => {
  assert.deepEqual(expandMatchPatterns([null, "", "https://ok.com/*"]), [
    "https://ok.com/*",
    "https://*.ok.com/*",
  ]);
});

test("expandMatchPatterns returns empty array for non-array input", () => {
  assert.deepEqual(expandMatchPatterns(undefined), []);
  assert.deepEqual(expandMatchPatterns("https://a/*"), []);
});

test("expandMatchPatterns generated wildcard makes www subdomain match", () => {
  const patterns = expandMatchPatterns(["https://example.com/*"]);
  assert.equal(matchUrl(patterns, "https://www.example.com/page"), true);
});

test("expandMatchPatterns preserves path suffix on generated host", () => {
  const out = expandMatchPatterns(["https://host.com/path/*"]);
  assert.ok(out.includes("https://*.host.com/path/*"));
});

test("expandMatchPatterns does not expand host without dot in label", () => {
  const out = expandMatchPatterns(["https://intranet/*"]);
  assert.equal(out.length, 1);
});

test("expandMatchPatterns handles http scheme apex expansion", () => {
  const out = expandMatchPatterns(["http://news.ycombinator.com/*"]);
  assert.ok(out.includes("http://*.news.ycombinator.com/*"));
});

test("expandMatchPatterns star host pattern is left alone", () => {
  const out = expandMatchPatterns(["https://*/*"]);
  assert.deepEqual(out, ["https://*/*"]);
});
