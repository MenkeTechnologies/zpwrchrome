// manifest.json permissions, content scripts, and MV3 structure invariants.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));

test("manifest_version is 3 for service worker background", () => {
  assert.equal(manifest.manifest_version, 3);
});

test("background service_worker points at background.js module", () => {
  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal(manifest.background.type, "module");
});

test("manifest declares userScripts permission for native userscript mode", () => {
  assert.ok(manifest.permissions.includes("userScripts"));
});

test("manifest declares webNavigation permission for fire log", () => {
  assert.ok(manifest.permissions.includes("webNavigation"));
});

test("manifest declares scripting permission for fallback inject", () => {
  assert.ok(manifest.permissions.includes("scripting"));
});

test("manifest optional_permissions includes processes for dev channel", () => {
  assert.ok(manifest.optional_permissions.includes("processes"));
});

test("manifest host_permissions grants all_urls for content script injection", () => {
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
});

test("content script injects modal/content.js at document_idle", () => {
  const cs = manifest.content_scripts[0];
  assert.ok(cs.js.includes("modal/content.js"));
  assert.equal(cs.run_at, "document_idle");
  assert.equal(cs.all_frames, false);
});

test("content script excludes Chrome Web Store URLs", () => {
  const cs = manifest.content_scripts[0];
  assert.ok(cs.exclude_matches.some((p) => p.includes("webstore")));
});

test("options_ui opens scripts-manager in a full tab", () => {
  assert.equal(manifest.options_ui.page, "scripts-manager/manager.html");
  assert.equal(manifest.options_ui.open_in_tab, true);
});

test("manifest minimum_chrome_version is at least 120 for userScripts API", () => {
  const min = parseInt(manifest.minimum_chrome_version, 10);
  assert.ok(min >= 120);
});

test("manifest declares tabGroups permission for group-by-domain command", () => {
  assert.ok(manifest.permissions.includes("tabGroups"));
});

test("manifest declares sessions permission for recently closed restore", () => {
  assert.ok(manifest.permissions.includes("sessions"));
});

test("manifest action default_popup is popup.html", () => {
  assert.equal(manifest.action.default_popup, "popup.html");
});

test("web_accessible_resources exposes modal content script path", () => {
  const war = manifest.web_accessible_resources[0];
  assert.ok(war.resources.includes("modal/content.js"));
});
