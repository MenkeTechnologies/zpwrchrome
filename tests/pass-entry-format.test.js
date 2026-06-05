// Unit tests for lib/pass-entry.js — the encoder, path validator, and tree
// builder used by the password manager full-page UI.
//
// Round-trip safety: parse(format(x)) must recover every editor-visible
// field of x. format(parse(text)) need NOT be byte-identical to text (we
// canonicalize key order + fold synonyms behind preferred keys when the
// editor injected a value), but the parsed semantics must round-trip.

import { test } from "node:test";
import assert from "node:assert/strict";

import { formatEntry, validatePassPath, buildTree, derivePassPath } from "../lib/pass-entry.js";
import { parseEntry, fallbackUsernameFromPath, fallbackUrlFromPath } from "../lib/bp-pass.js";

const reparse = (text) => parseEntry(text);

test("formatEntry: password-only entry has no key:value lines", () => {
  const text = formatEntry({ password: "hunter2" });
  assert.equal(text, "hunter2\n");
});

test("formatEntry: empty input yields a single newline (no password)", () => {
  assert.equal(formatEntry({}), "\n");
  assert.equal(formatEntry({ password: "" }), "\n");
  assert.equal(formatEntry(null), "\n");
});

test("formatEntry: top-level username promotes to login: when fields lack a synonym", () => {
  const text = formatEntry({ password: "p", username: "alice" });
  assert.equal(text, "p\nlogin: alice\n");
});

test("formatEntry: top-level url promotes to url: when fields lack a synonym", () => {
  const text = formatEntry({ password: "p", url: "https://x.test/" });
  assert.equal(text, "p\nurl: https://x.test/\n");
});

test("formatEntry: existing username synonym wins over top-level username", () => {
  const text = formatEntry({
    password: "p",
    username: "ignored",
    fields: { email: "kept@x.test" },
  });
  // email must remain (not be replaced by login:); ignored must be dropped
  assert.match(text, /email: kept@x\.test/);
  assert.doesNotMatch(text, /login: ignored/);
});

