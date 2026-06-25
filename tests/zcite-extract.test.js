// Functional tests for the page → CSL-JSON extractor used by "Save to zcite".
// A minimal document/location shim stands in for the page DOM (no jsdom).

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCslFromPage } from "../lib/zcite-extract.js";

function makeDoc({ metas = [], jsonld = [], title = "", canonical = "" }) {
  return {
    title,
    querySelectorAll(sel) {
      if (sel.includes("application/ld+json")) {
        return jsonld.map((o) => ({
          textContent: typeof o === "string" ? o : JSON.stringify(o),
        }));
      }
      const m = sel.match(/name="([^"]+)"/i);
      const name = m ? m[1].toLowerCase() : null;
      if (!name) return [];
      return metas
        .filter((x) => String(x.name || x.property || "").toLowerCase() === name)
        .map((x) => ({ getAttribute: () => x.content }));
    },
    querySelector(sel) {
      if (sel.includes('rel="canonical"')) return canonical ? { href: canonical } : null;
      return null;
    },
  };
}

function withDom(spec, fn) {
  const prevDoc = global.document;
  const prevLoc = global.location;
  global.document = makeDoc(spec);
  global.location = { href: spec.href || "https://example.com/page" };
  try {
    return fn();
  } finally {
    global.document = prevDoc;
    global.location = prevLoc;
  }
}

test("extracts a journal article from citation_* meta tags", () => {
  const csl = withDom(
    {
      title: "Tab title",
      metas: [
        { name: "citation_title", content: "Attention Is All You Need" },
        { name: "citation_author", content: "Vaswani, Ashish" },
        { name: "citation_author", content: "Shazeer, Noam" },
        { name: "citation_journal_title", content: "NeurIPS" },
        { name: "citation_volume", content: "30" },
        { name: "citation_firstpage", content: "5998" },
        { name: "citation_lastpage", content: "6008" },
        { name: "citation_date", content: "2017/06/12" },
        { name: "citation_doi", content: "10.5555/abc" },
      ],
    },
    extractCslFromPage
  );
  assert.equal(csl.type, "article-journal");
  assert.equal(csl.title, "Attention Is All You Need");
  assert.equal(csl["container-title"], "NeurIPS");
  assert.equal(csl.volume, "30");
  assert.equal(csl.page, "5998-6008");
  assert.deepEqual(csl.issued, { "date-parts": [[2017, 6, 12]] });
  assert.equal(csl.DOI, "10.5555/abc");
  assert.equal(csl.author.length, 2);
  assert.equal(csl.author[0].family, "Vaswani");
  assert.equal(csl.author[0].given, "Ashish");
  assert.equal(csl.author[1].family, "Shazeer");
});

test("falls back to JSON-LD for article type + authors + date", () => {
  const csl = withDom(
    {
      title: "Some News",
      jsonld: [
        {
          "@type": "NewsArticle",
          headline: "Big Story",
          author: { name: "Jane Roe" },
          datePublished: "2023-04-01",
        },
      ],
    },
    extractCslFromPage
  );
  assert.equal(csl.type, "article-journal");
  assert.equal(csl.title, "Big Story");
  assert.equal(csl.author[0].family, "Roe");
  assert.equal(csl.author[0].given, "Jane");
  assert.deepEqual(csl.issued, { "date-parts": [[2023]] });
});

test("classifies a book via ISBN and normalizes it", () => {
  const csl = withDom(
    {
      metas: [
        { name: "citation_title", content: "SICP" },
        { name: "citation_isbn", content: "0-262-01153-0" },
      ],
    },
    extractCslFromPage
  );
  assert.equal(csl.type, "book");
  assert.equal(csl.ISBN, "0262011530");
});

test("defaults to webpage with the tab title + URL when no metadata", () => {
  const csl = withDom({ title: "Just A Page", href: "https://x.test/y" }, extractCslFromPage);
  assert.equal(csl.type, "webpage");
  assert.equal(csl.title, "Just A Page");
  assert.equal(csl.URL, "https://x.test/y");
});

test("a non-DOI citation_doi is dropped (only 10.x DOIs kept)", () => {
  const csl = withDom(
    { metas: [{ name: "citation_title", content: "T" }, { name: "citation_doi", content: "not-a-doi" }] },
    extractCslFromPage
  );
  assert.equal(csl.DOI, undefined);
});
