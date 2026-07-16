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
  FIELD_RULE_SOURCES,
  compileFieldRules,
  matchFieldRules,
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

test("current-password / new-password short-circuit to null (opt-out)", () => {
  assert.equal(recognizeField({ autocomplete: "current-password", id: "cc-number"     }), null);
  assert.equal(recognizeField({ autocomplete: "new-password",     name: "cardholder"  }), null);
});

test("autocomplete=off falls through to name/label/type recognition", () => {
  // Custom widgets (react-select, intl-tel-input, MUI) and many plain
  // sites set autocomplete=off; it must NOT veto an explicit hotkey fill.
  assert.equal(recognizeField({ autocomplete: "off", name: "card-number" }), "cc-number");
  assert.equal(recognizeField({ autocomplete: "off", id:   "country"      }), "country");
  assert.equal(recognizeField({ autocomplete: "off", type: "tel"          }), "tel");
  // …but off with no other signal still yields null (nothing to match).
  assert.equal(recognizeField({ autocomplete: "off", name: "unrelated"    }), null);
});

test("country is recognized from a bare `country` name/id/label", () => {
  assert.equal(recognizeField({ id:    "country"  }), "country");
  assert.equal(recognizeField({ label: "Country"  }), "country");
  // country-name still wins its longer, more specific match.
  assert.equal(recognizeField({ name:  "country-name" }), "country-name");
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

// ─── Real-world field-name variations (regression corpus) ──────────
// These are the shapes that broke recognition before the FIELD_RULES
// engine: nested framework names, camelCase, billing/shipping prefixes,
// and separator-split digits. Sources: Firefox HeuristicsRegExp,
// Chromium autofill regexes, WooCommerce/Magento/Shopify/Spree/Workday/
// Amazon/Salesforce field conventions.

test("camelCase field names are split and recognized", () => {
  assert.equal(recognizeField({ name: "addressLine1" }), "address-line1");
  assert.equal(recognizeField({ name: "addressLine2" }), "address-line2");
  assert.equal(recognizeField({ name: "postalCode"   }), "postal-code");
  assert.equal(recognizeField({ name: "firstName"    }), "given-name");
  assert.equal(recognizeField({ name: "lastName"     }), "family-name");
  assert.equal(recognizeField({ name: "phoneNumber"  }), "tel");
});

test("dotted nested names (Stripe / react-hook-form / Formik) recognize", () => {
  assert.equal(recognizeField({ name: "address.line1" }),     "address-line1");
  assert.equal(recognizeField({ name: "address.line2" }),     "address-line2");
  assert.equal(recognizeField({ name: "user.address.city" }), "address-level2");
  assert.equal(recognizeField({ name: "address.postal_code" }), "postal-code");
  assert.equal(recognizeField({ name: "addresses.0.street" }), "street-address");
});

test("bracketed nested names (Magento / Shopify / Spree) recognize the leaf, not the parent", () => {
  assert.equal(recognizeField({ name: "billing[postcode]" }),  "postal-code");
  assert.equal(recognizeField({ name: "billing[city]" }),      "address-level2");
  assert.equal(recognizeField({ name: "billing[region_id]" }), "address-level1");
  assert.equal(recognizeField({ name: "order[bill_address_attributes][address1]" }), "address-line1");
  // The pollution case: a ZIP field whose PARENT segment says "address"
  // must NOT be swallowed by street-address (leaf tokens win by ordering).
  assert.equal(recognizeField({ name: "checkout[shipping_address][zip]" }), "postal-code");
});

test("billing_/shipping_ prefixed WooCommerce names recognize", () => {
  assert.equal(recognizeField({ name: "billing_address_1" }),  "address-line1");
  assert.equal(recognizeField({ name: "shipping_address_2" }), "address-line2");
  assert.equal(recognizeField({ name: "billing_city" }),       "address-level2");
  assert.equal(recognizeField({ name: "billing_state" }),      "address-level1");
  assert.equal(recognizeField({ name: "billing_postcode" }),   "postal-code");
  assert.equal(recognizeField({ name: "billing_country" }),    "country");
  assert.equal(recognizeField({ name: "billing_first_name" }), "given-name");
  assert.equal(recognizeField({ name: "billing_company" }),    "organization");
});

test("separator-split digits recognize (address-line-1, address_line_2)", () => {
  assert.equal(recognizeField({ name: "address-line-1" }), "address-line1");
  assert.equal(recognizeField({ name: "address_line_2" }), "address-line2");
  assert.equal(recognizeField({ id:   "street_1" }),       "address-line1");
});

test("Amazon / Workday / Salesforce / Magento vendor names recognize", () => {
  assert.equal(recognizeField({ id: "enterAddressLine1" }),          "address-line1");
  assert.equal(recognizeField({ id: "enterAddressStateOrRegion" }),  "address-level1");
  assert.equal(recognizeField({ id: "enterAddressPostalCode" }),     "postal-code");
  assert.equal(recognizeField({ id: "enterAddressCity" }),           "address-level2");
  assert.equal(recognizeField({ name: "addressSection_addressLine1" }), "address-line1");
  assert.equal(recognizeField({ name: "legalNameSection_firstName" }),  "given-name");
  assert.equal(recognizeField({ name: "MailingPostalCode" }),        "postal-code");
  assert.equal(recognizeField({ name: "region_id" }),                "address-level1");
  assert.equal(recognizeField({ name: "administrative_area_level_1" }), "address-level1");
});

test("collision guards: email/word-suffix/country-county do not misfire", () => {
  // email-address must not be swallowed by street-address's \\baddress\\b
  assert.equal(recognizeField({ name: "email-address" }), "email");
  // English words ending in -city are excluded by \\bcity\\b
  assert.equal(recognizeField({ name: "capacity" }),    null);
  assert.equal(recognizeField({ name: "electricity" }), null);
  // county routes to state (not country); country stays country
  assert.equal(recognizeField({ name: "county" }),  "address-level1");
  assert.equal(recognizeField({ name: "country" }), "country");
  assert.equal(recognizeField({ name: "country_id" }), "country");
  // "United States" (option text leaking into a label) is NOT a state field
  assert.notEqual(recognizeField({ label: "United States" }), "address-level1");
});

test("newly-covered tokens (full name, cc-name, cc-type, cc-exp) recognize", () => {
  assert.equal(recognizeField({ name: "name" }),        "name");        // bare full name
  assert.equal(recognizeField({ name: "fullName" }),    "name");
  assert.equal(recognizeField({ name: "cardholder" }),  "cc-name");
  assert.equal(recognizeField({ name: "card-brand" }),  "cc-type");
  assert.equal(recognizeField({ name: "expiration" }),  "cc-exp");
  assert.equal(recognizeField({ label: "MM / YY" }),    "cc-exp");
  assert.equal(recognizeField({ name: "suite" }),       "address-line2");
});

test("normalizeForMatch flattens camelCase / dotted / bracketed names", () => {
  assert.equal(normalizeForMatch("addressLine1"),        "address-line1");
  assert.equal(normalizeForMatch("address.line1"),       "address-line1");
  assert.equal(normalizeForMatch("billing[postcode]"),   "billing-postcode");
  assert.equal(normalizeForMatch("checkout[shipping_address][zip]"), "checkout-shipping-address-zip");
});

test("FIELD_RULE_SOURCES is serializable (structured-clone safe for injection)", () => {
  // background.js ships these into the page via executeScript args — RegExp
  // objects don't survive structured clone, so every source must be a
  // [token, string] pair that recompiles cleanly.
  assert.ok(Array.isArray(FIELD_RULE_SOURCES) && FIELD_RULE_SOURCES.length > 20);
  const known = new Set([...PROFILE_TOKENS, ...CC_TOKENS]);
  for (const [token, src] of FIELD_RULE_SOURCES) {
    assert.ok(known.has(token), `rule token "${token}" is not a known token`);
    assert.equal(typeof src, "string");
    assert.doesNotThrow(() => new RegExp(src, "u"), `rule "${token}" has an invalid regex`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(FIELD_RULE_SOURCES)), FIELD_RULE_SOURCES.map(([t, s]) => [t, s]));
});

test("compileFieldRules + matchFieldRules reproduce recognizeField (injected-path parity)", () => {
  // The injected fillIdentityForm / scanIdentityCategories rebuild the rules
  // from the serialized sources and call the same match loop. This asserts
  // that path yields the SAME token as the module recognizeField, so the
  // page-side copies can't silently diverge.
  const compiled = compileFieldRules(FIELD_RULE_SOURCES);
  const cases = [
    "address.line1", "billing[postcode]", "checkout[shipping_address][zip]",
    "billing_address_1", "shipping_city", "billing_state", "enterAddressPostalCode",
    "addressLine2", "region_id", "cardholder", "expiration", "email-address",
    "phoneNumber", "county", "country", "capacity",
  ];
  for (const raw of cases) {
    const viaModule   = recognizeField({ name: raw });
    const viaInjected = matchFieldRules([normalizeForMatch(raw), "", "", ""], compiled);
    assert.equal(viaInjected, viaModule, `parity mismatch for "${raw}"`);
  }
});
