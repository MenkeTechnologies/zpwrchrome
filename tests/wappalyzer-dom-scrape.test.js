// Tests for the parts of lib/wappalyzer/engine.js that the matcher tests in
// wappalyzer-engine.test.js don't reach: the polymorphic `dom` rule parser,
// the dom + text signal groups in detect(), and the page-side
// scrapeSignals() probe. scrapeSignals runs in the page via
// chrome.scripting.executeScript, so it reads the free globals `window`,
// `document` and `location`; the tests install minimal stand-ins for those
// and restore the originals afterwards.
//
// The probe and the matcher are only useful together: background.js feeds
// scrapeSignals' output straight into detect(). Several tests therefore
// run the full scrape -> detect round trip, because a key or casing mismatch
// between the two halves silently drops every match for that fingerprint.

import { test } from "node:test";
import assert from "node:assert/strict";

import { compileFingerprints, detect, scrapeSignals } from "../lib/wappalyzer/engine.js";

// ─── Fake page ─────────────────────────────────────────────────────
// el({ text, attrs, props }) → an element with just the surface scrapeSignals
// touches: textContent, getAttribute, and arbitrary own properties.
function el({ text = "", attrs = {}, props = {} } = {}) {
  const node = {
    textContent: text,
    getAttribute: (name) => (Object.hasOwn(attrs, name) ? attrs[name] : null),
  };
  return Object.defineProperties(node, Object.getOwnPropertyDescriptors(props));
}

// withPage(page, fn) — install window/document/location for one call.
//   page.elements: { selector → element | "throw" }  ("throw" = invalid selector)
function withPage(page, fn) {
  const elements = page.elements || {};
  const doc = {
    documentElement: page.html == null ? null : { outerHTML: page.html },
    body: page.text == null ? null : { innerText: page.text },
    cookie: page.cookie ?? "",
    querySelectorAll(sel) {
      if (sel === "script[src]") return (page.scripts || []).map((src) => ({ src }));
      if (sel.startsWith("meta")) return (page.metas || []).map((attrs) => el({ attrs }));
      return [];
    },
    querySelector(sel) {
      const hit = elements[sel];
      if (hit === "throw") throw new SyntaxError(`'${sel}' is not a valid selector`);
      return hit ?? null;
    },
  };
  const saved = {};
  const globals = {
    window: page.window || {},
    document: doc,
    location: { href: page.href ?? "https://example.com/" },
  };
  for (const k of Object.keys(globals)) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { value: globals[k], configurable: true, writable: true });
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(globals)) {
      if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
      else delete globalThis[k];
    }
  }
}

const names = (hits) => hits.map((h) => h.name).sort();

// ─── dom rule parsing (observed through compileFingerprints) ────────
test("dom: every upstream shape normalizes to flat {selector, kind} rules", () => {
  const [rec] = compileFingerprints({
    T: {
      dom: {
        "#exists-empty": "",
        "#exists-null": null,
        "#exists-obj": { exists: "" },
        "#text-short": "Powered by (\\w+)",
        "#multi": {
          exists: "",
          text: "hello",
          attributes: { "data-a": "x", "data-b": "y" },
          properties: { _p: "" },
        },
      },
    },
  });
  const flat = rec.dom.map((r) => `${r.selector}|${r.kind}|${r.attr || r.prop || ""}`);
  assert.deepEqual(flat, [
    "#exists-empty|exists|",
    "#exists-null|exists|",
    "#exists-obj|exists|",
    "#text-short|text|",
    "#multi|exists|",
    "#multi|text|",
    "#multi|attribute|data-a",
    "#multi|attribute|data-b",
    "#multi|property|_p",
  ]);
  // The string shorthand is a TEXT rule whose pattern is the string.
  assert.equal(rec.dom[3].textPattern.source, "Powered by (\\w+)");
});

test("dom: string and array forms produce exists rules; arrays may nest objects", () => {
  const [str] = compileFingerprints({ T: { dom: ".one" } });
  assert.deepEqual(str.dom, [{ selector: ".one", kind: "exists" }]);
  const [list] = compileFingerprints({ T: { dom: [".a", { ".b": { text: "z" } }] } });
  assert.deepEqual(list.dom.map((r) => [r.selector, r.kind]), [[".a", "exists"], [".b", "text"]]);
});

test("dom: non-string/object values (numbers, booleans) yield no rules", () => {
  const [rec] = compileFingerprints({ T: { dom: 42 } });
  assert.deepEqual(rec.dom, []);
});

// ─── dom + text signal groups in detect() ──────────────────────────
test("dom exists: matches only when the probe reported the exact rule key", () => {
  const corpus = compileFingerprints({ Foo: { cats: [1], dom: "#foo-root" } });
  assert.deepEqual(names(detect({ dom: { "#foo-root|exists|": "1" } }, corpus)), ["Foo"]);
  // Same selector but a different kind must not satisfy an exists rule.
  assert.deepEqual(detect({ dom: { "#foo-root|text|": "1" } }, corpus), []);
  assert.deepEqual(detect({ dom: {} }, corpus), []);
});

