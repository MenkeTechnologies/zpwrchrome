// Extended popup ↔ background message protocol coverage.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const bg = readFileSync(join(ROOT, "background.js"), "utf8");
const popup = readFileSync(join(ROOT, "popup.js"), "utf8");
const manager = readFileSync(join(ROOT, "scripts-manager/manager.js"), "utf8");
const modal = readFileSync(join(ROOT, "modal/content.template.js"), "utf8");

const BG_KINDS = [...new Set(
  [...bg.matchAll(/msg\?\.kind === "([a-z][\w.:-]*)"/g)].map((m) => m[1])
)].sort();

const CLIENT_SRC = popup + "\n" + manager + "\n" + modal;
const CLIENT_KINDS = [...new Set(
  [...CLIENT_SRC.matchAll(/(?:sendMessage|send)\([\s\S]{0,200}?kind:\s*"([a-z][\w.:-]*)"/g)].map((m) => m[1])
)].sort();

test("background.js handles at least 25 distinct message kinds", () => {
  assert.ok(BG_KINDS.length >= 25, `expected large handler surface, got ${BG_KINDS.length}`);
});

test("every client sendMessage kind has a background handler", () => {
  for (const kind of CLIENT_KINDS) {
    assert.ok(BG_KINDS.includes(kind), `client sends "${kind}" but background has no handler`);
  }
});

test("background handles scripts.list for manager dashboard", () => {
  assert.ok(BG_KINDS.includes("scripts.list"));
  assert.match(manager, /kind:\s*"scripts\.list"/);
});

test("background handles scripts.firelog and scripts.firelog.clear", () => {
  assert.ok(BG_KINDS.includes("scripts.firelog"));
  assert.ok(BG_KINDS.includes("scripts.firelog.clear"));
});

test("background handles all gm:* storage and clipboard kinds", () => {
  for (const kind of ["gm:getValue", "gm:setValue", "gm:deleteValue", "gm:listValues", "gm:setClipboard", "gm:openInTab", "gm:fire", "gm:notification"]) {
    assert.ok(BG_KINDS.includes(kind), `missing handler for ${kind}`);
  }
});

test("background handles scenes-list/save/restore/delete", () => {
  for (const kind of ["scenes-list", "scenes-save", "scenes-restore", "scenes-delete"]) {
    assert.ok(BG_KINDS.includes(kind));
    assert.match(popup, new RegExp(`kind:\\s*"${kind.replace(".", "\\.")}"`));
  }
});

test("background handles history-list and history-delete for fzf history", () => {
  assert.ok(BG_KINDS.includes("history-list"));
  assert.ok(BG_KINDS.includes("history-delete"));
});

test("background no longer handles processes-snapshot / kill-heaviest (chrome.processes removed)", () => {
  assert.ok(!BG_KINDS.includes("processes-snapshot"));
  assert.ok(!BG_KINDS.includes("kill-heaviest"));
});

test("manager.js sends scripts.save via editor", () => {
  assert.match(manager, /kind:\s*"scripts\.save"/);
  assert.ok(BG_KINDS.includes("scripts.save"));
});

test("manager.js sends scripts.delete and scripts.toggle", () => {
  assert.match(manager, /kind:\s*"scripts\.delete"/);
  assert.match(manager, /kind:\s*"scripts\.toggle"/);
});

test("modal template sends gm:openInTab for history row activation", () => {
  assert.match(modal, /kind: "gm:openInTab"/);
});

test("modal template sends open-scripts-manager for dashboard link", () => {
  assert.match(modal, /kind: "open-scripts-manager"/);
  assert.ok(BG_KINDS.includes("open-scripts-manager"));
});

test("popup sends list on refresh bootstrap", () => {
  assert.match(popup, /kind: "list"/);
});

test("popup sends activate restore close-tab for row actions", () => {
  for (const kind of ["activate", "restore", "close-tab"]) {
    assert.match(popup, new RegExp(`kind: "${kind}"`));
  }
});

test("background message handlers return true for async sendResponse", () => {
  for (const kind of ["list", "history-list", "activate", "scripts.list"]) {
    const idx = bg.indexOf(`msg?.kind === "${kind}"`);
    const tail = bg.slice(idx, idx + 2000);
    assert.match(tail, /return true/, `${kind} must return true`);
  }
});

test("background does not handle open-modal (content-script local dispatch)", () => {
  assert.ok(!BG_KINDS.includes("open-modal"));
});

test("background does not handle close-modal (content-script local dispatch)", () => {
  assert.ok(!BG_KINDS.includes("close-modal"));
});

test("CLIENT_KINDS count matches union of popup manager modal sends", () => {
  assert.ok(CLIENT_KINDS.length >= 15, `expected rich client protocol, got ${CLIENT_KINDS.length}`);
});
