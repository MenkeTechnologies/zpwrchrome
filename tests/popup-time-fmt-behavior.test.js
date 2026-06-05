// Behavior pins for popup.js timeAgo() and fmtMb() — actually executes the
// extracted source, not just regex-matches it. Catches regressions where
// the structure stays the same but the math/breakpoints drift.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");

function extractFn(src, name) {
  const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} missing`);
  // Wrap as expression so eval-via-Function returns the function value.
  return new Function(`${m[0]}; return ${name};`)();
}

// fmtMb was the byte→"M"/"G" formatter for the per-row proc column. It
// got deleted alongside the chrome.processes integration — there's no
// other code path that needs MB formatting in the popup. Pinned here so
// a re-introduction is caught loudly.
test("fmtMb is removed from popup.js (chrome.processes integration gone)", () => {
  assert.doesNotMatch(popup, /\bfunction fmtMb\(/);
  assert.doesNotMatch(popup, /\bfmtMb\(/);
});

const timeAgo = extractFn(popup, "timeAgo");

test("timeAgo returns empty string for non-finite or non-positive timestamps", () => {
  assert.equal(timeAgo(NaN), "");
  assert.equal(timeAgo(-1), "");
  assert.equal(timeAgo(0), "");
});

test("timeAgo picks the correct tier suffix for each magnitude", () => {
  const NOW = Date.now();
  // 30 seconds ago -> "Xs ago" (sec < 60)
  assert.match(timeAgo(NOW - 30_000), /^\d+s ago$/);
  // 30 minutes ago -> "Xm ago"
  assert.match(timeAgo(NOW - 30 * 60_000), /^\d+m ago$/);
  // 5 hours ago -> "Xh ago"
  assert.match(timeAgo(NOW - 5 * 3_600_000), /^\d+h ago$/);
  // 3 days ago -> "Xd ago"
  assert.match(timeAgo(NOW - 3 * 86_400_000), /^\d+d ago$/);
  // 2 weeks ago -> "Xw ago"
  assert.match(timeAgo(NOW - 14 * 86_400_000), /^\d+w ago$/);
});