test("dom attribute: pattern runs against the probed value and extracts a version", () => {
  const corpus = compileFingerprints({
    Gen: { cats: [1], dom: { "meta[name=gen]": { attributes: { content: "Gen v([\\d.]+)\\;version:\\1" } } } },
  });
  const hit = detect({ dom: { "meta[name=gen]|attribute|content": "Gen v4.2.1" } }, corpus);
  assert.equal(hit.length, 1);
  assert.equal(hit[0].version, "4.2.1");
  assert.deepEqual(hit[0].matched, [{ group: "dom", hits: ["Gen v([\\d.]+)"] }]);
  assert.deepEqual(detect({ dom: { "meta[name=gen]|attribute|content": "Other 1.0" } }, corpus), []);
});

test("dom text + property rules route to their own patterns", () => {
  const corpus = compileFingerprints({
    TextTech: { cats: [1], dom: { footer: { text: "built with texttech" } } },
    PropTech: { cats: [1], dom: { "#app": { properties: { __vue__: "" } } } },
  });
  const hits = detect({
    dom: {
      "footer|text|": "Site Built With TextTech",     // case-insensitive regex
      "#app|property|__vue__": "[object Object]",
    },
  }, corpus);
  assert.deepEqual(names(hits), ["PropTech", "TextTech"]);
});

test("dom: confidence from several matching rules sums and caps at 100", () => {
  const corpus = compileFingerprints({
    T: {
      cats: [1],
      dom: {
        ".a": { text: "x\\;confidence:30" },
        ".b": { attributes: { id: "y\\;confidence:30" } },
      },
      html: "z\\;confidence:25",
    },
  });
  // dom group contributes max(30,30)=30 once, html 25 → 55 (groups add, hits within a group don't).
  const [hit] = detect({ html: "z", dom: { ".a|text|": "x", ".b|attribute|id": "y" } }, corpus);
  assert.equal(hit.confidence, 55);
  const [capped] = detect({ html: "z", dom: { ".a|text|": "x" }, url: "u" },
    compileFingerprints({ T: { dom: { ".a": { text: "x\\;confidence:90" } }, html: "z\\;confidence:90" } }));
  assert.equal(capped.confidence, 100);
});

test("text group: matches rendered innerText, not raw html", () => {
  const corpus = compileFingerprints({ T: { cats: [1], text: "copyright acme" } });
  assert.equal(detect({ text: "© Copyright ACME Corp" }, corpus).length, 1);
  assert.deepEqual(detect({ html: "<p>copyright acme</p>" }, corpus), []);
});

// ─── scrapeSignals ─────────────────────────────────────────────────
test("scrapeSignals: html, text, script srcs and url come straight from the page", () => {
  const s = withPage({
    html: "<html><body>hi</body></html>",
    text: "hi",
    scripts: ["https://cdn.example.com/a.js", "", "https://x.example/b.js"],
    href: "https://shop.example.com/p/1",
  }, () => scrapeSignals([], []));
  assert.equal(s.html, "<html><body>hi</body></html>");
  assert.equal(s.text, "hi");
  assert.deepEqual(s.scripts, ["https://cdn.example.com/a.js", "https://x.example/b.js"], "empty src dropped");
  assert.equal(s.url, "https://shop.example.com/p/1");
});

test("scrapeSignals: missing documentElement/body degrade to empty strings", () => {
  const s = withPage({ html: null, text: null }, () => scrapeSignals(undefined, undefined));
  assert.equal(s.html, "");
  assert.equal(s.text, "");
  assert.deepEqual(s.jsGlobals, {});
  assert.deepEqual(s.dom, {});
});

test("scrapeSignals: meta keys come from name/property/http-equiv, lowercased; keyless metas skipped", () => {
  const s = withPage({
    metas: [
      { name: "Generator", content: "WordPress 6.4" },
      { property: "og:site_name", content: "Shop" },
      { "http-equiv": "X-UA-Compatible", content: "IE=edge" },
      { name: "robots" },                                  // no content → ""
      { content: "orphan" },                               // no key → skipped
    ],
  }, () => scrapeSignals([], []));
  assert.deepEqual(s.meta, {
    generator: "WordPress 6.4",
    "og:site_name": "Shop",
    "x-ua-compatible": "IE=edge",
    robots: "",
  });
});

test("scrapeSignals: cookie values keep '=' after the first one; pairs without '=' are skipped", () => {
  const s = withPage({ cookie: "a=1; token=x=y==; flag; b=" }, () => scrapeSignals([], []));
  assert.deepEqual(s.cookies, { a: "1", token: "x=y==", b: "" });
});

