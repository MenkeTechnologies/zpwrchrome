// Pure XML formatter helpers — cheap auto-detect, content-type test,
// regex-driven pretty-print + tag counting, XPath formatting. Returns
// plain strings/numbers so the caller can wire DOMParser-driven render
// however it likes. Testable in Node without a DOM.

// looksLikeXml(raw) → boolean. Cheap pre-check for the content-script
// auto-detector: must start (after whitespace) with `<` and look like an
// element or declaration. Avoids the cost of `new DOMParser().parseFromString`
// on every page.
export function looksLikeXml(raw) {
  const s = String(raw || "").trimStart();
  if (!s) return false;
  if (s[0] !== "<") return false;
  // Reject HTML — content scripts already auto-handle that. We accept
  // `<?xml`, generic `<elem...>`, and SVG-like roots.
  if (/^<!DOCTYPE\s+html/i.test(s)) return false;
  if (/^<html[\s>]/i.test(s)) return false;
  // Element name per the XML spec: NameStartChar = letter / _ / `:`,
  // followed by NameChar = letter / digit / `.-_:`. Tags with leading
  // dashes (`<-foo>`) and pure-numeric names aren't legal XML.
  return /^<(\?xml\b|!--|!\[CDATA\[|!DOCTYPE\s|[A-Za-z_])/.test(s);
}

// isXmlContentType(ctype) → boolean. Matches the common XML MIME
// signatures: application/xml, text/xml, application/atom+xml,
// application/rss+xml, application/xhtml+xml, image/svg+xml,
// application/<vendor>+xml. Case-insensitive.
export function isXmlContentType(ctype) {
  const c = String(ctype || "").toLowerCase();
  if (!c) return false;
  if (c.includes("application/xml")) return true;
  if (c.includes("text/xml"))        return true;
  // `+xml` covers atom, rss, xhtml, svg, soap, plist, vendor types.
  if (/\+xml\b/.test(c))             return true;
  return false;
}

// hasXmlExtension(path) → boolean. URL-path heuristic for cases where
// the server didn't set Content-Type correctly. Strips query string.
export function hasXmlExtension(path) {
  const p = String(path || "").split(/[?#]/)[0].toLowerCase();
  return /\.(xml|xsd|xsl|xslt|rss|atom|svg|plist|kml|gpx|opml|fxml)$/.test(p);
}

// ─── Pretty-print ─────────────────────────────────────────────────
// State-machine re-indenter for ALREADY-VALID XML. Walks the input
// string once, tracking tag depth, emitting one line per element open /
// close / self-close / text segment. No DOM needed. Comments, CDATA,
// and processing instructions are preserved verbatim (no internal
// reformat). Indent is `indent` spaces per level.
export function prettyPrint(raw, indent = 2) {
  const src = String(raw || "");
  if (!src.trim()) return "";
  const pad = " ".repeat(Math.max(0, indent));
  const out = [];
  let depth = 0;
  let i = 0;
  // Skip BOM if present.
  if (src.charCodeAt(0) === 0xFEFF) i = 1;
  const N = src.length;
  // Push a line with the current indent.
  const push = (s) => out.push(pad.repeat(depth) + s);

  while (i < N) {
    // Eat inter-tag whitespace; significant text is captured below.
    while (i < N && /\s/.test(src[i])) i++;
    if (i >= N) break;
    if (src[i] !== "<") {
      // Mixed-content text node — capture until next `<`. Trim it so
      // surrounding whitespace from the source doesn't widow the line.
      const start = i;
      while (i < N && src[i] !== "<") i++;
      const text = src.slice(start, i).replace(/\s+/g, " ").trim();
      if (text) push(escapeXmlText(decodeEntities(text)));
      continue;
    }
    // We're at `<`. Identify the tag kind.
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      const stop = end < 0 ? N : end + 3;
      push(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i + 9);
      const stop = end < 0 ? N : end + 3;
      push(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (src.startsWith("<?", i)) {
      const end = src.indexOf("?>", i + 2);
      const stop = end < 0 ? N : end + 2;
      push(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (src.startsWith("<!", i)) {
      // <!DOCTYPE …> — eat until matching `>` (no nested `[…]` support;
      // the rare DTD-with-internal-subset case falls back to verbatim).
      const end = src.indexOf(">", i + 2);
      const stop = end < 0 ? N : end + 1;
      push(src.slice(i, stop));
      i = stop;
      continue;
    }
    // Element open / close / self-close.
    const close = src.indexOf(">", i + 1);
    if (close < 0) {
      // Unterminated — bail to verbatim.
      push(src.slice(i));
      i = N;
      continue;
    }
    const tag = src.slice(i, close + 1);
    i = close + 1;
    const isClose      = tag[1] === "/";
    const isSelfClose  = tag.endsWith("/>");
    if (isClose) {
      depth = Math.max(0, depth - 1);
      push(tag);
      continue;
    }
    if (isSelfClose) {
      push(tag);
      continue;
    }
    // Open tag. Peek ahead: if the very next thing is a `</name>` with
    // matching name, render as `<name>text</name>` on one line. This
    // keeps short leaf elements compact.
    const name = openTagName(tag);
    if (name) {
      let j = i;
      while (j < N && /\s/.test(src[j])) j++;
      if (src[j] !== "<") {
        // Text content first. Capture until the closing tag of this name.
        const textStart = j;
        while (j < N && src[j] !== "<") j++;
        const closer = `</${name}>`;
        if (src.startsWith(closer, j)) {
          const text = src.slice(textStart, j).replace(/\s+/g, " ").trim();
          push(tag + escapeXmlText(decodeEntities(text)) + closer);
          i = j + closer.length;
          continue;
        }
      } else {
        // No text; check for immediate close like `<a></a>`.
        const closer = `</${name}>`;
        if (src.startsWith(closer, j)) {
          push(tag + closer);
          i = j + closer.length;
          continue;
        }
      }
    }
    push(tag);
    depth++;
  }
  return out.join("\n");
}

// minify(raw) — strip inter-tag whitespace. Preserves CDATA / comments /
// PI verbatim. Mirrors prettyPrint's pairing with the toolbar's "minify
// copy" button.
export function minify(raw) {
  const src = String(raw || "");
  let out = "";
  let i = 0;
  const N = src.length;
  while (i < N) {
    if (src[i] === "<") {
      if (src.startsWith("<!--", i)) {
        const end = src.indexOf("-->", i + 4);
        const stop = end < 0 ? N : end + 3;
        out += src.slice(i, stop);
        i = stop;
        continue;
      }
      if (src.startsWith("<![CDATA[", i)) {
        const end = src.indexOf("]]>", i + 9);
        const stop = end < 0 ? N : end + 3;
        out += src.slice(i, stop);
        i = stop;
        continue;
      }
      const close = src.indexOf(">", i + 1);
      const stop = close < 0 ? N : close + 1;
      out += src.slice(i, stop);
      i = stop;
      continue;
    }
    // Inter-tag text — collapse whitespace, drop pure-whitespace runs.
    const start = i;
    while (i < N && src[i] !== "<") i++;
    const text = src.slice(start, i).replace(/\s+/g, " ");
    if (text.trim()) out += text;
  }
  return out;
}

// countTags(raw) → integer. Open + self-close + close tag count.
// Useful for the "X nodes" header line. Single regex pass.
export function countTags(raw) {
  const src = String(raw || "");
  let n = 0;
  // Count `<tag>` / `<tag/>` / `</tag>`. Skip `<!--…-->`, `<![CDATA[…]]>`,
  // `<?xml…?>` which aren't elements.
  // Simpler than a full lexer: count `<` not followed by `?` / `!` / `/`,
  // and count `</`.
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "<") continue;
    const next = src[i + 1];
    if (next === "?" || next === "!") {
      // Skip past the special block to avoid double-counting nested `<`s.
      if (src.startsWith("<!--", i))        { const e = src.indexOf("-->", i + 4); i = e < 0 ? src.length : e + 2; continue; }
      if (src.startsWith("<![CDATA[", i))   { const e = src.indexOf("]]>", i + 9); i = e < 0 ? src.length : e + 2; continue; }
      const e = src.indexOf(">", i + 1);    i = e < 0 ? src.length : e;
      continue;
    }
    if (next === "/") { n++; continue; }
    n++;
  }
  return n;
}

// xmlByteSize(raw) — UTF-8 byte length. Matches json-format's jsonByteSize.
export function xmlByteSize(raw) {
  return new TextEncoder().encode(String(raw || "")).length;
}

// formatXPath(path) → 1-based XPath string for the addressed node.
// Segments: [{name, index}, …] where `index` is the 1-based position
// among siblings sharing the same name. Root-relative.
//   [{name:"feed", index:1}, {name:"entry", index:3}] → "/feed[1]/entry[3]"
export function formatXPath(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return "/";
  return "/" + segments
    .map((s) => {
      const n = String(s.name || "*");
      const i = Number.isFinite(s.index) && s.index > 0 ? s.index : 1;
      return `${n}[${i}]`;
    })
    .join("/");
}

// ─── Internal helpers ─────────────────────────────────────────────
function openTagName(tag) {
  // `<name attr=…>` → "name". Returns null if the tag has no usable name.
  const m = /^<([^\s/>]+)/.exec(tag);
  return m ? m[1] : null;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g,           (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g,  "&");
}

function escapeXmlText(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
