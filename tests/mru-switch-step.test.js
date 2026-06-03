// switchPreviousTab and mruStep tab activation paths in background.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

function fnBody(name) {
  const m = bg.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} not found`);
  return m[0];
}

test("switchPreviousTab self-heals MRU head with the real active tab before reading", () => {
  const fn = fnBody("switchPreviousTab");
  assert.match(fn, /if \(active\?\.id != null\) await pushMru\(active\.id\)/);
});

test("switchPreviousTab iterates the MRU instead of bailing on the first stale entry", () => {
  // Old behavior was: read one candidate via mruPrevious; if chrome.tabs.get
  // threw, drop it and STOP. New behavior: keep walking the MRU so a single
  // closed-tab id at the head never blocks the Cmd+E shortcut.
  const fn = fnBody("switchPreviousTab");
  assert.match(fn, /for \(const id of mru\)/);
  assert.match(fn, /if \(id === active\?\.id\) continue/);
});

test("switchPreviousTab activates previous tab then focuses its window when cross-window", () => {
  const fn = fnBody("switchPreviousTab");
  assert.match(fn, /await chrome\.tabs\.update\(id, \{ active: true \}\)/);
  assert.match(fn, /if \(tab\.windowId !== active\?\.windowId\)/);
  assert.match(fn, /chrome\.windows\.update\(tab\.windowId, \{ focused: true \}\)/);
});

test("switchPreviousTab drops stale MRU entries inside the iteration loop", () => {
  const fn = fnBody("switchPreviousTab");
  assert.match(fn, /catch \{\s*await dropFromMru\(id\);/);
});

test("mruStep delegates stepping to mruStepPure alias from lib/util.js", () => {
  const fn = fnBody("mruStep");
  assert.match(fn, /mruStepPure\(mru, active\?\.id, delta\)/);
  assert.match(bg, /mruStep as mruStepPure/);
});

test("mruStep returns when next id equals current active tab", () => {
  const fn = fnBody("mruStep");
  assert.match(fn, /if \(typeof next !== "number" \|\| next === active\?\.id\) return/);
});

test("mruStep focuses destination window when MRU tab is in another window", () => {
  const fn = fnBody("mruStep");
  assert.match(fn, /await chrome\.tabs\.get\(next\)/);
  assert.match(fn, /chrome\.windows\.update\(tab\.windowId, \{ focused: true \}\)/);
});

test("mruStep retries on stale tab id instead of bailing — drops + refreshes MRU + continues", () => {
  const fn = fnBody("mruStep");
  assert.match(fn, /catch \{\s*await dropFromMru\(next\)/);
  assert.match(fn, /mru = await readMru\(\)/);
});

test("dispatch mru-next routes to mruStep with positive delta", () => {
  assert.match(bg, /command === "mru-next"\)[\s\S]*?mruStep\(\+1\)/);
});

test("dispatch mru-prev routes to mruStep with negative delta", () => {
  assert.match(bg, /command === "mru-prev"\)[\s\S]*?mruStep\(-1\)/);
});

test("dispatch switch-previous-tab routes to switchPreviousTab not mruStep", () => {
  assert.match(bg, /command === "switch-previous-tab"\)[\s\S]*?switchPreviousTab\(\)/);
});

test("withActive returns undefined when no active tab exists", () => {
  const fn = fnBody("withActive");
  assert.match(fn, /const t = await getActive\(\)/);
  assert.match(fn, /if \(t\) return fn\(t\)/);
});

test("getActive queries active tab in last focused window only", () => {
  const fn = fnBody("getActive");
  assert.match(fn, /chrome\.tabs\.query\(\{ active: true, lastFocusedWindow: true \}\)/);
});

test("jumpTo activates tab at resolveJumpIndex without focusing other windows", () => {
  const fn = fnBody("jumpTo");
  assert.match(fn, /chrome\.tabs\.query\(\{ currentWindow: true \}\)/);
  assert.match(fn, /await chrome\.tabs\.update\(tabs\[idx\]\.id, \{ active: true \}\)/);
});
