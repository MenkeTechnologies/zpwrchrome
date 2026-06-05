// Unit tests for lib/xml-format.js — cheap auto-detect, content-type +
// extension predicates, single-pass pretty-print / minify, tag counting,
// XPath formatting. Pure-string in/out, no DOM needed.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  looksLikeXml,
  isXmlContentType,
  hasXmlExtension,
  prettyPrint,
  minify,
  countTags,
  xmlByteSize,
  formatXPath,
} from "../lib/xml-format.js";

// ─── looksLikeXml ──────────────────────────────────────────────────
test("looksLikeXml: standard XML declarations + elements", () => {
  for (const s of [
    '<?xml version="1.0"?><root/>',
    "<foo>bar</foo>",
    "<svg xmlns='http://www.w3.org/2000/svg'/>",
    "<!-- prolog comment -->\n<feed/>",
    "<![CDATA[…]]>",
    "<!DOCTYPE foo SYSTEM 'foo.dtd'><foo/>",
  ]) {
    assert.equal(looksLikeXml(s), true, `expected truthy for ${JSON.stringify(s.slice(0, 32))}…`);
  }
});

test("looksLikeXml: leading BOM / whitespace tolerated", () => {
  assert.equal(looksLikeXml("   \n  <root/>"), true);
  assert.equal(looksLikeXml("\r\n<a/>"),       true);
});

test("looksLikeXml: HTML rejected so the JSON viewer's neighbours don't fire", () => {
  assert.equal(looksLikeXml("<!DOCTYPE html><html><body>x</body></html>"), false);
  assert.equal(looksLikeXml("<html lang=en><body/></html>"),                false);
  assert.equal(looksLikeXml("<HTML>"),                                       false);
});

test("looksLikeXml: clearly-not-XML inputs", () => {
  assert.equal(looksLikeXml(""),            false);
  assert.equal(looksLikeXml(null),          false);
  assert.equal(looksLikeXml("hello"),       false);
  assert.equal(looksLikeXml("{}"),          false);
  assert.equal(looksLikeXml("plain text"),  false);
  assert.equal(looksLikeXml("<1>oops"),     false, "tags can't start with a digit");
  assert.equal(looksLikeXml("< foo"),       false, "tags can't start with whitespace");
});

// ─── isXmlContentType ─────────────────────────────────────────────
test("isXmlContentType: every common XML MIME family", () => {
  for (const ct of [
    "application/xml",
    "application/xml; charset=utf-8",
    "TEXT/XML",
    "application/atom+xml",
    "application/rss+xml",
    "application/xhtml+xml; charset=utf-8",
    "image/svg+xml",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet+xml",
    "application/soap+xml",
  ]) {
    assert.equal(isXmlContentType(ct), true, `expected XML CT for ${JSON.stringify(ct)}`);
  }
});

test("isXmlContentType: HTML / JSON / plain text rejected", () => {
  for (const ct of ["", null, "text/html", "application/json", "text/plain", "image/png"]) {
    assert.equal(isXmlContentType(ct), false, `expected non-XML for ${JSON.stringify(ct)}`);
  }
});

// ─── hasXmlExtension ──────────────────────────────────────────────
test("hasXmlExtension: matches the canonical XML extensions", () => {
  for (const p of [
    "/feed.xml", "/data.XML", "/schema.xsd", "/style.xsl", "/transform.xslt",
    "/feed.atom", "/feed.rss", "/logo.svg", "/Info.plist",
    "/route.kml", "/trip.gpx", "/feeds.opml", "/scene.fxml",
  ]) {
    assert.equal(hasXmlExtension(p), true, `expected XML ext for ${JSON.stringify(p)}`);
  }
});

test("hasXmlExtension: ignores query strings and non-XML extensions", () => {
  assert.equal(hasXmlExtension("/feed.xml?cache=1"), true);
  assert.equal(hasXmlExtension("/foo.html"),         false);
  assert.equal(hasXmlExtension("/foo"),              false);
  assert.equal(hasXmlExtension("/foo.json"),         false);
});

// ─── prettyPrint ──────────────────────────────────────────────────
test("prettyPrint: re-indents a one-line XML document", () => {
  const out = prettyPrint("<root><a>1</a><b>2</b></root>");
  assert.equal(out,
    [
      "<root>",
      "  <a>1</a>",
      "  <b>2</b>",
      "</root>",
    ].join("\n"));
});

test("prettyPrint: leaf elements stay compact on one line", () => {
  // The leaf-compaction means `<a>1</a>` doesn't get split across 3 lines.
  const out = prettyPrint("<root><a>1</a></root>");
  assert.equal(out, "<root>\n  <a>1</a>\n</root>");
});

