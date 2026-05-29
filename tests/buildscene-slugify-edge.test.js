// Slugify behavior via buildScene — extends build-scene-restorable.test.js
// with the harder name cases: unicode collapsed to ASCII boundaries, emoji
// stripped entirely, all-digit names, mixed separators collapsed, exactly-
// 48-char names, and runs of internal non-alphanumerics.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScene } from "../lib/util.js";

const TAB = [{ url: "https://x.test/", title: "x" }];
const T0 = 1_700_000_000_000;

test("buildScene strips diacritics from unicode name and keeps ASCII fragments", () => {
  // The slug regex is [a-z0-9]+, so "café résumé" → "caf-r-sum" (each
  // accented char becomes the boundary that splits ASCII clusters).
  assert.equal(buildScene("café résumé", TAB, T0).slug, "caf-r-sum");
});

test("buildScene strips emoji from name (no surrogate pair retention)", () => {
  // Non-alphanumeric Unicode (including astral plane) collapses to dashes,
  // then the leading/trailing trim leaves the ASCII portion.
  assert.equal(buildScene("plan 📋", TAB, T0).slug, "plan");
});

test("buildScene accepts an all-digits name as a valid slug", () => {
  // 0-9 is in [a-z0-9], so "1234" stays intact.
  assert.equal(buildScene("1234", TAB, T0).slug, "1234");
});

test("buildScene collapses runs of mixed separators into single dashes", () => {
  assert.equal(buildScene("hello/world+stuff", TAB, T0).slug, "hello-world-stuff");
});

test("buildScene trims leading and trailing dashes after slugify", () => {
  assert.equal(buildScene("---abc---", TAB, T0).slug, "abc");
});

test("buildScene collapses interior whitespace and punctuation runs to one dash", () => {
  // Multiple spaces + dots between letters → a single dash, not stacked.
  assert.equal(buildScene("a    b....c", TAB, T0).slug, "a-b-c");
});

test("buildScene truncates slug at exactly 48 chars on overlong name", () => {
  const scene = buildScene("a".repeat(60), TAB, T0);
  assert.equal(scene.slug.length, 48);
  assert.equal(scene.slug, "a".repeat(48));
});

test("buildScene truncates display name at 48 chars (matches slug cap)", () => {
  const scene = buildScene("a".repeat(60), TAB, T0);
  assert.equal(scene.name.length, 48);
});

test("buildScene returns null when name contains only special characters", () => {
  assert.equal(buildScene("...!!!", TAB, T0), null);
  assert.equal(buildScene("///   +++", TAB, T0), null);
});

test("buildScene converts tab character in name to single dash separator", () => {
  assert.equal(buildScene("a\tbc", TAB, T0).slug, "a-bc");
});

test("buildScene lowercases mixed-case ASCII name", () => {
  assert.equal(buildScene("HelloWORLD", TAB, T0).slug, "helloworld");
});

test("buildScene returns null when name is undefined or null", () => {
  assert.equal(buildScene(undefined, TAB, T0), null);
  assert.equal(buildScene(null, TAB, T0), null);
});

test("buildScene number-typed name coerces to digits-only slug", () => {
  // String(42) === "42" — pin that the helper tolerates non-string input
  // rather than throwing.
  assert.equal(buildScene(42, TAB, T0).slug, "42");
});

test("buildScene at exact 48-char ASCII name keeps the name as-is", () => {
  const name = "a".repeat(48);
  const scene = buildScene(name, TAB, T0);
  assert.equal(scene.slug, name);
  assert.equal(scene.name, name);
});

test("buildScene preserves the kebab-cased version when input is already kebab", () => {
  assert.equal(buildScene("my-saved-tabs", TAB, T0).slug, "my-saved-tabs");
});
