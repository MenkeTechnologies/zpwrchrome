// wireSceneForm save flow and status messages in popup.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");

const wfStart = popup.indexOf("function wireSceneForm()");
const wfEnd = popup.indexOf("function render()");
assert.ok(wfStart >= 0 && wfEnd > wfStart, "wireSceneForm missing");
const wf = popup.slice(wfStart, wfEnd);

test("wireSceneForm returns early when scene form elements missing", () => {
  assert.match(wf, /if \(!nameInput \|\| !saveBtn\) return/);
});

test("wireSceneForm rejects empty trimmed name with status message", () => {
  assert.match(wf, /if \(!name\) \{ status\.textContent = "name required"; return; \}/);
});

test("wireSceneForm shows saving status before sendMessage", () => {
  assert.match(wf, /status\.textContent = "saving…"/);
});

test("wireSceneForm sends scenes-save with trimmed name", () => {
  assert.match(wf, /kind: "scenes-save", name/);
});

test("wireSceneForm error status includes resp.error or fallback text", () => {
  assert.match(wf, /status\.textContent = "error: " \+ \(resp\?\.error \|\| "no tabs to save"\)/);
});

test("wireSceneForm success status shows saved tab count from scene", () => {
  assert.match(wf, /saved \$\{resp\.scene\?\.tabs\?\.length \|\| 0\} tabs/);
});

test("wireSceneForm clears name input after successful save", () => {
  assert.match(wf, /nameInput\.value = ""/);
});

test("wireSceneForm calls refresh after successful save", () => {
  assert.match(wf, /refresh\(\)/);
});

test("wireSceneForm save button click triggers submit", () => {
  assert.match(wf, /saveBtn\.addEventListener\("click", submit\)/);
});

test("wireSceneForm Enter key on name input prevents default and submits", () => {
  assert.match(wf, /nameInput\.addEventListener\("keydown"/);
  assert.match(wf, /e\.key === "Enter"\)[\s\S]*?e\.preventDefault\(\); submit\(\)/);
});

test("renderList scene form includes maxlength 48 on scene name input", () => {
  assert.match(popup, /class="scene-name"[\s\S]*?maxlength="48"/);
});
