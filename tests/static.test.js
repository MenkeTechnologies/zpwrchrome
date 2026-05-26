// Static invariants for the unpacked extension. No chrome runtime needed —
// these checks are catchers for the failure modes that bite us at install time
// (Chrome refuses to load the extension) or at review time (doc drift, dead
// shortcuts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const cmds = manifest.commands;
const cmdNames = Object.keys(cmds);
const bgSrc = read("background.js");

test("manifest.json declares manifest_version 3", () => {
  assert.equal(manifest.manifest_version, 3);
});

test("manifest.json has at most 4 commands with suggested keys (Chrome ceiling)", () => {
  const withKey = cmdNames.filter((n) => cmds[n].suggested_key);
  assert.ok(withKey.length <= 4,
    `Chrome MV3 caps suggested_key to 4. Got ${withKey.length}: ${withKey.join(", ")}`);
});

test("every command has a non-empty description", () => {
  for (const name of cmdNames) {
    assert.ok(
      typeof cmds[name].description === "string" && cmds[name].description.trim().length > 0,
      `command ${name} is missing description`
    );
  }
});

test("no default suggested key uses macOS-reserved shortcuts", () => {
  // Per /Users/wizard/.claude/CLAUDE.md: Cmd+Tab/H/M/Q never reach the WebView.
  // Cmd+T/W/N are reserved by Chrome itself.
  const banned = [
    /^Command\+(Tab|H|M|Q|T|W|N|R|L|F|G)$/i,
    /^Cmd\+(Tab|H|M|Q|T|W|N|R|L|F|G)$/i,
    /^MacCtrl\+Tab$/i
  ];
  for (const name of cmdNames) {
    const sk = cmds[name].suggested_key;
    if (!sk) continue;
    for (const [platform, combo] of Object.entries(sk)) {
      for (const re of banned) {
        assert.ok(!re.test(combo),
          `command ${name} on ${platform} binds reserved shortcut ${combo}`);
      }
    }
  }
});

test("suggested keys do not collide with each other", () => {
  const seen = new Map();
  for (const name of cmdNames) {
    const sk = cmds[name].suggested_key;
    if (!sk) continue;
    for (const [platform, combo] of Object.entries(sk)) {
      const key = `${platform}:${combo}`;
      assert.ok(!seen.has(key),
        `key collision on ${platform}: ${combo} used by ${seen.get(key)} and ${name}`);
      seen.set(key, name);
    }
  }
});

test("every command name is valid kebab-case or _execute_*", () => {
  const ok = /^(_execute_[a-z_]+|[a-z][a-z0-9-]*[a-z0-9])$/;
  for (const name of cmdNames) {
    assert.ok(ok.test(name), `command name "${name}" is not kebab-case`);
  }
});

test("every user-dispatched command in manifest has a handler in background.js", () => {
  // Excluded: chrome builtins (_execute_*), search-tabs which calls
  // chrome.action.openPopup() from the dispatch table.
  const skip = new Set(["_execute_action"]);
  const jumpFamily = /^jump-to-[1-9]$/;
  let jumpCovered = false;
  for (const name of cmdNames) {
    if (skip.has(name)) continue;
    if (jumpFamily.test(name)) {
      jumpCovered = bgSrc.includes('command.startsWith("jump-to-")');
      assert.ok(jumpCovered, "jump-to-* family must be handled via startsWith dispatch");
      continue;
    }
    assert.ok(
      bgSrc.includes(`command === "${name}"`),
      `background.js has no \`command === "${name}"\` branch`
    );
  }
});

test("background.js does not dispatch commands not declared in manifest", () => {
  const declared = new Set(cmdNames);
  const found = [...bgSrc.matchAll(/command === "([a-z][a-z0-9-]+)"/g)].map((m) => m[1]);
  for (const c of found) {
    assert.ok(declared.has(c),
      `background.js handles "${c}" but it is not declared in manifest.json`);
  }
});

