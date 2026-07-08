// Manifest V3 wiring beyond tests/static.test.js command counts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));

test("manifest background service worker is ES module type", () => {
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.background.service_worker, "background.js");
});

test("manifest declares minimum_chrome_version 127", () => {
  assert.equal(manifest.minimum_chrome_version, "127");
});

test("manifest includes tabGroups permission for group-by-domain", () => {
  assert.ok(manifest.permissions.includes("tabGroups"));
});

test("manifest includes webNavigation for userscript fire logging", () => {
  assert.ok(manifest.permissions.includes("webNavigation"));
});

test("manifest includes userScripts permission for native Tampermonkey mode", () => {
  assert.ok(manifest.permissions.includes("userScripts"));
});

test("manifest does not list `processes` (dev/canary-only API was removed)", () => {
  assert.ok(!(manifest.optional_permissions || []).includes("processes"));
});

test("manifest host_permissions grants <all_urls> for content script injection", () => {
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
});

test("manifest content_scripts inject modal/content.js at document_idle", () => {
  const cs = manifest.content_scripts[0];
  assert.deepEqual(cs.js, ["modal/content.js"]);
  assert.equal(cs.run_at, "document_idle");
  assert.equal(cs.all_frames, false);
});

test("manifest excludes Chrome Web Store from content script injection", () => {
  const cs = manifest.content_scripts[0];
  assert.ok(cs.exclude_matches.some((p) => p.includes("chromewebstore")));
});

test("manifest web_accessible_resources exposes modal/content.js", () => {
  const war = manifest.web_accessible_resources[0];
  assert.ok(war.resources.includes("modal/content.js"));
  assert.deepEqual(war.matches, ["<all_urls>"]);
});

test("manifest action popup points at popup.html", () => {
  assert.equal(manifest.action.default_popup, "popup.html");
});

test("manifest options_ui opens scripts manager in a tab", () => {
  assert.equal(manifest.options_ui.page, "scripts-manager/dashboard.html");
  assert.equal(manifest.options_ui.open_in_tab, true);
});

test("manifest icons exist at all declared sizes", () => {
  for (const size of ["16", "32", "48", "128"]) {
    const rel = manifest.icons[size];
    assert.ok(existsSync(join(ROOT, rel)), `${rel} missing`);
  }
});

test("manifest action icons mirror top-level icons", () => {
  assert.deepEqual(manifest.action.default_icon, manifest.icons);
});

test("manifest switch-previous-tab binds Ctrl+E on Windows and Command+E on Mac", () => {
  const cmd = manifest.commands["switch-previous-tab"];
  assert.equal(cmd.suggested_key.default, "Ctrl+E");
  assert.equal(cmd.suggested_key.mac, "Command+E");
});

test("manifest open-history binds Ctrl+Y on Windows and Command+Y on Mac", () => {
  const cmd = manifest.commands["open-history"];
  assert.equal(cmd.suggested_key.default, "Ctrl+Y");
  assert.equal(cmd.suggested_key.mac, "Command+Y");
});

test("manifest _execute_action uses Alt+T on all platforms", () => {
  const cmd = manifest.commands["_execute_action"];
  assert.equal(cmd.suggested_key.default, "Alt+T");
  assert.equal(cmd.suggested_key.mac, "Alt+T");
});

test("manifest command count matches Object.keys(commands).length dynamically", () => {
  const count = Object.keys(manifest.commands).length;
  assert.ok(count >= 38, `expected at least 38 commands, got ${count}`);
});

test("manifest short_name matches package branding", () => {
  assert.equal(manifest.short_name, "zpwrchrome");
});
