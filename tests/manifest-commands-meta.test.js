// manifest.json command metadata completeness and consistency.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const bg = readFileSync(join(ROOT, "background.js"), "utf8");

const commands = manifest.commands;
const names = Object.keys(commands);

test("manifest declares at least 35 keyboard commands", () => {
  assert.ok(names.length >= 35, `expected large surface, got ${names.length}`);
});

test("every manifest command has a non-empty description string", () => {
  for (const name of names) {
    const desc = commands[name].description;
    assert.ok(typeof desc === "string" && desc.trim().length > 0,
      `command "${name}" missing description`);
  }
});

test("background.js action context menu obeys ACTION_MENU_TOP_LEVEL_LIMIT = 6", () => {
  // Chrome's chrome.contextMenus API caps action-context menus at 6
  // top-level items (ACTION_MENU_TOP_LEVEL_LIMIT in the docs); items
  // beyond #6 are silently dropped by Chrome — not failures we can
  // catch from JS. Count: every `create({ id: …, contexts: act })`
  // call WITHOUT a `parentId:` field is a top-level item.
  //
  // Match per call: `parentId:` either present (submenu child) or
  // absent (top-level). We only count calls that include
  // `contexts: act` (the action menu — not link/media/page menus).
  const m = bg.match(/create\(\{[^}]*contexts:\s*act[^}]*\}/g) || [];
  const topLevel = m.filter((s) => !/parentId/.test(s));
  assert.ok(topLevel.length <= 6,
    `action menu has ${topLevel.length} top-level items; Chrome silently drops items > 6 (use parentId submenus)`);
});

test("manifest command descriptions contain no literal HTML tags", () => {
  // Chrome's chrome://extensions/shortcuts page parses command
  // descriptions through a tiny HTML allowlist (parseHtmlSubset in
  // extensions.js). An unsupported tag like <video> throws
  // `VIDEO is not supported` at render time and the whole shortcut
  // list for the extension fails to display. We caught this with the
  // lights-off description's "<video>" — write descriptions with
  // backticks or the word, never angle brackets around a tag name.
  const TAG_LIKE = /<[a-z][a-z0-9]*\b/i;
  for (const name of names) {
    const desc = commands[name].description || "";
    assert.ok(!TAG_LIKE.test(desc),
      `command "${name}" description has a tag-like substring (Chrome's shortcuts UI will reject it): "${desc}"`);
  }
});

test("manifest command descriptions are unique (no copy-paste duplicates)", () => {
  const descs = names.map((n) => commands[n].description);
  const uniq = new Set(descs);
  assert.equal(uniq.size, descs.length, "duplicate command descriptions found");
});

test("_execute_action description mentions popup", () => {
  assert.match(commands._execute_action.description, /popup/i);
});

test("switch-previous-tab description mentions MRU or previous", () => {
  assert.match(commands["switch-previous-tab"].description, /MRU|previous/i);
});

test("open-history description mentions history", () => {
  assert.match(commands["open-history"].description, /history/i);
});

test("manage-scripts description mentions userscript or script manager", () => {
  assert.match(commands["manage-scripts"].description, /userscript|script manager|scripts manager/i);
});

test("kill-heaviest command removed (chrome.processes is dev/canary only)", () => {
  assert.ok(!("kill-heaviest" in commands),
    "kill-heaviest must not be in manifest.commands");
});

test("jump-to-1 through jump-to-9 each have descriptions", () => {
  for (let i = 1; i <= 9; i++) {
    const key = `jump-to-${i}`;
    assert.ok(commands[key], `missing ${key}`);
    assert.ok(commands[key].description.length > 5);
  }
});

test("restore-scene-1 through restore-scene-5 each have descriptions", () => {
  for (let i = 1; i <= 5; i++) {
    const key = `restore-scene-${i}`;
    assert.ok(commands[key], `missing ${key}`);
    assert.ok(commands[key].description.length > 5);
  }
});

test("restore-scene-1 description mentions new window with saved tabs", () => {
  assert.match(commands["restore-scene-1"].description, /window|tabs|scene/i);
});

test("batch tab ops commands mention close reload sort or group", () => {
  const batch = ["close-others", "close-right", "close-duplicates", "reload-all", "sort-by-url", "group-by-domain"];
  for (const name of batch) {
    assert.ok(commands[name], `missing ${name}`);
    assert.match(commands[name].description, /close|reload|sort|group|tab/i);
  }
});

test("clipboard commands mention copy or bookmark", () => {
  for (const name of ["copy-url", "copy-title-md", "bookmark-tab"]) {
    assert.match(commands[name].description, /copy|bookmark|clipboard|markdown/i);
  }
});

test("single-tab ops commands mention duplicate pin mute or window", () => {
  for (const name of ["duplicate-tab", "pin-tab", "mute-tab", "move-to-new-window"]) {
    assert.match(commands[name].description, /duplicate|pin|mute|window|tab/i);
  }
});

test("mru-next and mru-prev descriptions mention MRU or tab order", () => {
  assert.match(commands["mru-next"].description, /MRU|next|forward/i);
  assert.match(commands["mru-prev"].description, /MRU|previous|back/i);
});

test("save-scene-prompt description mentions scene", () => {
  assert.match(commands["save-scene-prompt"].description, /scene/i);
});

test("search-tabs description mentions popup or filter", () => {
  assert.match(commands["search-tabs"].description, /popup|filter|search/i);
});

test("background dispatch handles every non-family manifest command", () => {
  for (const name of names) {
    if (name === "_execute_action") continue;
    if (/^jump-to-[1-9]$/.test(name)) continue;
    if (/^restore-scene-[1-9]$/.test(name)) continue;
    assert.ok(bg.includes(`command === "${name}"`), `no dispatch for ${name}`);
  }
});