test("every file path referenced by manifest exists on disk", () => {
  const paths = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons)
  ];
  for (const p of paths) {
    const abs = join(ROOT, p);
    assert.ok(existsSync(abs), `manifest references missing file: ${p}`);
    assert.ok(statSync(abs).size > 0, `manifest references zero-byte file: ${p}`);
  }
});

test("manifest icons are PNG and match their declared size", () => {
  // PNG header: 8 bytes + IHDR length(4) + "IHDR"(4) + width(4) + height(4)
  for (const [size, path] of Object.entries(manifest.icons)) {
    const buf = readFileSync(join(ROOT, path));
    assert.equal(buf[0], 0x89, `${path} missing PNG signature`);
    assert.equal(buf.toString("ascii", 1, 4), "PNG", `${path} not a PNG`);
    const width  = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    assert.equal(width,  Number(size), `${path} width ${width} ≠ ${size}`);
    assert.equal(height, Number(size), `${path} height ${height} ≠ ${size}`);
  }
});

test("popup.html references popup.css and popup.js and contains no inline JS handlers", () => {
  const html = read("popup.html");
  assert.match(html, /href=["']popup\.css["']/);
  assert.match(html, /src=["']popup\.js["']/);
  // CSP under MV3 default-src forbids inline event handlers and inline <script>.
  assert.ok(!/on(click|change|input|load|submit|keydown)\s*=/.test(html),
    "popup.html contains an inline event handler (blocked by MV3 CSP)");
  assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html),
    "popup.html contains an inline <script> (blocked by MV3 CSP)");
});

test("popup.css keeps the strykelang cyberpunk palette variables", () => {
  // Acceptance criterion from the spec: visuals lifted from
  // strykelang docs/hud-static.css. Don't let a refactor strip the palette.
  const css = read("popup.css");
  for (const v of ["--cyan", "--accent", "--magenta", "--bg-card", "--cyan-glow"]) {
    assert.ok(css.includes(v), `popup.css missing palette variable ${v}`);
  }
  // Hex must match strykelang's --cyan: #05d9e8 and --accent: #ff2a6d.
  assert.match(css, /--cyan:\s*#05d9e8/);
  assert.match(css, /--accent:\s*#ff2a6d/);
});

test("README and docs/index.html are in sync with manifest (scripts/gen.sh is idempotent)", () => {
  const readmeBefore = read("README.md");
  const docsBefore   = read("docs/index.html");
  execFileSync("bash", [join(ROOT, "scripts/gen.sh")], { stdio: "pipe" });
  assert.equal(read("README.md"),       readmeBefore, "README.md drifted — re-run scripts/gen.sh and commit");
  assert.equal(read("docs/index.html"), docsBefore,   "docs/index.html drifted — re-run scripts/gen.sh and commit");
});

test("docs/index.html keeps the strykelang cyberpunk palette", () => {
  // Same guard as popup.css — the landing page must not silently lose the
  // visual identity it advertises.
  const html = read("docs/index.html");
  for (const v of ["--cyan", "--accent", "--magenta", "--bg-card", "--cyan-glow"]) {
    assert.ok(html.includes(v), `docs/index.html missing palette variable ${v}`);
  }
  assert.match(html, /--cyan:\s*#05d9e8/);
  assert.match(html, /--accent:\s*#ff2a6d/);
});

test("manifest permissions are all referenced by background.js or popup.js", () => {
  const popupSrc = read("popup.js");
  const all = bgSrc + "\n" + popupSrc;
  const usage = {
    tabs:           /chrome\.tabs\./,
    tabGroups:      /chrome\.tabGroups\./,
    sessions:       /chrome\.sessions\./,
    bookmarks:      /chrome\.bookmarks\./,
    storage:        /chrome\.storage\./,
    scripting:      /chrome\.scripting\./,
    clipboardWrite: /navigator\.clipboard\.writeText/
  };
  for (const perm of manifest.permissions) {
    assert.ok(usage[perm], `unknown permission in test mapping: ${perm}`);
    assert.match(all, usage[perm], `permission "${perm}" declared but never used`);
  }
});
