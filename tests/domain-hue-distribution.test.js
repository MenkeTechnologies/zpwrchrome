// domainHueFor distribution invariants. domain-hue-unit.test.js covers
// per-call determinism + same-host stability. This file pins the broader
// hash-distribution properties the minimap relies on: a normal corpus of
// hosts produces a spread of hues (not all 0), query/fragment changes
// don't affect hue, scheme doesn't either, and the output stays within
// the documented 0..359 range.

import { test } from "node:test";
import assert from "node:assert/strict";
import { domainHueFor } from "../lib/util.js";

const CORPUS = [
  "https://github.com/x",
  "https://gitlab.com/x",
  "https://news.ycombinator.com/x",
  "https://lobste.rs/x",
  "https://stackoverflow.com/x",
  "https://docs.rs/x",
  "https://crates.io/x",
  "https://mozilla.org/x",
  "https://chromium.org/x",
  "https://golang.org/x",
  "https://typescript.org/x",
  "https://nodejs.org/x",
  "https://npmjs.com/x",
  "https://pnpm.io/x",
  "https://reddit.com/x",
  "https://twitter.com/x",
  "https://wikipedia.org/x",
  "https://archlinux.org/x",
  "https://kernel.org/x",
  "https://apple.com/x",
];

test("domainHueFor stays within 0..359 inclusive for a typical browser corpus", () => {
  for (const url of CORPUS) {
    const hue = domainHueFor(url);
    assert.ok(hue >= 0 && hue <= 359,
      `${url} hue ${hue} must be in [0, 359]`);
    assert.equal(Number.isInteger(hue), true, `${url} hue must be integer`);
  }
});

test("domainHueFor produces enough hue diversity to color a 20-host minimap", () => {
  const hues = new Set(CORPUS.map(domainHueFor));
  // A working hash should give at least 10 distinct hues across 20 hosts.
  // (A degenerate "always 0" would silently kill the minimap legend.)
  assert.ok(hues.size >= 10,
    `expected ≥10 distinct hues from 20 hosts, got ${hues.size}: ${[...hues].sort((a, b) => a - b).join(",")}`);
});

test("domainHueFor ignores URL path when hostname is identical", () => {
  assert.equal(
    domainHueFor("https://example.com/path/one"),
    domainHueFor("https://example.com/different/path?q=1"),
  );
});

test("domainHueFor ignores URL fragment", () => {
  assert.equal(
    domainHueFor("https://example.com/page"),
    domainHueFor("https://example.com/page#section"),
  );
});

test("domainHueFor ignores URL query string", () => {
  assert.equal(
    domainHueFor("https://example.com/page"),
    domainHueFor("https://example.com/page?a=1&b=2"),
  );
});

test("domainHueFor http and https produce the same hue for matching host", () => {
  assert.equal(
    domainHueFor("http://example.com/"),
    domainHueFor("https://example.com/"),
  );
});

test("domainHueFor ws and wss schemes share hue with http/https", () => {
  // hostnameOf parses any URL through `new URL`; scheme isn't hashed.
  assert.equal(
    domainHueFor("wss://api.example.com/socket"),
    domainHueFor("https://api.example.com/"),
  );
});

test("domainHueFor groups all file:// URLs under one (local) bucket", () => {
  assert.equal(
    domainHueFor("file:///tmp/a.html"),
    domainHueFor("file:///home/x/index.html"),
  );
});

test("domainHueFor groups all unparseable URLs under one (other) bucket", () => {
  assert.equal(
    domainHueFor(""),
    domainHueFor("not a url"),
  );
});

test("domainHueFor subdomain differs from apex (different hostnames hash separately)", () => {
  assert.notEqual(
    domainHueFor("https://api.example.com/"),
    domainHueFor("https://example.com/"),
  );
});

test("domainHueFor port number in URL does not change hue (hostname excludes port)", () => {
  assert.equal(
    domainHueFor("https://example.com/"),
    domainHueFor("https://example.com:8443/"),
  );
});
