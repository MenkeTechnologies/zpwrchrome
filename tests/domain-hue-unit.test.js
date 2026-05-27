// domainHueFor stable hue mapping unit tests in lib/util.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { domainHueFor, hostnameOf } from "../lib/util.js";

test("domainHueFor returns integer in range 0..359 inclusive", () => {
  const urls = [
    "https://github.com/",
    "https://news.ycombinator.com/",
    "https://example.co.uk/path",
    "file:///tmp/x",
  ];
  for (const url of urls) {
    const h = domainHueFor(url);
    assert.ok(Number.isInteger(h));
    assert.ok(h >= 0 && h < 360, `hue ${h} out of range for ${url}`);
  }
});

test("domainHueFor is identical for same host different paths", () => {
  assert.equal(
    domainHueFor("https://docs.google.com/a"),
    domainHueFor("https://docs.google.com/b?q=1")
  );
});

test("domainHueFor differs for unrelated hosts", () => {
  const a = domainHueFor("https://apple.com/");
  const b = domainHueFor("https://banana.org/");
  assert.notEqual(a, b);
});

test("domainHueFor uses hostnameOf internally for host extraction", () => {
  const host = hostnameOf("https://sub.example.net/x");
  const h1 = domainHueFor("https://sub.example.net/x");
  const h2 = domainHueFor(`http://${host}/y`);
  assert.equal(h1, h2);
});

test("domainHueFor handles empty url via hostnameOf (other)", () => {
  const h = domainHueFor("");
  assert.ok(h >= 0 && h < 360);
  assert.equal(domainHueFor(""), domainHueFor("not-a-url"));
});

test("domainHueFor file URLs map to (local) host bucket", () => {
  assert.equal(domainHueFor("file:///a"), domainHueFor("file:///b"));
});

test("domainHueFor is deterministic across repeated calls", () => {
  const url = "https://stackoverflow.com/questions/1";
  const hues = Array.from({ length: 5 }, () => domainHueFor(url));
  assert.ok(hues.every((h) => h === hues[0]));
});

test("domainHueFor subdomain changes hue from apex when hosts differ", () => {
  const apex = domainHueFor("https://example.com/");
  const sub  = domainHueFor("https://api.example.com/");
  assert.notEqual(apex, sub);
});

test("domainHueFor port in URL does not change hue for same host", () => {
  assert.equal(
    domainHueFor("https://example.com:443/a"),
    domainHueFor("https://example.com:8443/b")
  );
});

test("domainHueFor internationalized hostname is stable", () => {
  const h1 = domainHueFor("https://münchen.de/a");
  const h2 = domainHueFor("https://münchen.de/b");
  assert.equal(h1, h2);
});

test("domainHueFor http and https on same host share hue", () => {
  assert.equal(domainHueFor("http://reddit.com/"), domainHueFor("https://reddit.com/"));
});

test("domainHueFor query strings do not affect hue", () => {
  assert.equal(
    domainHueFor("https://youtube.com/watch?v=1"),
    domainHueFor("https://youtube.com/watch?v=2")
  );
});
