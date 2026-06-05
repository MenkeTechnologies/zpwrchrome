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
  }), "Jacob P Menke");
  assert.equal(expandFieldValue("name", { "given-name": "Jane", "family-name": "Doe" }),
                                          "Jane Doe");
});

test("expandFieldValue: given-name / family-name split out of a single name field", () => {
  assert.equal(expandFieldValue("given-name",  { name: "Jacob P Menke" }), "Jane");
  assert.equal(expandFieldValue("family-name", { name: "Jacob P Menke" }), "Doe");
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
