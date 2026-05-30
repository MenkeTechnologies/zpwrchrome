// Round-4 pins for validateUserscript malformed-input handling and
// expandMatchPatterns edge cases (port-bearing hosts, schemeless input,
// trailing-slash variations). These are the regressions most likely
// to surface in real userscripts shipped from greasyfork/openuserjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateUserscript, expandMatchPatterns, isValidMatchPattern } from "../lib/userscript.js";

// ── validateUserscript: malformed-meta handling ───────────────────

test("validateUserscript returns marker error when meta is null", () => {
  const errs = validateUserscript(null);
  assert.deepEqual(errs, ["no ==UserScript== block found"]);
});

test("validateUserscript returns marker error when meta is undefined", () => {
  const errs = validateUserscript(undefined);
  assert.deepEqual(errs, ["no ==UserScript== block found"]);
});

test("validateUserscript flags missing @name even with valid matches", () => {
  // meta has matches but no name — must emit "missing @name" but accept
  // the rest. Pin both: error string AND that no spurious error is added.
  const errs = validateUserscript({
    name: "",
    matches: ["https://example.com/*"],
    includes: [],
  });
  assert.ok(errs.includes("missing @name"), "expected missing @name error");
  // No invalid-pattern error for the valid match.
  assert.equal(errs.filter((e) => e.startsWith("invalid @match")).length, 0);
});

test("validateUserscript accepts @include-only userscript (no @match required)", () => {
  // The fallback path: @include is the older GreaseMonkey form that
  // many legacy userscripts still ship with. Must be accepted alone.
  const errs = validateUserscript({
    name: "Legacy Script",
    matches: [],
    includes: ["https://example.com/*"],
  });
  assert.equal(errs.length, 0, `unexpected errors: ${JSON.stringify(errs)}`);
});

test("validateUserscript reports per-pattern error for each invalid @match", () => {
  // Two invalid matches must yield two errors, each naming the bad
  // pattern. Loss of per-pattern reporting would hide the second issue
  // until the user fixed the first.
  const errs = validateUserscript({
    name: "Bad Matches",
    matches: ["ftp://oops", "junk-string"],
    includes: [],
  });
  assert.equal(
    errs.filter((e) => e.startsWith("invalid @match pattern:")).length,
    2,
    `expected 2 invalid-match errors, got: ${JSON.stringify(errs)}`,
  );
});

// ── expandMatchPatterns: edge cases not covered by existing tests ──

test("expandMatchPatterns filters non-string input silently (no throw)", () => {
  // Real metadata parsers occasionally emit `null` or `undefined` in
  // the matches array if a malformed @match line slipped through. The
  // function must tolerate these without throwing.
  const out = expandMatchPatterns([null, undefined, 42, "", "https://x.com/*"]);
  assert.ok(out.includes("https://x.com/*"));
  // No `null`, `undefined`, `42`, or empty string in output.
  for (const v of out) {
    assert.equal(typeof v, "string");
    assert.notEqual(v, "");
  }
});

test("expandMatchPatterns returns empty array for non-array input", () => {
  // Defensive: a caller passing the wrong shape (string, object) must
  // get [] back, not a thrown TypeError that bubbles to the user.
  assert.deepEqual(expandMatchPatterns("https://x.com/*"), []);
  assert.deepEqual(expandMatchPatterns(null), []);
  assert.deepEqual(expandMatchPatterns({}), []);
  assert.deepEqual(expandMatchPatterns(undefined), []);
});

test("expandMatchPatterns handles wildcard scheme `*://` (Chrome shorthand)", () => {
  // `*://host/*` is Chrome's "http or https" shorthand. The expansion
  // must produce both apex and wildcard-subdomain forms with the
  // wildcard scheme preserved.
  const out = expandMatchPatterns(["*://example.com/*"]);
  assert.ok(out.includes("*://example.com/*"));
  assert.ok(out.includes("*://*.example.com/*"));
});