test("REGRESSION: scraped cookie names keep their case so mixed-case fingerprints match", () => {
  // compileFingerprints keeps cookie keys case-sensitive (RFC 6265) and the
  // bundled corpus spells them as servers send them (PHPSESSID, JSESSIONID,
  // ASP.NET_SessionId). If the probe lowercases names, none of those can match.
  const corpus = compileFingerprints({
    PHP: { cats: [27], cookies: { PHPSESSID: "" } },
    Java: { cats: [27], cookies: { JSESSIONID: "" } },
    "Microsoft ASP.NET": { cats: [18], cookies: { "ASP.NET_SessionId": "" } },
  });
  const signals = withPage(
    { cookie: "PHPSESSID=abc; JSESSIONID=def; ASP.NET_SessionId=ghi" },
    () => scrapeSignals([], []),
  );
  assert.deepEqual(Object.keys(signals.cookies), ["PHPSESSID", "JSESSIONID", "ASP.NET_SessionId"]);
  assert.deepEqual(names(detect(signals, corpus)), ["Java", "Microsoft ASP.NET", "PHP"]);
});

test("scrapeSignals: js lookups walk dot and bracket paths and stringify leaves", () => {
  const win = {
    React: { version: "18.2.0" },
    __core: { "core-js": { version: "3.33.0" } },
    arr: [{ id: "first" }],
    q: { "x-y": { z: 7 } },
    zero: 0,
    no: false,
    empty: "",
    obj: { a: 1 },
    nil: null,
  };
  const s = withPage({ window: win }, () => scrapeSignals([
    "React.version",
    '__core["core-js"].version',
    "arr[0].id",
    "q['x-y'].z",
    "zero", "no", "empty",
    "obj",
    "nil", "missing.deep.path",
  ], []));
  assert.deepEqual(s.jsGlobals, {
    "React.version": "18.2.0",
    '__core["core-js"].version': "3.33.0",
    "arr[0].id": "first",
    "q['x-y'].z": "7",
    zero: "0",
    no: "false",
    empty: "",
    obj: "[object]",
  });
});

test("scrapeSignals: a throwing getter on one js path doesn't abort the others", () => {
  const win = { ok: "1" };
  Object.defineProperty(win, "trap", { get() { throw new Error("denied"); } });
  const s = withPage({ window: win }, () => scrapeSignals(["trap.x", "ok"], []));
  assert.deepEqual(s.jsGlobals, { ok: "1" });
});

test("scrapeSignals: dom probes emit one value per rule key, skipping absent and invalid selectors", () => {
  const props = { __vue__: { a: 1 }, nothing: null };
  Object.defineProperty(props, "boom", { get() { throw new Error("cross-origin"); }, enumerable: true });
  const s = withPage({
    elements: {
      "#root": el(),
      "footer": el({ text: "Powered by Acme" }),
      "meta[name=gen]": el({ attrs: { content: "Gen 2" } }),
      "#app": el({ props }),
      "a[bad": "throw",
    },
  }, () => scrapeSignals([], [
    { selector: "#root", kind: "exists" },
    { selector: "#absent", kind: "exists" },
    { selector: "a[bad", kind: "exists" },                   // querySelector throws
    { selector: "footer", kind: "text" },
    { selector: "#absent", kind: "text" },
    { selector: "meta[name=gen]", kind: "attribute", attr: "content" },
    { selector: "meta[name=gen]", kind: "attribute", attr: "missing" },
    { selector: "#app", kind: "property", prop: "__vue__" },
    { selector: "#app", kind: "property", prop: "nothing" },
    { selector: "#app", kind: "property", prop: "boom" },
    { selector: "   ", kind: "exists" },                     // blank → skipped
  ]));
  assert.deepEqual(s.dom, {
    "#root|exists|": "1",
    "footer|text|": "Powered by Acme",
    "meta[name=gen]|attribute|content": "Gen 2",
    "meta[name=gen]|attribute|missing": "",
    "#app|property|__vue__": "[object Object]",
    "#app|property|nothing": "",
    "#app|property|boom": "",
  });
});

test("REGRESSION: dom selectors with stray whitespace still match after scrape -> detect", () => {
  // The bundled corpus has selectors like " body[data-aos-easing]" and
  // "div.footer > div.floatRight ". scrapeSignals keys its results by the
  // trimmed selector, so the compiled rule must carry the trimmed form too.
  const corpus = compileFingerprints({
    AOS: { cats: [1], dom: " body[data-aos-easing]" },
    Footer: { cats: [1], dom: { "div.footer > div.floatRight ": { text: "acme" } } },
  });
  const rules = corpus.flatMap((r) => r.dom);
  const signals = withPage({
    elements: {
      "body[data-aos-easing]": el(),
      "div.footer > div.floatRight": el({ text: "ACME inc" }),
    },
  }, () => scrapeSignals([], rules));
  assert.deepEqual(names(detect(signals, corpus)), ["AOS", "Footer"]);
});
