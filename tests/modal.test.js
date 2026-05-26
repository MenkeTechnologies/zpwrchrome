// Static invariants for the JetBrains-style Recent Tabs modal content script.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const manifest = JSON.parse(read("manifest.json"));
const content = read("modal/content.js");

test("manifest declares modal/content.js as a content script on <all_urls>", () => {
  assert.ok(Array.isArray(manifest.content_scripts), "no content_scripts array");
  const cs = manifest.content_scripts[0];
  assert.ok(cs.matches.includes("<all_urls>"), "content script must match <all_urls>");
  assert.ok(cs.js.includes("modal/content.js"), "modal/content.js must be in cs.js");
});

test("content script is also declared web_accessible_resources (for fallback injection)", () => {
  const war = manifest.web_accessible_resources || [];
  const all = war.flatMap((w) => w.resources || []);
  assert.ok(all.includes("modal/content.js"),
    "modal/content.js must be in web_accessible_resources so scripting.executeScript can load it");
});

test("recent-modal command is declared with a default-suggested key", () => {
  const cmd = manifest.commands["recent-modal"];
  assert.ok(cmd, "recent-modal command missing");
  assert.ok(cmd.suggested_key, "recent-modal must ship with a default key (this is the headline feature)");
  // Mac default must be Cmd+E to match JetBrains.
  assert.equal(cmd.suggested_key.mac, "Command+E",
    "Mac default key for recent-modal must be Command+E (JetBrains parity)");
  // Cross-platform default Ctrl+E.
  assert.equal(cmd.suggested_key.default, "Ctrl+E");
});

test("background.js dispatches recent-modal", () => {
  const bg = read("background.js");
  assert.match(bg, /command === "recent-modal"/, "background.js missing handler");
  assert.match(bg, /tabs\.sendMessage\([^)]*\{\s*kind:\s*"open-modal"/,
    "background.js must send open-modal to the active tab");
});

test("content script is wrapped in an IIFE and is idempotent", () => {
  // Two injections in the same page must not double-install listeners.
  assert.match(content, /\(\(\) => \{[\s\S]+\}\)\(\);/, "content script not an IIFE");
  assert.match(content, /window\[.*?"-installed"\]/, "no idempotency guard");
});

test("content script attaches a closed shadow root (style isolation)", () => {
  assert.match(content, /attachShadow\(\{\s*mode:\s*"closed"/,
    "modal must use closed shadow root to keep host CSS out");
});

test("content script never uses an inline event handler attribute", () => {
  // No `onclick=`, `onerror=`, etc. in the rendered HTML.
  const inlineHandler = /\bon(click|change|input|error|load|submit|keydown|mouseover|mouseenter|focus|blur)\s*=/i;
  // Allowed: the regex pattern source itself in the test would match, so we
  // look at the content of `html()` template literals.
  const htmlBlocks = [...content.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
  for (const block of htmlBlocks) {
    assert.ok(!inlineHandler.test(block),
      `inline event handler in template literal:\n${block.slice(0, 200)}`);
  }
});

test("content script listens for open-modal and close-modal messages", () => {
  assert.match(content, /msg\?\.kind === "open-modal"/);
  assert.match(content, /msg\?\.kind === "close-modal"/);
});

test("content script sends activate / restore / close-tab / list to background", () => {
  for (const kind of ["activate", "restore", "close-tab", "list"]) {
    const re = new RegExp(`sendMessage\\(\\s*\\{\\s*kind:\\s*"${kind}"`);
    assert.match(content, re, `content script must send "${kind}"`);
  }
});

test("content script declares the 6 JetBrains-style categories", () => {
  const expected = ["all", "current", "pinned", "audible", "muted", "closed"];
  for (const id of expected) {
    const re = new RegExp(`id:\\s*"${id}"`);
    assert.match(content, re, `category "${id}" not declared`);
  }
});

test("content script keyboard nav covers JetBrains-canonical keys", () => {
  // Cmd+E (cycle), Cmd+1..6 (category jump), Arrow nav, Enter, Esc, Delete.
  assert.match(content, /metaKey.*ctrlKey.*"e"/, "Cmd/Ctrl+E cycling missing");
  assert.match(content, /\[1-6\]/,                  "Cmd+1..6 category nav missing");
  assert.match(content, /e\.key === "ArrowDown"/,   "ArrowDown missing");
  assert.match(content, /e\.key === "ArrowUp"/,     "ArrowUp missing");
  assert.match(content, /e\.key === "Enter"/,       "Enter missing");
  assert.match(content, /e\.key === "Escape"/,      "Escape missing");
});

test("content script renders an interactive search input", () => {
  assert.match(content, /class="search"/);
  assert.match(content, /\.querySelector\("\.search"\)\.focus\(\)/);
});

test("content script uses the strykelang HUD palette", () => {
  for (const hex of ["#05d9e8", "#ff2a6d", "#0d0d1a", "#0a0a14", "#e0f0ff"]) {
    assert.ok(content.includes(hex), `palette color ${hex} missing from modal CSS`);
  }
});

test("recent-modal does not break the 4-default-keys ceiling", () => {
  // Adding recent-modal as default-keyed means one prior command must have
  // been demoted. Re-verify the global count.
  const cmds = manifest.commands;
  const defaults = Object.keys(cmds).filter((k) => cmds[k].suggested_key);
  assert.ok(defaults.length <= 4,
    `Chrome MV3 caps suggested_key at 4. Got ${defaults.length}: ${defaults.join(", ")}`);
});

test("content script is excluded from the Chrome Web Store (Chrome blocks it anyway)", () => {
  const cs = manifest.content_scripts[0];
  const excl = cs.exclude_matches || [];
  const hasWebStore = excl.some((m) => /chromewebstore|webstore/.test(m));
  assert.ok(hasWebStore,
    "content script must exclude *://chromewebstore.google.com/* (Chrome silently refuses to inject there)");
});
