// hostnameOf and expandMatchPatterns behavioral edge cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import { hostnameOf } from "../lib/util.js";
import { expandMatchPatterns, matchUrl, matchPatternToRegex } from "../lib/userscript.js";

test("hostnameOf returns (local) for file:// URLs", () => {
  assert.equal(hostnameOf("file:///Users/wizard/page.html"), "(local)");
});

test("hostnameOf returns (other) for garbage strings", () => {
  assert.equal(hostnameOf("not-a-url"), "(other)");
  assert.equal(hostnameOf(""), "(other)");
});

test("hostnameOf strips port from host", () => {
  assert.equal(hostnameOf("https://example.com:8443/x"), "example.com");
});

test("hostnameOf preserves punycode hostnames", () => {
  assert.equal(hostnameOf("https://xn--mnchen-3ya.de/"), "xn--mnchen-3ya.de");
});

test("expandMatchPatterns adds wildcard subdomain for multi-label apex hosts", () => {
  const out = expandMatchPatterns(["https://news.ycombinator.com/*"]);
  assert.ok(out.includes("https://news.ycombinator.com/*"));
  assert.ok(out.includes("https://*.news.ycombinator.com/*"));
});

test("expandMatchPatterns does not double-expand already wildcarded hosts", () => {
  const out = expandMatchPatterns(["https://*.google.com/*"]);
  assert.equal(out.length, 1);
});

test("expandMatchPatterns ignores ftp scheme hosts without dot (single label)", () => {
  const out = expandMatchPatterns(["ftp://intranet/*"]);
  assert.deepEqual(out, ["ftp://intranet/*"]);
});

test("expandMatchPatterns skips null and non-string entries", () => {
  assert.deepEqual(expandMatchPatterns([null, "", "https://a.com/*"]), ["https://a.com/*", "https://*.a.com/*"]);
});

test("matchUrl returns false for empty patterns array", () => {
  assert.equal(matchUrl([], "https://example.com/"), false);
});

test("matchUrl returns false when no pattern matches", () => {
  assert.equal(matchUrl(["https://other.com/*"], "https://example.com/"), false);
});

test("matchPatternToRegex * scheme matches https URLs", () => {
  const re = matchPatternToRegex("*://example.com/*");
  assert.ok(re.test("https://example.com/path"));
});

test("matchPatternToRegex explicit path * matches nested segments", () => {
  const re = matchPatternToRegex("https://example.com/*");
  assert.ok(re.test("https://example.com/a/b/c"));
});

test("matchPatternToRegex rejects path-less patterns", () => {
  assert.equal(matchPatternToRegex("https://example.com"), null);
});

test("expandMatchPatterns preserves https scheme on generated wildcard host", () => {
  const out = expandMatchPatterns(["http://example.co.uk/*"]);
  assert.ok(out.some((p) => p.startsWith("http://*.example.co.uk")));
});

test("hostnameOf handles custom protocol URLs via URL parser", () => {
  assert.equal(hostnameOf("chrome://settings/"), "settings");
});

test("matchUrl matches expanded apex pattern against www subdomain URL", () => {
  const patterns = expandMatchPatterns(["https://amazon.com/*"]);
  assert.ok(matchUrl(patterns, "https://www.amazon.com/dp/123"));
});

test("expandMatchPatterns leaves IPv6-looking hostnames with dots alone when numeric", () => {
  const out = expandMatchPatterns(["http://192.168.1.1/*"]);
  assert.deepEqual(out, ["http://192.168.1.1/*"]);
});

test("hostnameOf for ws/wss is parsed by URL (returns host or other)", () => {
  const h = hostnameOf("wss://echo.websocket.org/x");
  assert.equal(h, "echo.websocket.org");
});
