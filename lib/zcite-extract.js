// Page → CSL-JSON metadata extractor for the "Save to zcite" web connector.
//
// Runs in the active tab via chrome.scripting.executeScript({ func: extractCslFromPage }).
// It is deliberately self-contained — it closes over nothing outside its own body and
// touches only `document` / `location` — so Chrome can serialize it into the page. The
// returned object is CSL-JSON, which zcite imports verbatim (the host writes it to zcite's
// inbox; zcite's `inbox.import` drains it).
//
// Sources, in priority order: Highwire Press `citation_*` <meta> tags (the academic
// standard, emitted by publishers, Google Scholar, arXiv, PubMed, etc.), Dublin Core
// `DC.*`, Open Graph, and schema.org JSON-LD as a fallback for `@type` Article/Book.

export function extractCslFromPage() {
  // All <meta> contents for a name/property (case-insensitive), in document order.
  const metas = (name) =>
    Array.from(
      document.querySelectorAll(`meta[name="${name}" i], meta[property="${name}" i]`)
    )
      .map((m) => (m.getAttribute("content") || "").trim())
      .filter(Boolean);
  const meta1 = (name) => metas(name)[0] || "";

  // "Last, First" or "First Last" or institutional → a CSL name object.
  const parseName = (raw) => {
    raw = String(raw || "").trim();
    if (!raw) return null;
    if (raw.includes(",")) {
      const [family, given] = raw.split(",");
      return { family: family.trim(), given: (given || "").trim() };
    }
    const parts = raw.split(/\s+/);
    if (parts.length === 1) return { literal: raw };
    const family = parts.pop();
    return { family, given: parts.join(" ") };
  };

  const out = {};
  const journal = meta1("citation_journal_title");
  const bookTitle = meta1("citation_book_title") || meta1("citation_inbook_title");
  const isbn = meta1("citation_isbn");

  // Title from meta tags only here; the document.title fallback is applied at the very end
  // so a JSON-LD headline can still win when no citation/og/dc title is present.
  out.title = meta1("citation_title") || meta1("og:title") || meta1("dc.title") || "";

  const authors = metas("citation_author")
    .concat(metas("dc.creator"))
    .map(parseName)
    .filter(Boolean);
  if (authors.length) out.author = authors;

  const container = journal || meta1("citation_conference_title") || bookTitle;
  if (container) out["container-title"] = container;

  const vol = meta1("citation_volume");
  if (vol) out.volume = vol;
  const issue = meta1("citation_issue");
  if (issue) out.issue = issue;
  const fp = meta1("citation_firstpage");
  const lp = meta1("citation_lastpage");
  if (fp) out.page = lp ? `${fp}-${lp}` : fp;

  const date =
    meta1("citation_date") ||
    meta1("citation_publication_date") ||
    meta1("citation_online_date") ||
    meta1("citation_year") ||
    meta1("dc.date");
  const dm = String(date).match(/(\d{4})(?:[-/](\d{1,2}))?(?:[-/](\d{1,2}))?/);
  if (dm) {
    const parts = [parseInt(dm[1], 10)];
    if (dm[2]) parts.push(parseInt(dm[2], 10));
    if (dm[3]) parts.push(parseInt(dm[3], 10));
    out.issued = { "date-parts": [parts] };
  }

  const doiRaw = meta1("citation_doi") || meta1("dc.identifier");
  const doi = String(doiRaw).replace(/^doi:/i, "").trim();
  if (/^10\.\d/.test(doi)) out.DOI = doi;
  if (isbn) out.ISBN = isbn.replace(/[^0-9Xx]/g, "");
  const issn = meta1("citation_issn");
  if (issn) out.ISSN = issn;

  const publisher = meta1("citation_publisher") || meta1("dc.publisher");
  if (publisher) out.publisher = publisher;
  const abs = meta1("citation_abstract") || meta1("description") || meta1("og:description");
  if (abs) out.abstract = abs;

  const canonical = document.querySelector('link[rel="canonical"]');
  out.URL = (canonical && canonical.href) || location.href;

  // Item type: the citation_* tags are the strongest signal.
  if (journal) out.type = "article-journal";
  else if (bookTitle) out.type = "chapter";
  else if (isbn) out.type = "book";

  // schema.org JSON-LD fallback fills title/author/date/type when meta tags are absent.
  if (!out.type || !out.author) {
    try {
      const blocks = Array.from(
        document.querySelectorAll('script[type="application/ld+json"]')
      );
      for (const b of blocks) {
        let data;
        try {
          data = JSON.parse(b.textContent);
        } catch (e) {
          continue;
        }
        const nodes = Array.isArray(data) ? data : data["@graph"] || [data];
        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;
          const t = node["@type"];
          const types = Array.isArray(t) ? t : [t];
          const typeStr = types.map(String).join(" ");
          if (!/Article|ScholarlyArticle|Report|Book|Thesis|Chapter/i.test(typeStr)) continue;
          if (!out.title && (node.headline || node.name)) out.title = node.headline || node.name;
          if (!out.author && node.author) {
            const al = Array.isArray(node.author) ? node.author : [node.author];
            const mapped = al
              .map((a) => parseName(typeof a === "string" ? a : a && a.name))
              .filter(Boolean);
            if (mapped.length) out.author = mapped;
          }
          if (!out.issued && node.datePublished) {
            const m = String(node.datePublished).match(/(\d{4})/);
            if (m) out.issued = { "date-parts": [[parseInt(m[1], 10)]] };
          }
          if (!out.type) out.type = /Book/i.test(typeStr) ? "book" : "article-journal";
        }
      }
    } catch (e) {
      /* malformed JSON-LD → ignore, fall through to defaults */
    }
  }

  if (!out.type) out.type = "webpage";
  if (!out.title) out.title = document.title || location.href;
  return out;
}
