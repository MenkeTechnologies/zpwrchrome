// timeAgo and fmtMb tier breakpoints in popup.js and modal template.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");
const modal = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");

function extractFn(src, name) {
  const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} missing`);
  return m[0];
}

const popupTime = extractFn(popup, "timeAgo");
const modalTime = extractFn(modal, "timeAgo");
// fmtMb removed alongside chrome.processes integration — was only used to
// render the proc-col memory cell. See tests/processes-handlers.test.js.

test("popup timeAgo returns empty string for invalid timestamps", () => {
  assert.match(popupTime, /if \(!Number\.isFinite\(ms\) \|\| ms <= 0\) return ""/);
});

test("popup timeAgo uses seconds tier below 60 seconds", () => {
  assert.match(popupTime, /if \(sec < 60\)[\s\S]*?"s ago"/);
});

test("popup timeAgo uses minutes tier below 3600 seconds", () => {
  assert.match(popupTime, /if \(sec < 3600\)[\s\S]*?"m ago"/);
});

test("popup timeAgo uses hours tier below 86400 seconds", () => {
  assert.match(popupTime, /if \(sec < 86400\)[\s\S]*?"h ago"/);
});

test("popup timeAgo uses days tier below 604800 seconds", () => {
  assert.match(popupTime, /if \(sec < 604800\)[\s\S]*?"d ago"/);
});

test("popup timeAgo falls back to weeks for older visits", () => {
  assert.match(popupTime, /"w ago"/);
});

test("modal timeAgo matches popup tier structure", () => {
  for (const tier of ["sec < 60", "sec < 3600", "sec < 86400", "sec < 604800", "w ago"]) {
    assert.ok(modalTime.includes(tier), `modal timeAgo missing ${tier}`);
  }
});

test("popup fmtMb removed (chrome.processes integration gone)", () => {
  assert.doesNotMatch(popup, /\bfunction fmtMb\(/);
  assert.doesNotMatch(popup, /\bfmtMb\(/);
});

test("popup history badge calls timeAgo on lastVisitTime", () => {
  assert.match(popup, /timeAgo\(t\.lastVisitTime\)/);
});

test("popup no longer renders the proc column (chrome.processes removed)", () => {
  assert.doesNotMatch(popup, /class="proc-col"/);
});

test("popup renderList history badge includes full locale title on lastVisitTime", () => {
  assert.match(popup, /new Date\(t\.lastVisitTime\)\.toLocaleString\(\)/);
});

test("modal template history rows also use timeAgo badge", () => {
  assert.match(modal, /timeAgo\(t\.lastVisitTime\)/);
});
