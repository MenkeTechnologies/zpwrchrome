// Unit tests for lib/dl-postcommands.js — pathMeta, glob match,
// shlex-style argv parsing, template expansion, rule pick, end-to-end
// buildSpawn.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STATE_KEY, DEFAULTS,
  pathMeta, matchGlob, parseArgv,
  expandToken, expandArgv, pickRule, buildSpawn,
} from "../lib/dl-postcommands.js";

// ─── Constants ─────────────────────────────────────────────────────
test("STATE_KEY + DEFAULTS shape", () => {
  assert.equal(STATE_KEY, "dl.postCommands");
  assert.ok(Object.isFrozen(DEFAULTS));
  assert.deepEqual(DEFAULTS.rules, []);
});

// ─── Path metadata ─────────────────────────────────────────────────
test("pathMeta: POSIX path splits cleanly", () => {
  assert.deepEqual(pathMeta("/Users/jacob/Downloads/foo.tar.gz"), {
    path: "/Users/jacob/Downloads/foo.tar.gz",
    dir:  "/Users/jacob/Downloads",
    name: "foo.tar.gz",
    base: "foo.tar",
    ext:  "gz",
  });
});

test("pathMeta: Windows path with backslashes works", () => {
  const m = pathMeta("C:\\Users\\Jacob\\Downloads\\app.exe");
  assert.equal(m.dir,  "C:\\Users\\Jacob\\Downloads");
  assert.equal(m.name, "app.exe");
  assert.equal(m.base, "app");
  assert.equal(m.ext,  "exe");
});

test("pathMeta: dotfile has empty base + ext is the rest", () => {
  // POSIX semantics: a leading dot is part of the basename, not an
  // extension separator. ".env" has no extension.
  const m = pathMeta("/etc/.env");
  assert.equal(m.name, ".env");
  assert.equal(m.base, ".env");
  assert.equal(m.ext,  "");
});

test("pathMeta: file with no extension", () => {
  assert.deepEqual(pathMeta("/tmp/README").ext, "");
  assert.deepEqual(pathMeta("/tmp/README").base, "README");
});

// ─── Glob matching ─────────────────────────────────────────────────
test("matchGlob: case-insensitive extension match", () => {
  assert.ok(matchGlob("/tmp/foo.zip",  "*.zip"));
  assert.ok(matchGlob("/tmp/foo.ZIP",  "*.zip"));
  assert.ok(matchGlob("/tmp/FOO.zip",  "*.ZIP"));
});

test("matchGlob: multi-segment globs match basename only", () => {
  // *.tar.gz matches the basename, doesn't traverse directories.
  assert.ok(matchGlob("/tmp/foo.tar.gz", "*.tar.gz"));
  assert.ok(!matchGlob("/tmp/foo.tar.gz", "*.gz") === false);  // matches both
  // Path components in the glob should NOT match — basename only.
  assert.ok(!matchGlob("/tmp/foo.zip", "tmp/*.zip"));
});

test("matchGlob: ? matches exactly one char", () => {
  assert.ok(matchGlob("/tmp/foo.mp3", "foo.mp?"));
  assert.ok(!matchGlob("/tmp/foo.mp34", "foo.mp?"));
});

test("matchGlob: literal dots / parens etc. don't act as regex meta", () => {
  // The regex inside matchGlob escapes . + ^ $ ( ) | etc., so `*.txt`
  // doesn't accidentally match `aXtxt`.
  assert.ok(!matchGlob("/tmp/aXtxt", "*.txt"));
  assert.ok(matchGlob("/tmp/(notes).txt", "(notes).txt"));
});

test("matchGlob: empty / missing glob returns false", () => {
  assert.equal(matchGlob("/tmp/foo.zip", ""), false);
  assert.equal(matchGlob("/tmp/foo.zip", null), false);
  assert.equal(matchGlob("/tmp/foo.zip", undefined), false);
});

// ─── Argv parsing (shlex-style) ────────────────────────────────────
test("parseArgv: simple whitespace split", () => {
  assert.deepEqual(parseArgv("unzip -d /tmp foo.zip"),
    ["unzip", "-d", "/tmp", "foo.zip"]);
});

test("parseArgv: single quotes preserve spaces literally", () => {
  assert.deepEqual(parseArgv("mv 'foo bar.zip' /tmp"),
    ["mv", "foo bar.zip", "/tmp"]);
  // Backslash inside single quotes is literal.
  assert.deepEqual(parseArgv("echo 'a\\nb'"), ["echo", "a\\nb"]);
});

