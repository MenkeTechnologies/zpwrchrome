// modal wireSceneForm and wire() scene-name input behavior.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const tmpl = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");

const wfStart = tmpl.indexOf("function wireSceneForm()");
const wfEnd = tmpl.indexOf("function escapeHtml(");
assert.ok(wfStart >= 0 && wfEnd > wfStart, "wireSceneForm missing");
const wf = tmpl.slice(wfStart, wfEnd);

test("modal wireSceneForm stops keydown propagation on scene name input", () => {
  assert.match(wf, /nameInput\.addEventListener\("keydown", \(e\) => e\.stopPropagation\(\)\)/);
});

test("modal wireSceneForm uses keypress Enter not keydown for submit", () => {
  assert.match(wf, /nameInput\.addEventListener\("keypress"/);
  assert.match(wf, /e\.key === "Enter"\)[\s\S]*?submit\(\)/);
});

test("modal wireSceneForm queries elements from shadow list container", () => {
  assert.match(wf, /state\.shadow\.querySelector\("\.list"\)/);
  assert.match(wf, /list\.querySelector\("\.scene-name"\)/);
});

test("modal wireSceneForm rejects empty name with status message", () => {
  assert.match(wf, /status\.textContent = "name required"/);
});

test("modal wireSceneForm calls refresh not closeModal on successful save", () => {
  assert.match(wf, /refresh\(\)/);
  assert.ok(!wf.includes("closeModal()"));
});

test("modal wireSceneForm scene delete sends scenes-delete then refresh", () => {
  assert.match(tmpl, /scene-delete-btn[\s\S]*?kind: "scenes-delete", slug/);
  assert.match(tmpl, /scenes-delete[\s\S]*?refresh\(\)/);
});

test("modal wireSceneForm scene restore sends scenes-restore then closeModal", () => {
  assert.match(tmpl, /scene-restore-btn[\s\S]*?kind: "scenes-restore", slug/);
  assert.match(tmpl, /scenes-restore[\s\S]*?closeModal\(\)/);
});

test("modal row function renders scene glyph for scene rows", () => {
  assert.match(tmpl, /class="favicon scene-glyph">⌬/);
});

test("modal row function uses singular tab grammar when tabCount is one", () => {
  assert.match(tmpl, /tabCount === 1 \? "" : "s"/);
});

test("modal renderList scrolls selected row into view after paint", () => {
  assert.match(tmpl, /scrollIntoView\(\{ block: "nearest" \}\)/);
});

test("modal render hides broken favicon images on error", () => {
  assert.match(tmpl, /img\.addEventListener\("error", \(\) => \{ img\.style\.visibility = "hidden"; \}\)/);
});
