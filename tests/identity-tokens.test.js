// Unit tests for lib/identity-tokens.js — recognition order, synonym
// coverage, opt-out behavior, and the expandFieldValue alias chains
// (cc-exp derived from month+year, given/family-name split from name,
// street-address joined from line1/2/3).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PROFILE_TOKENS,
  CC_TOKENS,
  TOKEN_SYNONYMS,
  normalizeForMatch,
  recognizeField,
  expandFieldValue,
} from "../lib/identity-tokens.js";

// ─── Token sets ────────────────────────────────────────────────────
test("token sets are frozen + non-empty + disjoint", () => {
  assert.ok(Object.isFrozen(PROFILE_TOKENS));
  assert.ok(Object.isFrozen(CC_TOKENS));
  assert.ok(PROFILE_TOKENS.length > 10, "PROFILE_TOKENS should cover the major identity fields");
  assert.ok(CC_TOKENS.length     >= 8,  "CC_TOKENS should cover the WHATWG cc-* set");
  const profileSet = new Set(PROFILE_TOKENS);
  for (const t of CC_TOKENS) {
    assert.ok(!profileSet.has(t), `${t} appears in both PROFILE_TOKENS and CC_TOKENS`);
  }
});

test("synonym map only points at known tokens", () => {
  const known = new Set([...PROFILE_TOKENS, ...CC_TOKENS]);
  for (const k of Object.keys(TOKEN_SYNONYMS)) {
    assert.ok(known.has(k), `TOKEN_SYNONYMS key "${k}" is not a known token`);
  }
});

// ─── normalizeForMatch ─────────────────────────────────────────────
test("normalizeForMatch lowercases + folds [_ space] to '-'", () => {
  assert.equal(normalizeForMatch("Card Number"),    "card-number");
  assert.equal(normalizeForMatch("cc_exp_month"),   "cc-exp-month");
  assert.equal(normalizeForMatch("CCNumber"),       "ccnumber");
  assert.equal(normalizeForMatch(undefined),        "");
  assert.equal(normalizeForMatch(null),             "");
});

// ─── autocomplete attribute precedence ─────────────────────────────
test("autocomplete attribute alone resolves the token", () => {
  assert.equal(recognizeField({ autocomplete: "cc-number" }), "cc-number");
  assert.equal(recognizeField({ autocomplete: "given-name" }), "given-name");
  assert.equal(recognizeField({ autocomplete: "street-address" }), "street-address");
});

test("composite autocomplete (shipping street-address) picks the known token", () => {
  assert.equal(recognizeField({ autocomplete: "shipping street-address" }), "street-address");
  assert.equal(recognizeField({ autocomplete: "section-foo billing cc-csc" }), "cc-csc");
});

test("autocomplete=off / current-password / new-password short-circuits to null (opt-out)", () => {
  assert.equal(recognizeField({ autocomplete: "off",              name: "card-number" }), null);
  assert.equal(recognizeField({ autocomplete: "current-password", id: "cc-number"     }), null);
  assert.equal(recognizeField({ autocomplete: "new-password",     name: "cardholder"  }), null);
});

test("autocomplete attribute wins over name-based recognition", () => {
  // name says "fname" (given-name) but autocomplete says cc-csc
  assert.equal(recognizeField({ autocomplete: "cc-csc", name: "fname" }), "cc-csc");
});

// ─── synonym substring matching ────────────────────────────────────
test("recognizes cc-number from common name attributes", () => {
  assert.equal(recognizeField({ name: "ccnumber" }),       "cc-number");
  assert.equal(recognizeField({ name: "cc-num" }),         "cc-number");
  assert.equal(recognizeField({ name: "cardNumber" }),     "cc-number");
  assert.equal(recognizeField({ name: "credit_card_number" }), "cc-number");
});

test("recognizes cc-csc from cvv/cvc/security-code patterns", () => {
  assert.equal(recognizeField({ name: "cvv" }),           "cc-csc");
  assert.equal(recognizeField({ id: "cvc" }),             "cc-csc");
  assert.equal(recognizeField({ placeholder: "Security Code" }), "cc-csc");
  assert.equal(recognizeField({ label: "Card verification" }), "cc-csc");
});

test("cc-exp-month / cc-exp-year beat cc-exp on longer match", () => {
  // Longest-synonym match: "exp-month" (9 chars) wins over "exp" / "expiry" (6).
  assert.equal(recognizeField({ name: "exp-month" }), "cc-exp-month");
  assert.equal(recognizeField({ name: "exp-year"  }), "cc-exp-year");
  // Bare exp / expiry still maps to cc-exp.
  assert.equal(recognizeField({ name: "expiry"    }), "cc-exp");
  assert.equal(recognizeField({ name: "exp-date"  }), "cc-exp");
});

