// Unit tests for the public-suffix domain logic in lib/bp-pass.js —
// etldPlusOne() and candidates(). These two exported functions had zero
// direct test coverage; the existing bp-pass suites only exercise
// parseEntry / fallback* / formatEntry.
//
// The bug class targeted here is registrable-domain ("eTLD+1") computation
// for a *password manager*. Getting it wrong is not cosmetic:
//   * A naive `parts.slice(-2)` would collapse `example.co.uk` to the bare
//     public suffix `co.uk`, which would then match credentials for EVERY
//     `.co.uk` site — a cross-site credential-leak bug.
//   * candidates() must descend the subdomain chain down to eTLD+1 and
//     STOP — it must never emit the bare suffix (`co.uk` / `com`) as a
//     matchable host.

import { test } from "node:test";
import assert from "node:assert/strict";

import { etldPlusOne, candidates } from "../lib/bp-pass.js";

test("etldPlusOne: multi-label public suffix keeps the registrable label (not the bare suffix)", () => {
  // The load-bearing case: a deep subdomain over a 2-label suffix must
  // resolve to <registrable>.<suffix>, NOT the bare suffix. A naive
  // slice(-2) impl would return "co.uk" here — the exact wrong answer for
  // a credential matcher.
  assert.equal(etldPlusOne("a.b.example.co.uk"), "example.co.uk");
  assert.equal(etldPlusOne("example.co.uk"),     "example.co.uk");
  assert.equal(etldPlusOne("shop.example.com.au"), "example.com.au");
  // A plain single-label TLD still slices to the last two labels.
  assert.equal(etldPlusOne("foo.bar.baz.com"), "baz.com");
});

test("etldPlusOne: a bare 2-label public suffix is returned unchanged (no registrable label exists)", () => {
  // "co.uk" by itself has no registrable label in front of the suffix, so
  // the multi-label branch's `if (last)` guard must fall through to the
  // generic parts.length<=2 path and return it verbatim — NOT throw, NOT
  // produce ".co.uk".
  assert.equal(etldPlusOne("co.uk"), "co.uk");
  assert.equal(etldPlusOne("com.au"), "com.au");
});

test("etldPlusOne: trailing dots, surrounding whitespace, and case are all normalized", () => {
  // FQDN trailing-dot form + uppercase + padding must collapse to the same
  // lowercase registrable domain — otherwise the same site under two
  // spellings would match two different pass entries.
  assert.equal(etldPlusOne("  WWW.EXAMPLE.COM.  "), "example.com");
  assert.equal(etldPlusOne("Example.Co.UK..."),     "example.co.uk");
  // Degenerate inputs must not throw.
  assert.equal(etldPlusOne(""),          "");
  assert.equal(etldPlusOne(null),        "");
  assert.equal(etldPlusOne("localhost"), "localhost");
});

test("candidates: descends the subdomain chain but never emits the bare public suffix", () => {
  // Over a multi-label suffix, the chain must stop at the registrable
  // domain. Emitting "co.uk" would make a single pass entry match every
  // British site — the credential-leak failure this guards against.
  const cands = candidates("a.b.example.co.uk");
  assert.deepEqual(cands, ["a.b.example.co.uk", "b.example.co.uk", "example.co.uk"]);
  assert.ok(!cands.includes("co.uk"), "must NOT descend to the bare public suffix");

  // Single-label TLD: same invariant — descend to eTLD+1, never bare "com".
  const plain = candidates("foo.bar.example.com");
  assert.deepEqual(plain, ["foo.bar.example.com", "bar.example.com", "example.com"]);
  assert.ok(!plain.includes("com"), "must NOT descend to the bare TLD");
});

test("candidates: registrable-only and degenerate hosts produce the minimal correct list", () => {
  // Already-registrable host: just itself, no phantom suffix entry.
  assert.deepEqual(candidates("example.com"), ["example.com"]);
  // A bare public suffix is returned as a single candidate (matches
  // etldPlusOne) — it is its own eTLD+1 by the function's contract, so the
  // loop terminates immediately rather than looping forever.
  assert.deepEqual(candidates("co.uk"), ["co.uk"]);
  // Empty / whitespace / trailing-dot inputs.
  assert.deepEqual(candidates(""),       []);
  assert.deepEqual(candidates("   "),    []);
  assert.deepEqual(candidates("WWW.EXAMPLE.COM."), ["www.example.com", "example.com"]);
});
