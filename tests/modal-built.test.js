// Invariants on the built modal/content.js artifact (post build-modal.sh).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const content = readFileSync(join(ROOT, "modal/content.js"), "utf8");

test("built modal parses under node --check", () => {
  execFileSync("node", ["--check", join(ROOT, "modal/content.js")], { stdio: "pipe" });
});

test("built modal inlines fzfMatch without export keyword", () => {
  assert.match(content, /function fzfMatch\(/);
  assert.ok(!/export function fzfMatch/.test(content));
});

test("built modal inlines frecencyScore from util block", () => {
  assert.match(content, /function frecencyScore\(/);
});

test("built modal FONT_STM constant holds base64 (not %%STM%% marker)", () => {
  assert.ok(!content.includes('= "%%STM%%"'), "FONT_STM must be substituted");
  assert.match(content, /const FONT_STM = "[A-Za-z0-9+/=]{100,}"/);
});

test("built modal attaches shadow root in closed mode", () => {
  assert.match(content, /attachShadow\(\{\s*mode:\s*"closed"/);
});

test("built modal uses MODAL_ID host guard for idempotent injection", () => {
  assert.match(content, /zpwrchrome-modal-host-0a1b/);
});

test("built modal handleKey allows Cmd/Ctrl+C through (does not steal clipboard)", () => {
  const fn = content.match(/function handleKey\(e\)[\s\S]*?\n  \}/);
  assert.ok(fn);
  assert.match(fn[0], /if \(e\.metaKey \|\| e\.ctrlKey\) return/);
  assert.match(fn[0], /We don't block clipboard/);
});

test("built modal Cmd/Ctrl+E cycles MRU within the overlay", () => {
  const fn = content.match(/function handleKey\(e\)[\s\S]*?\n  \}/);
  assert.match(fn[0], /e\.key === "e" \|\| e\.key === "E"/);
  assert.match(fn[0], /cycle\(e\.shiftKey \? -1 : \+1\)/);
});

test("built modal printable keys append to filter via setFilter", () => {
  const fn = content.match(/function handleKey\(e\)[\s\S]*?\n  \}/);
  assert.match(fn[0], /e\.key\.length === 1/);
  assert.match(fn[0], /setFilter\(state\.filter \+ e\.key\)/);
});

test("built modal setFilter mirrors filter into visible search and focus sink", () => {
  const fn = content.match(/function setFilter\(next\)[\s\S]*?\n  \}/);
  assert.ok(fn);
  assert.match(fn[0], /search\.value = next/);
  assert.match(fn[0], /state\.sink\.value = next/);
});

test("built modal activate closes overlay after dispatching action", () => {
  const fn = content.match(/function activate\(idx\)[\s\S]*?\n  \}/);
  assert.ok(fn);
  assert.match(fn[0], /closeModal\(\)/);
});

test("built modal history activate routes through gm:openInTab", () => {
  const fn = content.match(/function activate\(idx\)[\s\S]*?\n  \}/);
  assert.match(fn[0], /kind: "gm:openInTab", url: t\.url, active: true/);
});

test("built modal Delete key closes open tabs or deletes history URLs", () => {
  const fn = content.match(/function handleKey\(e\)[\s\S]*?\n  \}/);
  assert.match(fn[0], /e\.key === "Delete"/);
  assert.match(fn[0], /kind: "close-tab"/);
  assert.match(fn[0], /history-delete/);
});

test("built modal CSS uses strykelang palette hex anchors", () => {
  for (const hex of ["#05d9e8", "#ff2a6d", "#0d0d1a", "#0a0a14", "#e0f0ff"]) {
    assert.ok(content.includes(hex), `missing palette ${hex}`);
  }
});

test("built modal row template escapes favicon URLs", () => {
  assert.match(content, /escapeHtml\(t\.favIconUrl\)/);
});

test("built modal includes fzf-hl mark class in highlight path", () => {
  assert.match(content, /fzf-hl/);
});

test("built modal refresh pulls currentWindowId from list response tabs", () => {
  assert.match(content, /state\.currentWindowId/);
});

test("built modal chrome.runtime.onMessage listens for open-modal and close-modal", () => {
  assert.match(content, /chrome\.runtime\.onMessage\.addListener/);
  assert.match(content, /msg\?\.kind === "open-modal"/);
  assert.match(content, /msg\?\.kind === "close-modal"/);
});

test("built modal does not use ES module import statements", () => {
  assert.ok(!/^import /m.test(content), "content script must be a single IIFE bundle");
});

test("built modal handleKeyUp is intentionally a no-op (Enter activates)", () => {
  const fn = content.match(/function handleKeyUp\(e\)[\s\S]*?\n  \}/);
  assert.ok(fn);
  assert.match(fn[0], /No-op for now/);
});

test("built modal wireSceneForm Enter submits scenes-save", () => {
  assert.match(content, /nameInput\.addEventListener\("keypress"/);
  assert.match(content, /e\.key === "Enter"\)[\s\S]*?submit\(\)/);
});

test("built modal scene restore/delete buttons stop row click propagation", () => {
  assert.match(content, /scene-restore-btn[\s\S]*?stopPropagation/);
  assert.match(content, /scene-delete-btn[\s\S]*?stopPropagation/);
});