test("prettyPrint: empty elements render as <empty/> at the right indent", () => {
  const out = prettyPrint("<root><a/></root>");
  assert.equal(out, "<root>\n  <a/>\n</root>");
});

test("prettyPrint: preserves PI / DOCTYPE / comments verbatim at their indent", () => {
  const src = '<?xml version="1.0"?><!-- top --><root><!-- inner --><a/></root>';
  const out = prettyPrint(src);
  assert.match(out, /<\?xml version="1\.0"\?>/);
  assert.match(out, /<!-- top -->/);
  assert.match(out, /<!-- inner -->/);
  // Indentation pins
  assert.match(out, /\n  <!-- inner -->/);
  assert.match(out, /\n  <a\/>/);
});

test("prettyPrint: CDATA passes through unchanged (no whitespace mangling)", () => {
  const src = "<root><![CDATA[ keep   spaces ]]></root>";
  const out = prettyPrint(src);
  assert.match(out, /<!\[CDATA\[ keep   spaces \]\]>/);
});

test("prettyPrint: attribute formatting + nested elements + entities", () => {
  const out = prettyPrint('<root><a x="1"><b>x &amp; y</b></a></root>');
  assert.match(out, /<root>/);
  assert.match(out, /<a x="1">/);
  // Text content path round-trips entities → raw → escape.
  assert.match(out, /<b>x &amp; y<\/b>/);
});

test("prettyPrint: BOM is stripped before parsing", () => {
  const out = prettyPrint("﻿<root/>");
  assert.equal(out, "<root/>");
});

test("prettyPrint: empty / whitespace input → empty string", () => {
  assert.equal(prettyPrint(""),      "");
  assert.equal(prettyPrint("   \n"), "");
  assert.equal(prettyPrint(null),    "");
});

// ─── minify ────────────────────────────────────────────────────────
test("minify: drops inter-tag whitespace runs", () => {
  const src = `
    <root>
      <a>1</a>
      <b>2</b>
    </root>`;
  assert.equal(minify(src), "<root><a>1</a><b>2</b></root>");
});

test("minify: keeps content whitespace inside leaf elements", () => {
  // Whitespace inside `<a>` is content, not inter-tag — collapse but keep.
  assert.equal(minify("<root>  <a>  hello world  </a>  </root>"),
    "<root><a> hello world </a></root>");
});

test("minify: comments + CDATA stay verbatim", () => {
  assert.equal(
    minify("<root>  <!--   keep me   -->  <![CDATA[  raw  ]]>  </root>"),
    "<root><!--   keep me   --><![CDATA[  raw  ]]></root>");
});

// ─── countTags ────────────────────────────────────────────────────
test("countTags: counts opens + closes + self-closes; skips PI/comment/CDATA", () => {
  // `<root>` `<a>` `</a>` `<b/>` `</root>` → 5 element-shaped tags.
  // The `<?xml…?>` + comment + CDATA must NOT be counted.
  const src = '<?xml version="1.0"?><!-- header --><root><a>x</a><b/></root><![CDATA[…]]>';
  assert.equal(countTags(src), 5);
});

test("countTags: empty / whitespace input → 0", () => {
  assert.equal(countTags(""),       0);
  assert.equal(countTags(null),     0);
  assert.equal(countTags("   "),    0);
});

// ─── xmlByteSize ──────────────────────────────────────────────────
test("xmlByteSize: UTF-8 byte length, multibyte glyphs counted correctly", () => {
  assert.equal(xmlByteSize("<a/>"),            4);
  assert.equal(xmlByteSize("<a>café</a>"),    12, "é is 2 bytes in UTF-8");
  assert.equal(xmlByteSize(""),                0);
  assert.equal(xmlByteSize(null),              0);
});

// ─── formatXPath ──────────────────────────────────────────────────
test("formatXPath: 1-based XPath with explicit position predicates", () => {
  assert.equal(
    formatXPath([{ name: "feed", index: 1 }, { name: "entry", index: 3 }]),
    "/feed[1]/entry[3]");
  assert.equal(formatXPath([{ name: "a", index: 1 }]), "/a[1]");
});

test("formatXPath: empty / non-array input → '/'", () => {
  assert.equal(formatXPath([]),         "/");
  assert.equal(formatXPath(null),       "/");
  assert.equal(formatXPath(undefined),  "/");
});

test("formatXPath: defaults missing index to 1 instead of [NaN]", () => {
  assert.equal(
    formatXPath([{ name: "root" }, { name: "child", index: 0 }]),
    "/root[1]/child[1]");
});
