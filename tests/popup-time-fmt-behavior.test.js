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

const fmtMb = extractFn(popup, "fmtMb");
const timeAgo = extractFn(popup, "timeAgo");

test("fmtMb returns em-dash for NaN, Infinity, 0, and negative bytes", () => {
  assert.equal(fmtMb(NaN), "—");
  assert.equal(fmtMb(Infinity), "—");
  assert.equal(fmtMb(-1), "—");
  assert.equal(fmtMb(0), "—");
});

test("fmtMb formats sub-100MB values as integer megabytes with M suffix", () => {
  // 1 MB == 1024*1024 bytes => "1M"
  assert.equal(fmtMb(1 * 1024 * 1024), "1M");
  // 99 MB still uses M (boundary is mb < 100)
  assert.equal(fmtMb(99 * 1024 * 1024), "99M");
  // 50.4 MB rounds to 50M via toFixed(0)
  assert.equal(fmtMb(50.4 * 1024 * 1024), "50M");
});

test("fmtMb switches to GB at exactly 100MB and uses 2-decimal format", () => {
  // 100 MB is NOT < 100 => uses G branch: (100/1024).toFixed(2) = "0.10G"
  assert.equal(fmtMb(100 * 1024 * 1024), "0.10G");
  // 1 GB exactly == 1024 MB / 1024 = 1.00G
  assert.equal(fmtMb(1024 * 1024 * 1024), "1.00G");
  // 1.5 GB
  assert.equal(fmtMb(1.5 * 1024 * 1024 * 1024), "1.50G");
});

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