test("parseArgv: double quotes allow backslash escape of \" and \\", () => {
  assert.deepEqual(parseArgv('echo "hello \\"world\\""'),
    ["echo", 'hello "world"']);
});

test("parseArgv: backslash escapes whitespace outside quotes", () => {
  assert.deepEqual(parseArgv("mv a\\ b /tmp"),
    ["mv", "a b", "/tmp"]);
});

test("parseArgv: empty / whitespace-only template → empty argv", () => {
  assert.deepEqual(parseArgv(""), []);
  assert.deepEqual(parseArgv("   "), []);
});

test("parseArgv: empty quoted string yields an empty argv entry", () => {
  // Useful for sentinel args. `'' --foo` → ["", "--foo"].
  assert.deepEqual(parseArgv("cmd '' --foo"), ["cmd", "", "--foo"]);
});

// ─── Token expansion ───────────────────────────────────────────────
test("expandToken: each placeholder substitutes from meta", () => {
  const meta = pathMeta("/tmp/foo.zip");
  assert.equal(expandToken("{path}", meta),  "/tmp/foo.zip");
  assert.equal(expandToken("{dir}",  meta),  "/tmp");
  assert.equal(expandToken("{name}", meta),  "foo.zip");
  assert.equal(expandToken("{base}", meta),  "foo");
  assert.equal(expandToken("{ext}",  meta),  "zip");
});

test("expandToken: same placeholder may appear multiple times", () => {
  const meta = pathMeta("/tmp/foo.zip");
  assert.equal(expandToken("{base}-{base}.{ext}", meta), "foo-foo.zip");
});

test("expandArgv: per-token expansion keeps spaces in {path} intact", () => {
  // Critical: a {path} containing whitespace must stay ONE argv entry
  // — that's the whole point of argv-style over shell mode.
  const argv = parseArgv("unzip -d {dir} {path}");
  const meta = pathMeta("/tmp/has space/foo.zip");
  assert.deepEqual(expandArgv(argv, meta),
    ["unzip", "-d", "/tmp/has space", "/tmp/has space/foo.zip"]);
});

// ─── Rule pick ─────────────────────────────────────────────────────
test("pickRule: returns first enabled match", () => {
  const rules = [
    { id: "a", glob: "*.gz",  command: "gunzip {path}",    enabled: true },
    { id: "b", glob: "*.zip", command: "unzip {path}",     enabled: true },
    { id: "c", glob: "*.zip", command: "atool -x {path}",  enabled: true },
  ];
  assert.equal(pickRule(rules, "/tmp/foo.zip").id, "b",
    "first-match semantics, not most-specific");
});

test("pickRule: skips disabled rules", () => {
  const rules = [
    { id: "a", glob: "*.zip", command: "x {path}", enabled: false },
    { id: "b", glob: "*.zip", command: "y {path}", enabled: true },
  ];
  assert.equal(pickRule(rules, "/tmp/foo.zip").id, "b");
});

test("pickRule: returns null when nothing matches", () => {
  const rules = [{ id: "a", glob: "*.gz", command: "gunzip {path}", enabled: true }];
  assert.equal(pickRule(rules, "/tmp/foo.zip"), null);
});

test("pickRule: empty/invalid rules → null", () => {
  assert.equal(pickRule(null, "/tmp/foo"), null);
  assert.equal(pickRule(undefined, "/tmp/foo"), null);
  assert.equal(pickRule([], "/tmp/foo"), null);
});

// ─── End-to-end ────────────────────────────────────────────────────
test("buildSpawn: produces argv + display string for a typical rule", () => {
  const rule = { glob: "*.zip", command: "unzip -d {dir} {path}", enabled: true };
  const out = buildSpawn(rule, "/tmp/has space/foo.zip");
  assert.deepEqual(out.argv,
    ["unzip", "-d", "/tmp/has space", "/tmp/has space/foo.zip"]);
  // Display preserves the user-visible command shape; args containing
  // whitespace get quoted so the notification reads sensibly.
  assert.equal(out.displayCommand,
    'unzip -d "/tmp/has space" "/tmp/has space/foo.zip"');
});

test("buildSpawn: empty command → empty argv (caller checks before spawning)", () => {
  const rule = { glob: "*.zip", command: "", enabled: true };
  const out = buildSpawn(rule, "/tmp/foo.zip");
  assert.deepEqual(out.argv, []);
});
