// Unit tests for lib/wappalyzer/engine.js — pattern compilation, the
// matchers for each signal group, version extraction, and the
// implies / requires / excludes graph rewrites. Uses small inline
// fingerprint corpora so the tests don't depend on the bundled
// technologies.json (covered by tests/wappalyzer-data.test.js).

import { test } from "node:test";
import assert from "node:assert/strict";

import { compileFingerprints, detect } from "../lib/wappalyzer/engine.js";

const compile = (obj) => compileFingerprints(obj);

// ─── Pattern compilation + signal matchers ─────────────────────────
test("html pattern: matches case-insensitively against full document text", () => {
  const out = detect(
    { html: "<html><body>Powered by Wordpress</body></html>" },
    compile({ "WordPress": { cats: [1], html: "wordpress" } }),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "WordPress");
  assert.equal(out[0].confidence, 100);
});

test("meta pattern: { name → pattern } shape, version extracted from group 1", () => {
  const out = detect(
    { meta: { generator: "WordPress 6.4.2" } },
    compile({ "WordPress": { cats: [1], meta: { generator: "WordPress\\s?([\\d.]+)?\\;version:\\1" } } }),
  );
  assert.equal(out[0].version, "6.4.2");
});

test("scripts pattern: matches against each <script src> URL in the array", () => {
  const out = detect(
    { scripts: ["https://cdn.shopify.com/foo.js", "https://other.com/x.js"] },
    compile({ "Shopify": { cats: [6], scripts: "cdn\\.shopify\\.com" } }),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Shopify");
});

test("headers pattern: { Name → pattern } keyed case-insensitively", () => {
  const corpus = compile({ "Nginx": { cats: [22], headers: { Server: "nginx(?:/([\\d.]+))?\\;version:\\1" } } });
  // Wappalyzer headers are case-insensitive — our compile lowercases keys
  // and the caller is expected to lowercase signals.headers names too.
  const out = detect({ headers: { server: "nginx/1.25.3 (Ubuntu)" } }, corpus);
  assert.equal(out[0].version, "1.25.3");
});

test("cookies pattern: presence-only matchers ({ name: '' }) succeed when cookie exists", () => {
  // Cookies are case-sensitive per RFC 6265 — caller must preserve the
  // original case from the Set-Cookie header.
  const out = detect(
    { cookies: { PHPSESSID: "abc123" } },
    compile({ "PHP": { cats: [27], cookies: { PHPSESSID: "" } } }),
  );
  assert.equal(out[0].name, "PHP");
});

test("js pattern: { window.path: pattern } matched against the jsGlobals bag", () => {
  const out = detect(
    { jsGlobals: { "React.version": "18.2.0" } },
    compile({ "React": { cats: [12], js: { "React.version": "(.+)\\;version:\\1" } } }),
  );
  assert.equal(out[0].version, "18.2.0");
});

test("url pattern: regex against signals.url", () => {
  const out = detect(
    { url: "https://shop.example.com/products/widget" },
    compile({ "Shopify Storefront": { cats: [6], url: "/products/" } }),
  );
  assert.equal(out.length, 1);
});

test("no signals → empty result", () => {
  const out = detect({}, compile({ "WordPress": { cats: [1], html: "wordpress" } }));
  assert.deepEqual(out, []);
});

test("confidence modifier (`;confidence:NN`) sets per-pattern confidence", () => {
  const out = detect(
    { html: "<meta name=\"generator\" content=\"X\">" },
    compile({ "Tentative": { cats: [19], html: "generator\\;confidence:25" } }),
  );
  assert.equal(out[0].confidence, 25);
});

// ─── implies graph ─────────────────────────────────────────────────
test("implies: detected tech adds its implied techs to the result set", () => {
  const corpus = compile({
    "WooCommerce": { cats: [6], html: "woocommerce", implies: "WordPress" },
    "WordPress":   { cats: [1] },
  });
  const out = detect({ html: "<div>woocommerce</div>" }, corpus);
  const names = out.map((r) => r.name).sort();
  assert.deepEqual(names, ["WooCommerce", "WordPress"]);
});

test("implies with confidence tail downweights the implied tech", () => {
  const corpus = compile({
    "A": { cats: [1], html: "marker-a", implies: "B\\;confidence:50" },
    "B": { cats: [1] },
  });
  const out = detect({ html: "marker-a" }, corpus);
  const b = out.find((r) => r.name === "B");
  assert.equal(b.confidence, 50);
  assert.equal(b.matched[0].group, "implied");
});

test("implies doesn't double-up if the implied tech matched directly already", () => {
  const corpus = compile({
    "A": { cats: [1], html: "marker-a", implies: "B" },
    "B": { cats: [1], html: "marker-b" },
  });
  const out = detect({ html: "marker-a marker-b" }, corpus);
  const b = out.find((r) => r.name === "B");
  assert.equal(b.confidence, 100,
    "the directly-matched confidence must NOT be overwritten by an implies entry");
});

// ─── requires + excludes ───────────────────────────────────────────
test("requires: tech only counts when every requirement is also present", () => {
  const corpus = compile({
    "Plugin": { cats: [1], html: "marker-p", requires: "Host" },
    "Host":   { cats: [1] },
  });
  const onlyPlugin = detect({ html: "marker-p" }, corpus);
  assert.equal(onlyPlugin.length, 0, "plugin must be dropped without host");
});

test("excludes: a detected tech evicts the named excludees from results", () => {
  const corpus = compile({
    "ServerA": { cats: [22], html: "marker-a", excludes: "ServerB" },
    "ServerB": { cats: [22], html: "marker-b" },
  });
  const out = detect({ html: "marker-a marker-b" }, corpus);
  const names = out.map((r) => r.name);
  assert.ok(names.includes("ServerA"));
  assert.ok(!names.includes("ServerB"));
});

// ─── corpus shape robustness ───────────────────────────────────────
test("compileFingerprints: tolerates patterns as string OR array", () => {
  const c = compile({
    "A": { cats: [1], html: "one" },
    "B": { cats: [1], html: ["one", "two"] },
  });
  assert.equal(c.length, 2);
});

test("compileFingerprints: implies + requires + excludes accept string or array", () => {
  const c = compile({
    "Solo": { cats: [1], html: "x", implies: "X", requires: "Y", excludes: "Z" },
    "Many": { cats: [1], html: "x", implies: ["X", "Y"], requires: ["A", "B"], excludes: ["C"] },
  });
  assert.equal(c[0].implies.length,  1);
  assert.equal(c[1].implies.length,  2);
  assert.equal(c[0].requires.length, 1);
  assert.equal(c[1].requires.length, 2);
  assert.equal(c[0].excludes.length, 1);
  assert.equal(c[1].excludes.length, 1);
});

test("invalid regex source compiles into a no-op pattern (does not throw)", () => {
  // Wappalyzer authors occasionally ship a pattern that JS can't parse —
  // we tolerate it instead of throwing so one bad pattern doesn't kill
  // every detection.
  const c = compile({ "Bad": { cats: [1], html: "[unclosed-bracket" } });
  const out = detect({ html: "anything" }, c);
  assert.deepEqual(out, []);
});

// ─── version best-of selection ─────────────────────────────────────
test("version: first non-empty extracted version wins across groups", () => {
  const out = detect(
    { meta: { generator: "Foo 1.2.3" }, scripts: ["/foo-1.2.3.min.js"] },
    compile({ "Foo": {
      cats: [78],
      meta:    { generator: "Foo\\s?([\\d.]+)\\;version:\\1" },
      scripts: "foo-([\\d.]+)\\.min\\.js\\;version:\\1",
    }}),
  );
  assert.equal(out[0].version, "1.2.3");
});

// ─── matched annotations are useful for debugging ──────────────────
test("result.matched lists every signal group that contributed a hit", () => {
  const out = detect(
    { html: "wordpress", meta: { generator: "WordPress 6.4" } },
    compile({ "WordPress": {
      cats: [1],
      html: "wordpress",
      meta: { generator: "WordPress\\s?([\\d.]+)?\\;version:\\1" },
    }}),
  );
  const groups = out[0].matched.map((m) => m.group).sort();
  assert.deepEqual(groups, ["html", "meta"]);
});
