// frecencyScore and hostnameOf edge cases beyond logic.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { frecencyScore, hostnameOf, MRU_CAP_DEFAULT } from "../lib/util.js";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

test("MRU_CAP_DEFAULT export is 200", () => {
  assert.equal(MRU_CAP_DEFAULT, 200);
});

test("frecencyScore typed-only visits use 2x weight without visitCount", () => {
  const score = frecencyScore({ visitCount: 0, typedCount: 3, lastVisitTime: NOW - HOUR }, NOW);
  assert.ok(score > 0);
  assert.equal(score, 6 / (1 + 2));
});

test("frecencyScore combined visitCount and typedCount sum in numerator", () => {
  const score = frecencyScore({ visitCount: 2, typedCount: 1, lastVisitTime: NOW - HOUR }, NOW);
  assert.equal(score, (2 + 2) / (1 + 2));
});

test("frecencyScore brand-new visit at now uses hoursAgo clamped to 0", () => {
  const score = frecencyScore({ visitCount: 1, lastVisitTime: NOW + 60_000 }, NOW);
  const atNow = frecencyScore({ visitCount: 1, lastVisitTime: NOW }, NOW);
  assert.equal(score, atNow);
});

test("frecencyScore higher visit count beats lower at same recency", () => {
  const many = frecencyScore({ visitCount: 50, lastVisitTime: NOW - 2 * HOUR }, NOW);
  const few  = frecencyScore({ visitCount: 2,  lastVisitTime: NOW - 2 * HOUR }, NOW);
  assert.ok(many > few);
});

test("frecencyScore decays as lastVisitTime ages", () => {
  const recent = frecencyScore({ visitCount: 10, lastVisitTime: NOW - HOUR }, NOW);
  const old    = frecencyScore({ visitCount: 10, lastVisitTime: NOW - 48 * HOUR }, NOW);
  assert.ok(recent > old);
});

test("hostnameOf returns hostname for wss is not applicable — uses http URL", () => {
  assert.equal(hostnameOf("https://api.example.com/v1"), "api.example.com");
});

test("hostnameOf returns (local) for file URLs", () => {
  assert.equal(hostnameOf("file:///tmp/x"), "(local)");
});

test("hostnameOf returns (other) for empty string", () => {
  assert.equal(hostnameOf(""), "(other)");
});

test("hostnameOf strips userinfo is not in URL — standard host parsing", () => {
  assert.equal(hostnameOf("https://user:pass@host.example/path"), "host.example");
});

test("frecencyScore zero when both visit and typed counts are zero", () => {
  assert.equal(frecencyScore({ visitCount: 0, typedCount: 0, lastVisitTime: NOW }, NOW), 0);
});

test("frecencyScore with lastVisitTime 0 uses visits-only numerator", () => {
  assert.equal(frecencyScore({ visitCount: 4, typedCount: 0, lastVisitTime: 0 }, NOW), 4);
});

test("frecencyScore negative lastVisitTime treated like zero hoursAgo clamp", () => {
  const neg = frecencyScore({ visitCount: 3, lastVisitTime: -1000 }, NOW);
  const zero = frecencyScore({ visitCount: 3, lastVisitTime: 0 }, NOW);
  assert.equal(neg, zero);
});

test("hostnameOf is stable for repeated calls on same URL", () => {
  const url = "https://news.ycombinator.com/item?id=1";
  assert.equal(hostnameOf(url), hostnameOf(url));
});
