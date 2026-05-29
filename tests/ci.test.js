// CI workflow invariants. No YAML parser in stdlib, so we assert on string
// invariants the workflow must satisfy.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CI = join(ROOT, ".github/workflows/ci.yml");

test("CI workflow file exists at .github/workflows/ci.yml", () => {
  assert.ok(existsSync(CI), "missing .github/workflows/ci.yml (CI badge points here)");
});

const src = readFileSync(CI, "utf8");

test("CI runs on push and pull_request to main", () => {
  assert.match(src, /on:[\s\S]*?push:[\s\S]*?branches:\s*\[main\]/);
  assert.match(src, /on:[\s\S]*?pull_request:[\s\S]*?branches:\s*\[main\]/);
});

test("CI declares a test job and invokes `npm test`", () => {
  assert.match(src, /^\s+test:/m, "no `test:` job key");
  assert.match(src, /run:\s*npm test/, "no `npm test` step");
});

test("CI uses ubuntu-latest runner (cheap, fast, matches /Linux CI/ expectation)", () => {
  assert.match(src, /runs-on:\s*ubuntu-latest/);
});

test("CI tests on multiple Node versions (matrix)", () => {
  assert.match(src, /matrix:\s*\n\s+(?:.+\n\s+)*?node:\s*\[\s*\d+\s*(?:,\s*\d+\s*)+\]/,
    "matrix.node must be a list of ≥2 versions");
});

test("CI checks out the repo with actions/checkout", () => {
  // Allow v3..v6 — v3 = Node 16; v4 = Node 20 (deprecated June 2026);
  // v5 = Node 24; v6 = Node 24 + cred-persist fix. Pin the range to
  // prevent accidental downgrade to v1/v2 while allowing future-proof
  // bumps as Node runtime moves forward.
  assert.match(src, /uses:\s*actions\/checkout@v[3456]/);
});

test("CI sets up Node with actions/setup-node", () => {
  assert.match(src, /uses:\s*actions\/setup-node@v[34]/);
});

test("CI installs rsvg so theme image regeneration works in CI", () => {
  // Future-proofing: if we add a workflow step that re-rasterizes SVGs, the
  // tool must be present. This also signals intent to anyone editing CI.
  assert.match(src, /librsvg2-bin/);
});

test("CI enforces the doc-drift guard (gen.sh + git diff --exit-code)", () => {
  assert.match(src, /scripts\/gen\.sh/);
  assert.match(src, /git diff --exit-code/);
});

test("CI workflow does not skip git hooks or signing", () => {
  // Per CLAUDE.md: never skip hooks unless asked.
  assert.ok(!/--no-verify/.test(src), "CI uses --no-verify");
  assert.ok(!/--no-gpg-sign/.test(src), "CI uses --no-gpg-sign");
});

test("CI declares least-privilege permissions block", () => {
  // Defense-in-depth: read-only token unless we explicitly need more.
  assert.match(src, /permissions:\s*\n\s+contents:\s*read/);
});
