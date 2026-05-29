// End-to-end flow: parseMetadata → expandMatchPatterns → matchUrl.
// The individual functions are unit-tested elsewhere; this file pins the
// composed behavior — a userscript author writes `@match https://amazon.com/*`
// and the registration pipeline silently expands so www.amazon.com fires too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMetadata, expandMatchPatterns, matchUrl } from "../lib/userscript.js";

function pipeline(src) {
  const meta = parseMetadata(src);
  if (!meta) return null;
  const expanded = expandMatchPatterns(meta.matches);
  return { meta, patterns: expanded };
}

const WRAP = (body) => `// ==UserScript==\n${body}// ==/UserScript==\n\nconsole.log("ok");\n`;

test("apex-only @match expands to also cover www subdomain via expandMatchPatterns", () => {
  const { patterns } = pipeline(WRAP([
    "// @name apex-script\n",
    "// @match https://amazon.com/*\n",
  ].join("")));
  assert.ok(matchUrl(patterns, "https://amazon.com/path"),
    "apex itself must still match");
  assert.ok(matchUrl(patterns, "https://www.amazon.com/path"),
    "www subdomain must match after expansion");
});

test("apex @match also covers arbitrary deep subdomains via *.host", () => {
  const { patterns } = pipeline(WRAP([
    "// @name deep-sub\n",
    "// @match https://example.com/*\n",
  ].join("")));
  assert.ok(matchUrl(patterns, "https://a.b.c.example.com/x"),
    "deep multi-label subdomain must match");
});

test("pipeline does NOT match a sibling registrable domain (apex confusion)", () => {
  const { patterns } = pipeline(WRAP([
    "// @name no-sibling\n",
    "// @match https://example.com/*\n",
  ].join("")));
  assert.equal(matchUrl(patterns, "https://example.org/"), false,
    "matching must not bleed to a different TLD");
  assert.equal(matchUrl(patterns, "https://notexample.com/"), false,
    "matching must not bleed to a longer hostname suffix");
});

test("pipeline respects scheme: http @match must not match https URL", () => {
  const { patterns } = pipeline(WRAP([
    "// @name http-only\n",
    "// @match http://internal.test/*\n",
  ].join("")));
  assert.ok(matchUrl(patterns, "http://internal.test/x"));
  assert.equal(matchUrl(patterns, "https://internal.test/x"), false);
});

test("pipeline with * scheme @match covers both http and https but not ftp", () => {
  const { patterns } = pipeline(WRAP([
    "// @name dual-scheme\n",
    "// @match *://example.com/*\n",
  ].join("")));
  assert.ok(matchUrl(patterns, "http://example.com/"));
  assert.ok(matchUrl(patterns, "https://example.com/"));
  assert.equal(matchUrl(patterns, "ftp://example.com/x"), false);
});

test("pipeline leaves localhost @match unexpanded (single-label host)", () => {
  const { patterns } = pipeline(WRAP([
    "// @name local-dev\n",
    "// @match http://localhost/*\n",
  ].join("")));
  assert.ok(matchUrl(patterns, "http://localhost/dev"));
  // Bare host without dot doesn't get a *.localhost variant — and that's
  // intentional: *.localhost would be a no-op since localhost has no parent.
  assert.equal(patterns.some((p) => p.includes("*.localhost")), false);
});

test("pipeline leaves IP literal @match unexpanded", () => {
  const { patterns } = pipeline(WRAP([
    "// @name ip-match\n",
    "// @match http://127.0.0.1/*\n",
  ].join("")));
  assert.ok(matchUrl(patterns, "http://127.0.0.1/x"));
  assert.equal(patterns.some((p) => p.includes("*.127.0.0.1")), false);
});

test("pipeline composes multi-@match block with mixed apex and explicit *.host", () => {
  const { patterns } = pipeline(WRAP([
    "// @name multi\n",
    "// @match https://example.com/*\n",
    "// @match https://*.cdn.example.net/*\n",
  ].join("")));
  // apex + auto-expanded subdomain for example.com:
  assert.ok(matchUrl(patterns, "https://example.com/"));
  assert.ok(matchUrl(patterns, "https://api.example.com/"));
  // explicit *.host for cdn.example.net (no further expansion needed):
  assert.ok(matchUrl(patterns, "https://us-west-2.cdn.example.net/asset"));
});

test("pipeline does NOT register includes (only matches feeds Chrome match patterns)", () => {
  // expandMatchPatterns runs on meta.matches; meta.includes is a separate
  // bucket that requires conversion via includeToMatchPattern. Pin so a
  // future refactor doesn't accidentally union the two and silently grant
  // a Greasemonkey-only @include script broader access than intended.
  const { meta, patterns } = pipeline(WRAP([
    "// @name include-vs-match\n",
    "// @match https://only-this.com/*\n",
    "// @include https://*.other.com/*\n",
  ].join("")));
  assert.equal(meta.includes.length, 1, "@include should land in meta.includes");
  assert.equal(matchUrl(patterns, "https://other.com/x"), false,
    "@include URL must not match via expanded match patterns");
});

test("pipeline matchUrl returns false for URLs not in any pattern (no fall-open)", () => {
  const { patterns } = pipeline(WRAP([
    "// @name strict\n",
    "// @match https://allowed.test/*\n",
  ].join("")));
  assert.equal(matchUrl(patterns, "https://different.test/"), false);
});
