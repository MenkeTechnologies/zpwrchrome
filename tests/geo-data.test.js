// Unit tests for lib/geo-data.js — the ISO-code → display-name tables the
// combobox driver uses to turn a stored `country: US` into the "United
// States" text a react-select / MUI dropdown actually lists.

import { test } from "node:test";
import assert from "node:assert/strict";

import { COUNTRIES, US_STATES, CA_PROVINCES } from "../lib/geo-data.js";

test("tables are frozen", () => {
  assert.ok(Object.isFrozen(COUNTRIES));
  assert.ok(Object.isFrozen(US_STATES));
  assert.ok(Object.isFrozen(CA_PROVINCES));
});

test("countries: keys are alpha-2 uppercase, values non-empty", () => {
  const entries = Object.entries(COUNTRIES);
  assert.ok(entries.length >= 200, `expected a broad country list, got ${entries.length}`);
  for (const [code, name] of entries) {
    assert.match(code, /^[A-Z]{2}$/, `bad country code "${code}"`);
    assert.ok(typeof name === "string" && name.length > 0, `empty name for ${code}`);
  }
});

test("countries: common web-form display names (not verbose ISO forms)", () => {
  assert.equal(COUNTRIES.US, "United States");
  assert.equal(COUNTRIES.GB, "United Kingdom");
  assert.equal(COUNTRIES.KR, "South Korea");
  assert.equal(COUNTRIES.VN, "Vietnam");
  assert.equal(COUNTRIES.RU, "Russia");
  assert.equal(COUNTRIES.CA, "Canada");
  assert.equal(COUNTRIES.DE, "Germany");
});

test("countries: display names are unique (no accidental dup mapping)", () => {
  const names = Object.values(COUNTRIES).map((n) => n.toLowerCase());
  assert.equal(new Set(names).size, names.length, "duplicate country display name");
});

test("us states: 50 states + DC + common territories, USPS codes", () => {
  assert.ok("DC" in US_STATES, "DC present");
  // 50 states + DC at minimum.
  assert.ok(Object.keys(US_STATES).length >= 51);
  assert.equal(US_STATES.CA, "California");
  assert.equal(US_STATES.NY, "New York");
  assert.equal(US_STATES.TX, "Texas");
  for (const code of Object.keys(US_STATES)) {
    assert.match(code, /^[A-Z]{2}$/, `bad state code "${code}"`);
  }
});

test("ca provinces: 13 provinces/territories with correct codes", () => {
  assert.equal(Object.keys(CA_PROVINCES).length, 13);
  assert.equal(CA_PROVINCES.ON, "Ontario");
  assert.equal(CA_PROVINCES.QC, "Quebec");
  assert.equal(CA_PROVINCES.BC, "British Columbia");
});