test("recognizes name parts (given/family/middle/honorific)", () => {
  assert.equal(recognizeField({ name: "first-name" }),       "given-name");
  assert.equal(recognizeField({ name: "fname" }),            "given-name");
  assert.equal(recognizeField({ id:   "last_name" }),        "family-name");
  assert.equal(recognizeField({ name: "lname" }),            "family-name");
  assert.equal(recognizeField({ name: "middle-name" }),      "additional-name");
  assert.equal(recognizeField({ name: "salutation" }),       "honorific-prefix");
});

test("recognizes address parts (line1/2/3, city, state, postal)", () => {
  assert.equal(recognizeField({ name: "address1" }),      "address-line1");
  assert.equal(recognizeField({ name: "addr2" }),         "address-line2");
  assert.equal(recognizeField({ id: "street-address" }),  "street-address");
  assert.equal(recognizeField({ name: "city" }),          "address-level2");
  assert.equal(recognizeField({ name: "state" }),         "address-level1");
  assert.equal(recognizeField({ name: "zip" }),           "postal-code");
  assert.equal(recognizeField({ name: "postcode" }),      "postal-code");
});

test("recognizes contact fields (email, tel)", () => {
  assert.equal(recognizeField({ name: "email" }),        "email");
  assert.equal(recognizeField({ name: "phone" }),        "tel");
  assert.equal(recognizeField({ name: "telephone" }),    "tel");
  assert.equal(recognizeField({ name: "mobile-number" }),"tel");
});

test("falls back to input type when name/id/label are useless", () => {
  // empty haystack, but type tells us
  assert.equal(recognizeField({ type: "email" }), "email");
  assert.equal(recognizeField({ type: "tel" }),   "tel");
});

test("returns null when nothing matches", () => {
  assert.equal(recognizeField({ name: "totally-unrelated" }), null);
  assert.equal(recognizeField({}), null);
  assert.equal(recognizeField(null), null);
  assert.equal(recognizeField(undefined), null);
});

test("longest-synonym match resolves cc-exp-month even when label also contains exp", () => {
  // Real-world: <label>Expiration Month</label>
  assert.equal(recognizeField({ label: "Expiration Month" }), "cc-exp-month");
});

test("haystack draws from all of name/id/label/placeholder", () => {
  assert.equal(recognizeField({ placeholder: "Card number"    }), "cc-number");
  assert.equal(recognizeField({ label:       "ZIP / Postcode" }), "postal-code");
});

// ─── expandFieldValue ──────────────────────────────────────────────
test("expandFieldValue: direct hit returns the field value as a string", () => {
  assert.equal(expandFieldValue("cc-number", { "cc-number": "4111 1111 1111 1111" }),
                                              "4111 1111 1111 1111");
  assert.equal(expandFieldValue("email",     { email: "foo@bar.test" }), "foo@bar.test");
});

test("expandFieldValue: empty / missing returns null", () => {
  assert.equal(expandFieldValue("cc-number", {}), null);
  assert.equal(expandFieldValue("cc-number", { "cc-number": "" }), null);
  assert.equal(expandFieldValue("cc-number", { "cc-number": null }), null);
});

test("expandFieldValue: cc-exp derived from month+year (MM/YY)", () => {
  assert.equal(expandFieldValue("cc-exp", { "cc-exp-month": "9",  "cc-exp-year": "2031" }), "09/31");
  assert.equal(expandFieldValue("cc-exp", { "cc-exp-month": "12", "cc-exp-year": "29"   }), "12/29");
});

test("expandFieldValue: cc-exp-month / cc-exp-year extracted from cc-exp", () => {
  assert.equal(expandFieldValue("cc-exp-month", { "cc-exp": "09/31" }), "09");
  assert.equal(expandFieldValue("cc-exp-year",  { "cc-exp": "09/31" }), "31");
  assert.equal(expandFieldValue("cc-exp-month", { "cc-exp": "9-2031" }), "09");
  assert.equal(expandFieldValue("cc-exp-year",  { "cc-exp": "9-2031" }), "2031");
});

test("expandFieldValue: name composed from given + additional + family", () => {
  assert.equal(expandFieldValue("name", {
    "given-name": "Jane", "additional-name": "P", "family-name": "Doe",
  }), "Jane P Doe");
  assert.equal(expandFieldValue("name", { "given-name": "Jane", "family-name": "Doe" }),
                                          "Jane Doe");
});

test("expandFieldValue: given-name / family-name split out of a single name field", () => {
  assert.equal(expandFieldValue("given-name",  { name: "Jane P Doe" }), "Jane");
  assert.equal(expandFieldValue("family-name", { name: "Jane P Doe" }), "Doe");
  // single-word name has no surname
  assert.equal(expandFieldValue("family-name", { name: "Jane" }), null);
});

test("expandFieldValue: cc-name falls back through name → cc-given/family → given/family", () => {
  assert.equal(expandFieldValue("cc-name", { "name": "Jane Doe" }), "Jane Doe");
  assert.equal(expandFieldValue("cc-name", { "cc-given-name": "J", "cc-family-name": "M" }), "J M");
  assert.equal(expandFieldValue("cc-name", { "given-name": "Jane", "family-name": "Doe" }), "Jane Doe");
});

