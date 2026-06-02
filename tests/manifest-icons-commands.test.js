// manifest icons, commands keys, and web_accessible_resources invariants.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));

const iconSizes = ["16", "32", "48", "128"];

test("manifest declares icon PNGs at all four standard sizes", () => {
  for (const size of iconSizes) {
    assert.ok(manifest.icons[size], `missing icons.${size}`);
    assert.equal(manifest.icons[size], `icons/icon${size}.png`);
  }
});

test("action default_icon matches top-level icons map", () => {
  for (const size of iconSizes) {
    assert.equal(manifest.action.default_icon[size], manifest.icons[size]);
  }
});

test("icon PNG files exist on disk for each declared size", () => {
  for (const size of iconSizes) {
    assert.ok(existsSync(join(ROOT, manifest.icons[size])), `missing ${manifest.icons[size]}`);
  }
});

test("manifest action default_title names zpwrchrome", () => {
  // Tooltip on the toolbar icon. After the rebrand it just identifies the
  // extension by name rather than calling itself a recent-tabs switcher.
  assert.match(manifest.action.default_title, /zpwrchrome/i);
});

test("_execute_action command suggests Alt+T on all platforms", () => {
  const cmd = manifest.commands._execute_action;
  assert.equal(cmd.suggested_key.default, "Alt+T");
  assert.equal(cmd.suggested_key.mac, "Alt+T");
});

test("open-history command suggests Ctrl+Y default and Command+Y on mac", () => {
  const cmd = manifest.commands["open-history"];
  assert.equal(cmd.suggested_key.default, "Ctrl+Y");
  assert.equal(cmd.suggested_key.mac, "Command+Y");
});

test("switch-previous-tab suggests Ctrl+E default and Command+E on mac", () => {
  const cmd = manifest.commands["switch-previous-tab"];
  assert.equal(cmd.suggested_key.default, "Ctrl+E");
  assert.equal(cmd.suggested_key.mac, "Command+E");
});

test("manifest author is MenkeTechnologies", () => {
  assert.equal(manifest.author, "MenkeTechnologies");
});

test("manifest homepage_url points at GitHub repo", () => {
  assert.match(manifest.homepage_url, /github\.com\/MenkeTechnologies\/zpwrchrome/);
});

test("manifest short_name is zpwrchrome", () => {
  assert.equal(manifest.short_name, "zpwrchrome");
});

test("web_accessible_resources matches all_urls for modal script", () => {
  const war = manifest.web_accessible_resources[0];
  assert.deepEqual(war.matches, ["<all_urls>"]);
});

test("manifest declares at least 30 named commands excluding _execute_action", () => {
  const names = Object.keys(manifest.commands);
  assert.ok(names.length >= 30);
});

test("every command except _execute_action has a description string", () => {
  for (const [name, cmd] of Object.entries(manifest.commands)) {
    if (name === "_execute_action") continue;
    assert.ok(typeof cmd.description === "string" && cmd.description.length > 0, name);
  }
});

test("manifest name + description cover pass + downloads + tabs + history", () => {
  // The rebrand: zpwrchrome is no longer a "Hyper Tab Switcher" — it's a
  // browser power-tool whose surface includes UNIX `pass`, the segmented
  // download manager, the JetBrains-style tab switcher, and fzf history.
  assert.equal(manifest.name, "zpwrchrome");
  assert.match(manifest.description, /pass/i,                 "description should mention UNIX pass integration");
  assert.match(manifest.description, /download/i,             "description should mention the download manager");
  assert.match(manifest.description, /tab switcher/i,         "description should mention the tab switcher");
  assert.match(manifest.description, /history/i,              "description should mention history search");
});
