// matchPatternToRegex scheme-by-scheme behavior. Existing tests cover the
// common cases (https, http, *://); this pins file://, ftp://, * scheme
// semantics, urn rejection, port-bearing hosts, and the empty-host edge.

import { test } from "node:test";
import assert from "node:assert/strict";
import { matchPatternToRegex } from "../lib/userscript.js";

test("matchPatternToRegex file:/// (empty host) matches local file URLs", () => {
  // Chrome's spec lets file:// patterns have an empty host segment.
  const re = matchPatternToRegex("file:///*");
  assert.notEqual(re, null);
  assert.ok(re.test("file:///etc/hosts"));
  assert.ok(re.test("file:///Users/me/index.html"));
});

test("matchPatternToRegex file:///<path> does not match http URLs", () => {
  const re = matchPatternToRegex("file:///*");
  assert.equal(re.test("https://example.com/"), false);
  assert.equal(re.test("ftp://example.com/"), false);
});

test("matchPatternToRegex ftp:// host pattern matches ftp URLs only", () => {
  const re = matchPatternToRegex("ftp://files.example.com/*");
  assert.ok(re.test("ftp://files.example.com/pub/readme"));
  assert.equal(re.test("https://files.example.com/pub/readme"), false);
  assert.equal(re.test("http://files.example.com/pub/readme"), false);
});

test("matchPatternToRegex * scheme covers http and https but NOT ftp or file", () => {
  const re = matchPatternToRegex("*://example.com/*");
  assert.ok(re.test("http://example.com/x"));
  assert.ok(re.test("https://example.com/x"));
  assert.equal(re.test("ftp://example.com/x"), false);
  assert.equal(re.test("file:///example.com/x"), false);
});

test("matchPatternToRegex urn: bare scheme:path form is rejected (returns null)", () => {
  // Chrome requires scheme://host/path. URN's scheme:path form has no //host,
  // so the regex builder doesn't accept it.
  assert.equal(matchPatternToRegex("urn:foo:bar"), null);
});

test("matchPatternToRegex urn://host/path is accepted (// form)", () => {
  // The regex builder requires // after the scheme. urn:// is unusual but
  // syntactically accepted by the parser.
  const re = matchPatternToRegex("urn://example.com/path");
  assert.notEqual(re, null);
});

test("matchPatternToRegex preserves port in host segment when present", () => {
  const re = matchPatternToRegex("http://localhost:8080/*");
  assert.notEqual(re, null);
  assert.ok(re.test("http://localhost:8080/api/health"));
  assert.equal(re.test("http://localhost/api/health"), false,
    "different port must not match");
});

test("matchPatternToRegex host star matches arbitrary host segment", () => {
  const re = matchPatternToRegex("https://*/*");
  assert.ok(re.test("https://example.com/x"));
  assert.ok(re.test("https://api.v2.example.com/y"));
  assert.ok(re.test("https://localhost/z"));
});

test("matchPatternToRegex host *.domain matches apex and any depth of subdomain", () => {
  const re = matchPatternToRegex("https://*.example.com/*");
  assert.ok(re.test("https://example.com/"));
  assert.ok(re.test("https://api.example.com/x"));
  assert.ok(re.test("https://a.b.c.d.example.com/y"));
  assert.equal(re.test("https://example.org/"), false);
});

test("matchPatternToRegex literal host without wildcards is case-insensitive on URL", () => {
  // regex uses /i flag → URL case doesn't matter.
  const re = matchPatternToRegex("https://example.com/*");
  assert.ok(re.test("https://Example.COM/x"));
});

test("matchPatternToRegex path wildcard expands across slashes (single * is any-chars)", () => {
  const re = matchPatternToRegex("https://example.com/*");
  assert.ok(re.test("https://example.com/a/b/c?q=1"));
});

test("matchPatternToRegex path /foo* matches anything starting with /foo (incl. /foobar)", () => {
  // Substring wildcard: any chars after /foo, including no chars.
  const re = matchPatternToRegex("https://example.com/foo*");
  assert.ok(re.test("https://example.com/foo"));
  assert.ok(re.test("https://example.com/foobar"));
  assert.ok(re.test("https://example.com/foo/bar"));
  assert.equal(re.test("https://example.com/baz"), false);
});

test("matchPatternToRegex empty host with scheme other than file is accepted (edge)", () => {
  // The regex builder doesn't restrict empty host to file only — pin so a
  // future tightening (file-only empty host) is intentional.
  const re = matchPatternToRegex("https:///*");
  assert.notEqual(re, null);
});

test("matchPatternToRegex returns null on patterns with no scheme separator", () => {
  assert.equal(matchPatternToRegex("just-a-string"), null);
});

test("matchPatternToRegex returns null on patterns with invalid scheme", () => {
  // Only *, http, https, file, ftp, urn are accepted.
  assert.equal(matchPatternToRegex("git://github.com/x/*"), null);
  assert.equal(matchPatternToRegex("ssh://host/x"), null);
  assert.equal(matchPatternToRegex("data:text/html,foo"), null);
});
