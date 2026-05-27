// lib/*.js exports are imported by production code (no orphan helpers).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const utilExports = [...read("lib/util.js").matchAll(/^export (?:const|function)\s+([A-Za-z_$][\w$]*)/gm)]
  .map((m) => m[1]);
const fzfExports = [...read("lib/fzf.js").matchAll(/^export (?:const|function)\s+([A-Za-z_$][\w$]*)/gm)]
  .map((m) => m[1]);
const userscriptExports = [...read("lib/userscript.js").matchAll(/^export (?:const|function)\s+([A-Za-z_$][\w$]*)/gm)]
  .map((m) => m[1]);

const consumers = [
  read("background.js"),
  read("popup.js"),
  read("scripts-manager/manager.js"),
  read("modal/content.js"),
].join("\n");

for (const name of utilExports) {
  test(`lib/util.js export ${name} is referenced by production code`, () => {
    assert.ok(consumers.includes(name), `orphan util export: ${name}`);
  });
}

for (const name of fzfExports) {
  test(`lib/fzf.js export ${name} is referenced by production or built modal`, () => {
    assert.ok(consumers.includes(name), `orphan fzf export: ${name}`);
  });
}

const userscriptConsumers = consumers + "\n" + read("lib/userscript.js");

for (const name of userscriptExports) {
  test(`lib/userscript.js export ${name} is referenced by production code`, () => {
    assert.ok(userscriptConsumers.includes(name), `orphan userscript export: ${name}`);
  });
}

test("background.js imports mruStep as mruStepPure alias", () => {
  assert.match(read("background.js"), /mruStep as mruStepPure/);
});

test("GM_SHIM_SOURCE is referenced in background.js for registration", () => {
  assert.match(read("background.js"), /GM_SHIM_SOURCE/);
});

test("lib/util.js MRU_CAP_DEFAULT matches background writeMru cap", () => {
  assert.match(read("background.js"), /MRU_CAP_DEFAULT/);
  assert.match(read("lib/util.js"), /export const MRU_CAP_DEFAULT = 200/);
});
