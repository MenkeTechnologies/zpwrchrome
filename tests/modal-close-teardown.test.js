// closeModal teardown and openModal install path in modal template.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const tmpl = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");

const closeStart = tmpl.indexOf("function closeModal()");
const closeEnd = tmpl.indexOf("function html()");
assert.ok(closeStart >= 0 && closeEnd > closeStart, "closeModal missing");
const close = tmpl.slice(closeStart, closeEnd);

const openStart = tmpl.indexOf("function openModal()");
const openEnd = tmpl.indexOf("function closeModal()");
assert.ok(openStart >= 0 && openEnd > openStart, "openModal missing");
const open = tmpl.slice(openStart, openEnd);

test("closeModal returns immediately when state is null", () => {
  assert.match(close, /if \(!state\) return/);
});

test("closeModal removes keydown listener registered in capture phase", () => {
  assert.match(close, /removeEventListener\("keydown", state\.kd, true\)/);
});

test("closeModal removes keyup listener registered in capture phase", () => {
  assert.match(close, /removeEventListener\("keyup",\s*state\.ku, true\)/);
});

test("closeModal removes focusin listener", () => {
  assert.match(close, /removeEventListener\("focusin",\s*state\.fi, true\)/);
});

test("closeModal removes host element from document", () => {
  assert.match(close, /state\.host\.remove\(\)/);
});

test("closeModal removes focus sink input from document", () => {
  assert.match(close, /state\.sink\.remove\(\)/);
});

test("closeModal nulls state after teardown", () => {
  assert.match(close, /state = null/);
});

test("closeModal wraps each remove in try catch for idempotency", () => {
  assert.ok((close.match(/try \{/g) || []).length >= 4);
});

test("openModal creates host div with MODAL_ID and appends to documentElement", () => {
  assert.match(open, /host\.id = MODAL_ID/);
  assert.match(open, /document\.documentElement\.appendChild\(host\)/);
});

test("openModal injects CSS and html into shadow root innerHTML", () => {
  assert.match(open, /shadow\.innerHTML = `<style>\$\{CSS\}<\/style>` \+ html\(\)/);
});

test("openModal initializes collapsedTreeIds as empty Set", () => {
  assert.match(open, /collapsedTreeIds: new Set\(\)/);
});

test("openModal sets firstRender true for initial row selection", () => {
  assert.match(open, /firstRender: true/);
});

test("openModal calls wire then refresh after state init", () => {
  assert.match(open, /wire\(\)/);
  assert.match(open, /refresh\(\)/);
});

test("runtime message listener routes open-modal and close-modal kinds", () => {
  assert.match(tmpl, /msg\?\.kind === "open-modal"\)[\s\S]*?openModal\(\)/);
  assert.match(tmpl, /msg\?\.kind === "close-modal"\)[\s\S]*?closeModal\(\)/);
});
