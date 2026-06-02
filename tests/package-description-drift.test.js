// Doc-drift: package.json description references the keyboard-command count.
// If you add a new command to manifest.json, this test fails until you
// update the description (and the README + docs which are auto-regen'd by
// scripts/gen.sh).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

test("package.json description keyboard-command count matches manifest.json commands", () => {
  const pkg = JSON.parse(read("package.json"));
  const manifest = JSON.parse(read("manifest.json"));
  const cmdCount = Object.keys(manifest.commands || {}).length;
  const m = pkg.description.match(/(\d+)\s+keyboard commands?/);
  assert.ok(m, `package.json description must mention "<N> keyboard commands", got: ${pkg.description}`);
  assert.equal(
    parseInt(m[1], 10),
    cmdCount,
    `package.json says ${m[1]} keyboard commands but manifest.json has ${cmdCount}`,
  );
});

test("package.json description covers Chrome ext + pass + downloads + tabs + history", () => {
  // After the rebrand, the description names each load-bearing capability
  // rather than calling the extension a "recent-tabs switcher".
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.description, /Chrome extension/i);
  assert.match(pkg.description, /pass/i,             "should mention UNIX pass integration");
  assert.match(pkg.description, /download/i,         "should mention the download manager");
  assert.match(pkg.description, /tab switcher/i,     "should mention the tab switcher");
  assert.match(pkg.description, /history/i,          "should mention fzf history search");
});
