// Documentation generation pipeline invariants (gen.sh / gen.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const genSh = read("scripts/gen.sh");
const genMjs = read("scripts/gen.mjs");

test("gen.sh invokes gen.mjs with ZPWR_ROOT set", () => {
  assert.match(genSh, /ZPWR_ROOT="\$ROOT" node "\$ROOT\/scripts\/gen\.mjs"/);
});

test("gen.sh chains build-modal.sh after doc generation", () => {
  assert.match(genSh, /bash "\$ROOT\/scripts\/build-modal\.sh"/);
});

test("gen.sh uses set -euo pipefail", () => {
  assert.match(genSh, /set -euo pipefail/);
});

test("gen.mjs requires ZPWR_ROOT environment variable", () => {
  assert.match(genMjs, /if \(!ROOT\)/);
  assert.match(genMjs, /process\.exit\(1\)/);
});

test("gen.mjs reads manifest.json as command source of truth", () => {
  assert.match(genMjs, /readFileSync\(join\(ROOT, "manifest\.json"\)/);
});

test("gen.mjs counts tests dynamically from tests/*.test.js", () => {
  assert.match(genMjs, /testFiles\.reduce/);
  assert.ok(genMjs.includes("src.match(/^test\\(/gm)"), "must count test() calls per file");
});

test("gen.mjs writes README.md and docs/index.html", () => {
  assert.match(genMjs, /writeFileSync\(join\(ROOT, "README\.md"\)/);
  assert.match(genMjs, /writeFileSync\(join\(ROOT, "docs\/index\.html"\)/);
});

test("gen.mjs writes docs/report.html engineering report", () => {
  assert.match(genMjs, /writeFileSync\(join\(ROOT, "docs\/report\.html"\)/);
});

test("gen.mjs derives popup categories from popup.js regex", () => {
  assert.match(genMjs, /popupCategories = \[\.\.\.popupJs\.matchAll/);
});

test("gen.mjs extracts background message kinds from msg?.kind checks", () => {
  assert.match(genMjs, /bgKinds = \[\.\.\.new Set/);
  assert.ok(genMjs.includes('msg?.kind === "'), "must parse background handler kinds");
});

test("gen.mjs computes total JS line count from known source files", () => {
  assert.match(genMjs, /totalJsLines/);
  assert.match(genMjs, /"background\.js"/);
});

test("docs/report.html exists and references dynamic test count", () => {
  const report = read("docs/report.html");
  const testFiles = readdirSync(join(ROOT, "tests")).filter((f) => f.endsWith(".test.js"));
  const count = testFiles.reduce((sum, f) => {
    return sum + (read("tests/" + f).match(/^test\(/gm) || []).length;
  }, 0);
  assert.match(report, new RegExp(`${count} tests`));
});

test("docs/index.html exists and links to GitHub source repo", () => {
  assert.ok(existsSync(join(ROOT, "docs/index.html")));
  const docs = read("docs/index.html");
  assert.match(docs, /github\.com\/MenkeTechnologies\/zpwrchrome/);
});

test("package.json test script runs node:test on tests/*.test.js", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.scripts.test, /node --test/);
  assert.match(pkg.scripts.test, /tests\/\*\.test\.js/);
});

test("package.json requires Node 20+", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.engines.node, />=20/);
});