test("formatEntry: existing url synonym wins over top-level url", () => {
  const text = formatEntry({
    password: "p",
    url: "https://overwritten.test/",
    fields: { website: "https://kept.test/" },
  });
  assert.match(text, /website: https:\/\/kept\.test\//);
  assert.doesNotMatch(text, /url: https:\/\/overwritten\.test\//);
});

test("formatEntry: otpauth URI emits on its own line", () => {
  const text = formatEntry({
    password: "p",
    otpUrl: "otpauth://totp/x?secret=ABC",
  });
  assert.match(text, /\notpauth:\/\/totp\/x\?secret=ABC\n$/);
});

test("formatEntry: empty otpUrl is omitted, not emitted as a blank line", () => {
  const text = formatEntry({ password: "p", otpUrl: "" });
  assert.equal(text, "p\n");
});

test("formatEntry: notes as array preserves order, one line each", () => {
  const text = formatEntry({
    password: "p",
    notes: ["recovery codes:", "  1: aaa-bbb", "  2: ccc-ddd"],
  });
  assert.equal(text, "p\nrecovery codes:\n  1: aaa-bbb\n  2: ccc-ddd\n");
});

test("formatEntry: notes as string is split on newlines", () => {
  const text = formatEntry({ password: "p", notes: "line1\nline2" });
  assert.equal(text, "p\nline1\nline2\n");
});

// ─── Notes storage in the .gpg entry file ───────────────────────────
// Notes are NOT a separate field on disk — they are trailing free-form
// lines in the same .gpg file as the password, key:value fields, and
// otpauth URI. The tests below pin the on-disk byte shape so a refactor
// can't accidentally route notes through a sidecar / separate store.

test("notes: live inline in the .gpg file after fields + otpauth", () => {
  // The bytes that round-trip through `pass show` (and that bpSaveEntry
  // sends to the host's `save` action) must be: password\nfields\notp\nnotes
  const text = formatEntry({
    password: "pw",
    username: "alice",
    url:      "https://x.test/",
    otpUrl:   "otpauth://totp/x?secret=S",
    notes:    ["recovery: keep offline", "second note"],
  });
  assert.equal(
    text,
    "pw\nlogin: alice\nurl: https://x.test/\notpauth://totp/x?secret=S\nrecovery: keep offline\nsecond note\n",
  );
});

test("notes: round-trip — text written by formatEntry parses back into entry.notes", () => {
  const original = "pw\nlogin: alice\nfirst note\nsecond note\nthird note\n";
  const parsed = parseEntry(original);
  assert.deepEqual(parsed.notes, ["first note", "second note", "third note"]);
  const reformatted = formatEntry(parsed);
  // Re-parse to confirm semantics; byte-identity is not required.
  const reparsed = parseEntry(reformatted);
  assert.deepEqual(reparsed.notes, ["first note", "second note", "third note"]);
});

test("notes: blank lines between notes are NOT preserved (parseEntry skips empty lines)", () => {
  // Documents the lossy behavior — useful as a regression pin if we ever
  // decide to preserve blanks. parseEntry's `if (!line) continue` is the
  // source: see lib/bp-pass.js parseEntry().
  const original = "pw\nline a\n\nline b\n";
  const parsed = parseEntry(original);
  assert.deepEqual(parsed.notes, ["line a", "line b"]);
});

test("notes: a line that LOOKS like otpauth:// is captured as otpUrl, not notes", () => {
  // Important consequence: a user can't write `otpauth://...` as a
  // note — it'll get pulled out into the OTP row.
  const parsed = parseEntry("pw\nsome note\notpauth://totp/foo?secret=S\ntrailing note\n");
  assert.equal(parsed.otpUrl, "otpauth://totp/foo?secret=S");
  assert.deepEqual(parsed.notes, ["some note", "trailing note"]);
});

test("notes: a line with a space-bearing 'key' falls into notes, not fields", () => {
  // parseEntry rejects `key: value` when the key contains whitespace
  // (`if (key && !key.includes(" "))`). So `Recovery Codes: foo` is a note.
  const parsed = parseEntry("pw\nRecovery Codes: aaa-bbb-ccc\n");
  assert.deepEqual(parsed.fields, {});
  assert.deepEqual(parsed.notes, ["Recovery Codes: aaa-bbb-ccc"]);
});

test("notes: a line WITHOUT a colon falls into notes", () => {
  const parsed = parseEntry("pw\nfree form sentence no colon at all\n");
  assert.deepEqual(parsed.notes, ["free form sentence no colon at all"]);
});

test("notes: re-parsing a save survives unicode + punctuation + leading whitespace", () => {
  const noteLines = [
    "  indented note",
    "✅ done · 2026-06-03",
    "see https://example.com/path?q=1&r=2",
    "$ shell line — no colon",
  ];
  const text = formatEntry({ password: "pw", notes: noteLines });
  const reparsed = parseEntry(text);
  // The "see https://..." line DOES contain a colon (https:); parseEntry
  // splits on the first colon, key = "see https" which contains a space,
  // so it falls into notes. The "✅ done · 2026-06-03" line has a colon
  // inside the date (none — em-dash). The "$ shell line" has no colon.
  // All four lines must survive verbatim.
  assert.deepEqual(reparsed.notes, noteLines);
});

test("notes: every other field can be empty and notes still serialize cleanly", () => {
  // Edge case — entry that is ONLY notes (no password, no fields, no otp).
  // Useful for the user storing free-form encrypted scratch text.
  const text = formatEntry({ password: "", notes: ["just text", "and more"] });
  assert.equal(text, "\njust text\nand more\n");
  const reparsed = parseEntry(text);
  assert.equal(reparsed.password, "");
  assert.deepEqual(reparsed.notes, ["just text", "and more"]);
});

test("notes: large note bodies (200 lines) survive a full round-trip", () => {
  const noteLines = Array.from({ length: 200 }, (_, i) => `note line ${i + 1}`);
  const text = formatEntry({ password: "pw", notes: noteLines });
  const reparsed = parseEntry(text);
  assert.equal(reparsed.notes.length, 200);
  assert.equal(reparsed.notes[0],   "note line 1");
  assert.equal(reparsed.notes[199], "note line 200");
});

test("notes: order is stable across a parse → format → parse cycle", () => {
  const noteLines = ["zebra", "alpha", "middle", "yankee", "bravo"];
  const text = formatEntry({ password: "pw", notes: noteLines });
  const reparsed = parseEntry(text);
  assert.deepEqual(reparsed.notes, noteLines);
});

test("notes: trailing newline is preserved exactly once (no double-\\n at EOF)", () => {
  // The host's `save` action writes the bytes literally. Two trailing
  // newlines would change `pass show` output and could fail strict
  // file diff checks; one is the convention.
  const text = formatEntry({ password: "pw", notes: ["hi"] });
  assert.equal(text, "pw\nhi\n");
  assert.ok(!text.endsWith("\n\n"), "should not double-terminate");
});

test("formatEntry: extra fields sort alphabetically after login/url synonyms", () => {
  const text = formatEntry({
    password: "p",
    fields: { zebra: "z", alpha: "a", login: "l", url: "u" },
  });
  // expected order: login, url, alpha, zebra
  assert.equal(text, "p\nlogin: l\nurl: u\nalpha: a\nzebra: z\n");
});

test("round-trip: parse(format(parsed)) recovers password+username+url+otp+notes", () => {
  const original = "pw1\nlogin: alice\nurl: https://x.test/\notpauth://totp/x?secret=S\nnote line\n";
  const parsed = parseEntry(original);
  const reformatted = formatEntry(parsed);
  const reparsed = parseEntry(reformatted);
  assert.equal(reparsed.password, "pw1");
  assert.equal(reparsed.username, "alice");
  assert.equal(reparsed.url,      "https://x.test/");
  assert.equal(reparsed.otpUrl,   "otpauth://totp/x?secret=S");
  assert.deepEqual(reparsed.notes, ["note line"]);
});

test("round-trip: arbitrary extra fields survive parse→format→parse", () => {
  const original = "pw\nlogin: a\nrecovery: codes-here\nbackup_email: x@y.z\n";
  const reparsed = reparse(formatEntry(parseEntry(original)));
  assert.equal(reparsed.fields.login,         "a");
  assert.equal(reparsed.fields.recovery,      "codes-here");
  assert.equal(reparsed.fields.backup_email,  "x@y.z");
});

test("round-trip: editing the password leaves other fields intact", () => {
  const original = "old\nlogin: a\nurl: https://x.test/\n";
  const parsed = parseEntry(original);
  parsed.password = "new";
  const text = formatEntry(parsed);
  assert.equal(text, "new\nlogin: a\nurl: https://x.test/\n");
});

// ─── derivePassPath — new-entry path auto-population ────────────────
test("derivePassPath: scheme + path + www stripped from URL", () => {
  assert.equal(derivePassPath({ url: "https://amazon.com/foo",   login: "alice" }), "amazon.com/alice");
  assert.equal(derivePassPath({ url: "https://www.adobe.com/",   login: "j@x.edu" }), "adobe.com/j@x.edu");
  assert.equal(derivePassPath({ url: "http://api.example.com",   login: "root"  }), "api.example.com/root");
});

test("derivePassPath: scheme-less URL works", () => {
  assert.equal(derivePassPath({ url: "adobe.com",   login: "alice" }), "adobe.com/alice");
  assert.equal(derivePassPath({ url: "github.com/o", login: "bob"  }), "github.com/bob");
});

test("derivePassPath: userinfo (foo@host) is stripped", () => {
  assert.equal(derivePassPath({ url: "https://bob:pw@amazon.com/x", login: "alice" }), "amazon.com/alice");
});

test("derivePassPath: port is stripped", () => {
  assert.equal(derivePassPath({ url: "https://localhost:8080/x", login: "dev" }), "localhost/dev");
});

test("derivePassPath: missing URL returns null", () => {
  assert.equal(derivePassPath({ url: "",    login: "alice" }), null);
  assert.equal(derivePassPath({              login: "alice" }), null);
  assert.equal(derivePassPath({}),                              null);
  assert.equal(derivePassPath(null),                            null);
});

test("derivePassPath: missing login returns just the host (still a valid 1-segment path)", () => {
  assert.equal(derivePassPath({ url: "https://example.com/" }),               "example.com");
  assert.equal(derivePassPath({ url: "https://example.com/", login: "" }),    "example.com");
  assert.equal(derivePassPath({ url: "https://example.com/", login: "  " }),  "example.com");
});

test("derivePassPath: whitespace + embedded slashes in login are stripped", () => {
  // The login is used as a single path segment — slashes inside it would
  // create unintended directories, so we strip them.
  assert.equal(derivePassPath({ url: "amazon.com", login: " alice " }), "amazon.com/alice");
  assert.equal(derivePassPath({ url: "amazon.com", login: "team/admin" }), "amazon.com/teamadmin");
});

test("derivePassPath: NUL bytes are scrubbed", () => {
  assert.equal(derivePassPath({ url: "amazon\0.com", login: "ali\0ce" }), "amazon.com/alice");
});

test("derivePassPath: output clears validatePassPath for realistic inputs", () => {
  for (const [url, login] of [
    ["https://amazon.com",                "alice"],
    ["https://www.adobe.com/",            "j@x.edu"],
    ["http://api.example.com:9000/x?y=1", "service-account"],
  ]) {
    const p = derivePassPath({ url, login });
    assert.equal(validatePassPath(p), null, `should validate: ${p}`);
  }
});

test("validatePassPath: accepts normal nested paths", () => {
  assert.equal(validatePassPath("github.com/alice"), null);
  assert.equal(validatePassPath("work/aws/prod/root"), null);
  assert.equal(validatePassPath("a"), null);
});

test("validatePassPath: rejects empty / leading-slash / trailing-slash", () => {
  assert.match(validatePassPath(""),         /empty/);
  assert.match(validatePassPath("/x"),       /leading/);
  assert.match(validatePassPath("a/"),       /directory/);
});

test("validatePassPath: rejects path traversal segments", () => {
  assert.match(validatePassPath("../x"),       /invalid path segment/);
  assert.match(validatePassPath("a/../b"),     /invalid path segment/);
  assert.match(validatePassPath("a/./b"),      /invalid path segment/);
  assert.match(validatePassPath("a//b"),       /invalid path segment/);
});

test("validatePassPath: rejects NUL byte", () => {
  assert.match(validatePassPath("a\0b"), /NUL/);
});

test("buildTree: empty input yields empty root", () => {
  const t = buildTree([]);
  assert.deepEqual(t.dirs, []);
  assert.deepEqual(t.entries, []);
});

test("buildTree: groups by directory, sorts within each level", () => {
  const t = buildTree([
    "github.com/zoe",
    "github.com/alice",
    "aws/prod/root",
    "aws/dev/root",
    "top-level",
  ]);
  assert.deepEqual(t.entries.map((e) => e.name), ["top-level"]);
  assert.deepEqual(t.dirs.map((d) => d.name), ["aws", "github.com"]);
  const aws = t.dirs.find((d) => d.name === "aws");
  assert.deepEqual(aws.dirs.map((d) => d.name), ["dev", "prod"]);
  const gh = t.dirs.find((d) => d.name === "github.com");
  assert.deepEqual(gh.entries.map((e) => e.name), ["alice", "zoe"]);
});

test("buildTree: tolerates trailing .gpg and leading slash", () => {
  const t = buildTree(["/github.com/alice.gpg", "github.com/bob"]);
  const gh = t.dirs.find((d) => d.name === "github.com");
  assert.deepEqual(gh.entries.map((e) => e.name), ["alice", "bob"]);
  // Stored path keeps no .gpg, no leading slash
  assert.equal(gh.entries[0].path, "github.com/alice");
});

test("buildTree: paths produced are the entry's relative path (no leading /)", () => {
  const t = buildTree(["nested/dir/entry"]);
  const dir1 = t.dirs[0];
  const dir2 = dir1.dirs[0];
  assert.equal(dir2.entries[0].path, "nested/dir/entry");
});

test("fallbackUrlFromPath: uses first dir segment verbatim (no https:// prepend)", () => {
  const parsed = parseEntry("hunter2\nlogin: alice\n");
  fallbackUrlFromPath(parsed, "adobe.com/jmenke@wccnet.edu");
  assert.equal(parsed.url, "adobe.com");
});

test("fallbackUrlFromPath: leaves url alone when entry already has one", () => {
  const parsed = parseEntry("pw\nurl: https://kept.test/\n");
  fallbackUrlFromPath(parsed, "github.com/alice");
  assert.equal(parsed.url, "https://kept.test/");
});

test("fallbackUrlFromPath: non-dotted first segment used literally (amcrest/admin → amcrest)", () => {
  const parsed = parseEntry("pw\n");
  fallbackUrlFromPath(parsed, "amcrest/admin");
  assert.equal(parsed.url, "amcrest");
});

test("fallbackUrlFromPath: root-level dotted entry uses basename verbatim", () => {
  const parsed = parseEntry("pw\n");
  fallbackUrlFromPath(parsed, "example.com");
  assert.equal(parsed.url, "example.com");
});

test("fallbackUrlFromPath: nested entry always uses the first segment", () => {
  const parsed = parseEntry("pw\n");
  fallbackUrlFromPath(parsed, "work/aws/console.aws.amazon.com/root");
  assert.equal(parsed.url, "work");
});

test("fallbackUrlFromPath: tolerates .gpg suffix and leading slash", () => {
  const parsed = parseEntry("pw\n");
  fallbackUrlFromPath(parsed, "/github.com/alice.gpg");
  assert.equal(parsed.url, "github.com");
});

test("fallbackUrlFromPath: subdomain.example.com root entry", () => {
  const parsed = parseEntry("pw\n");
  fallbackUrlFromPath(parsed, "subdomain.example.com");
  assert.equal(parsed.url, "subdomain.example.com");
});

test("fallback: format respects an existing username field set via fallbackUsernameFromPath", () => {
  // The popup uses fallbackUsernameFromPath to fill .username from the entry's
  // basename when no login/username field exists. The editor should NOT then
  // serialize that fallback back into the file as `login: <basename>` — we
  // detect it by only promoting top-level username when *fields* lacks any
  // synonym. Real entries that had no login still won't re-grow one here
  // unless the user types one in.
  const parsed = fallbackUsernameFromPath(parseEntry("pw\n"), "github.com/alice.gpg");
  assert.equal(parsed.username, "alice");
  // If the editor doesn't change anything, the round-trip should still emit
  // `login: alice` because top-level username is the only signal we have —
  // that's the cost of using the basename fallback. Caller decides to strip
  // it before formatEntry if they don't want it written back.
  const text = formatEntry(parsed);
  assert.match(text, /login: alice/);
});