test("expandFieldValue: street-address joins address-line1/2/3 with newlines", () => {
  assert.equal(expandFieldValue("street-address", {
    "address-line1": "123 Main St", "address-line2": "Apt 4",
  }), "123 Main St\nApt 4");
  assert.equal(expandFieldValue("street-address", { "address-line1": "Only line" }), "Only line");
});

test("expandFieldValue: address-line1 falls back to the first line of street-address", () => {
  assert.equal(expandFieldValue("address-line1", { "street-address": "123 Main St\nApt 4" }), "123 Main St");
});

test("expandFieldValue: country-name falls back to country", () => {
  assert.equal(expandFieldValue("country-name", { country: "United States" }), "United States");
  assert.equal(expandFieldValue("country-name", {}), null);
});

// ─── Friendly-name lookup in the pass entry ────────────────────────
// The pass entry can use either canonical autocomplete tokens
// (`address-level2`) or friendly synonyms (`city`, `state`, `zipcode`)
// as keys; both work because expandFieldValue scans the synonym list
// when direct lookup misses.

test("expandFieldValue: address-level2 resolves from `city`", () => {
  assert.equal(expandFieldValue("address-level2", { city: "Springfield" }), "Springfield");
});

test("expandFieldValue: address-level1 resolves from `state` / `province` / `region`", () => {
  assert.equal(expandFieldValue("address-level1", { state:    "IL" }), "IL");
  assert.equal(expandFieldValue("address-level1", { province: "ON" }), "ON");
  assert.equal(expandFieldValue("address-level1", { region:   "Lazio" }), "Lazio");
});

test("expandFieldValue: postal-code resolves from `zip` / `zipcode` / `postcode`", () => {
  assert.equal(expandFieldValue("postal-code", { zip:       "62701" }), "62701");
  assert.equal(expandFieldValue("postal-code", { zipcode:   "62701" }), "62701");
  assert.equal(expandFieldValue("postal-code", { postcode:  "EC1A1BB" }), "EC1A1BB");
});

test("expandFieldValue: tel resolves from `phone` / `telephone` / `mobile`", () => {
  assert.equal(expandFieldValue("tel", { phone:     "+15551234" }), "+15551234");
  assert.equal(expandFieldValue("tel", { telephone: "+15551234" }), "+15551234");
  assert.equal(expandFieldValue("tel", { mobile:    "+15551234" }), "+15551234");
});

test("expandFieldValue: cc-csc resolves from `cvv` / `cvc` / `csc`", () => {
  assert.equal(expandFieldValue("cc-csc", { cvv: "123" }), "123");
  assert.equal(expandFieldValue("cc-csc", { cvc: "456" }), "456");
  assert.equal(expandFieldValue("cc-csc", { csc: "789" }), "789");
});

test("expandFieldValue: direct token wins over a present synonym", () => {
  // If both keys exist, the canonical token is authoritative — the
  // synonym is the fallback, not an override.
  assert.equal(expandFieldValue("address-level2", {
    "address-level2": "Springfield", city: "OTHER",
  }), "Springfield");
});

test("expandFieldValue: street-address resolves from `address`", () => {
  assert.equal(expandFieldValue("street-address", { address: "123 Main St" }), "123 Main St");
});

test("expandFieldValue: realistic profile entry with friendly names round-trips", () => {
  // This is the example in the README — every token the page form asks
  // for must resolve from the friendly-named entry.
  const friendly = {
    "given-name":  "Jane",
    "family-name": "Doe",
    email:         "jane.doe@example.com",
    phone:         "+15551234",
    address:       "123 Main St",
    city:          "Springfield",
    state:         "IL",
    zipcode:       "62701",
    country:       "US",
  };
  assert.equal(expandFieldValue("given-name",     friendly), "Jane");
  assert.equal(expandFieldValue("family-name",    friendly), "Doe");
  assert.equal(expandFieldValue("email",          friendly), "jane.doe@example.com");
  assert.equal(expandFieldValue("tel",            friendly), "+15551234");
  assert.equal(expandFieldValue("street-address", friendly), "123 Main St");
  assert.equal(expandFieldValue("address-level2", friendly), "Springfield");
  assert.equal(expandFieldValue("address-level1", friendly), "IL");
  assert.equal(expandFieldValue("postal-code",    friendly), "62701");
  assert.equal(expandFieldValue("country",        friendly), "US");
  assert.equal(expandFieldValue("country-name",   friendly), "US");
  // The recognizer's autocomplete=street-address tokens also resolve.
  assert.equal(expandFieldValue("street-address", friendly), "123 Main St");
  // Composite name still works via alias chain even with no explicit
  // `name` key in the entry.
  assert.equal(expandFieldValue("name", friendly), "Jane Doe");
});
