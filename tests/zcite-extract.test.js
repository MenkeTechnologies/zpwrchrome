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

// A corporate author split into given/family renders as garbage in every author-date style:
// "National Research Council (US) Subcommittee on Laboratory Animal Nutrition" became family
// "Nutrition" + given "National Research Council (US) Subcommittee on Laboratory Animal", which
// APA initialised to "Nutrition, N. R. C. (. S. o. L. A." — observed in a real saved library.
test("a corporate author stays a single-field CSL literal name", () => {
  const csl = withDom(
    {
      metas: [
        { name: "citation_title", content: "Nutrient Requirements of the Mouse" },
        {
          name: "citation_author",
          content: "National Research Council (US) Subcommittee on Laboratory Animal Nutrition",
        },
      ],
    },
    extractCslFromPage
  );
  assert.deepEqual(csl.author, [
    { literal: "National Research Council (US) Subcommittee on Laboratory Animal Nutrition" },
  ]);
});

test("organisation keywords and parenthesised qualifiers mark a literal name", () => {
  const cases = [
    "World Health Organization",
    "Mouse Genome Sequencing Consortium",
    "Massachusetts Institute of Technology",
    "Acme Corp",
    "Broad Institute (US)",
  ];
  for (const name of cases) {
    const csl = withDom(
      { metas: [{ name: "citation_author", content: name }] },
      extractCslFromPage
    );
    assert.deepEqual(csl.author, [{ literal: name }], `${name} must stay literal`);
  }
});

test("ordinary personal names are still split into given/family", () => {
  const csl = withDom(
    {
      metas: [
        { name: "citation_author", content: "Jean Louis Guénet" },
        { name: "citation_author", content: "Waterston, Robert H." },
      ],
    },
    extractCslFromPage
  );
  assert.deepEqual(csl.author, [
    { family: "Guénet", given: "Jean Louis" },
    { family: "Waterston", given: "Robert H." },
  ]);
});

// Publishers emit the same author in citation_author and DC.creator; the two lists are unioned,
// so without dedup every author appeared twice (seen on a real Genome Research save).
test("an author repeated across citation_author and DC.creator is listed once", () => {
  const csl = withDom(
    {
      metas: [
        { name: "citation_author", content: "Jean Louis Guénet" },
        { name: "dc.creator", content: "Jean Louis  Guénet" },
        { name: "citation_author", content: "Ada Lovelace" },
      ],
    },
    extractCslFromPage
  );
  assert.equal(csl.author.length, 2, "the duplicate collapsed");
  assert.deepEqual(csl.author[1], { family: "Lovelace", given: "Ada" });
});

// Springer-Nature wraps the article in a WebPage node, so a walker that only looks at the top
// level and @graph skips the JSON-LD entirely.
test("JSON-LD nested under mainEntity is read", () => {
  const csl = withDom(
    {
      jsonld: [
        {
          "@type": "WebPage",
          mainEntity: {
            "@type": "ScholarlyArticle",
            headline: "Initial sequencing and comparative analysis of the mouse genome",
            author: [{ name: "Robert H. Waterston" }],
            datePublished: "2002-12-05",
          },
        },
      ],
    },
    extractCslFromPage
  );
  assert.equal(csl.title, "Initial sequencing and comparative analysis of the mouse genome");
  assert.deepEqual(csl.author, [{ family: "Waterston", given: "Robert H." }]);
  assert.deepEqual(csl.issued, { "date-parts": [[2002]] });
  assert.equal(csl.type, "article-journal");
});
