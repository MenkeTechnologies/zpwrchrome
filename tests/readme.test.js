// README must follow the strykelang structural template:
// banner code block → badge block → tagline → epigraph blockquotes →
// hex-indexed TOC → hex-indexed sections → [0xFF] LICENSE → ASCII footer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const README = readFileSync(join(ROOT, "README.md"), "utf8");

test("README opens with an ASCII banner code fence", () => {
  assert.match(README, /^```\n[ \S]*?ZPWRCHROME|^```\n[ \S]*?_|^```\n/,
    "README must start with a triple-backtick code fence");
  // First non-fence line of the banner must contain ASCII-art glyph chars.
  const lines = README.split("\n");
  assert.equal(lines[0], "```", "first line must be ```");
  const banner = lines.slice(1).join("\n").slice(0, 800);
  assert.match(banner, /[_\\/|]/, "ASCII banner must include slashes / underscores");
});

test("README has a CI badge pointing at .github/workflows/ci.yml", () => {
  assert.match(README, /\!\[CI\]\(https:\/\/github\.com\/MenkeTechnologies\/zpwrchrome\/actions\/workflows\/ci\.yml\/badge\.svg\)/);
});

test("README has an MIT license badge", () => {
  assert.match(README, /\!\[License: MIT\]/);
});

test("README has the strykelang-style backticked tagline header", () => {
  assert.match(README, /^### `\[[A-Z][^`]+\]`/m,
    "expected `### \\`[CAPS TAGLINE]\\`` header (strykelang house style)");
});

test("README has epigraph blockquotes after the tagline", () => {
  // Post-rebrand collapsed the three "MRU is a primitive" / "Recent Tabs
  // with one shortcut" epigraphs into two broader claims naming the four
  // capability surfaces. Pin ≥1 so the structure stays, but tolerate fewer.
  const quotes = README.match(/^>\s+\*"[^"]+"\*/gm) || [];
  assert.ok(quotes.length >= 1, `expected ≥1 epigraph blockquote, got ${quotes.length}`);
});

test("README has a Table of Contents block with hex-indexed entries", () => {
  assert.match(README, /^## Table of Contents$/m);
  assert.match(README, /\[\\\[0x00\\\] Overview\]\(#0x00-overview\)/);
  assert.match(README, /\[\\\[0xFF\\\] License\]\(#0xff-license\)/);
});

test("README has hex-indexed section headers from 0x00 through 0xFF", () => {
  // Spot-check the load-bearing ones.
  for (const h of ["[0x00] OVERVIEW", "[0x01] INSTALL", "[0x02] KEYBOARD COMMANDS", "[0xFF] LICENSE"]) {
    assert.ok(README.includes(`## ${h}`), `missing hex-indexed section: ## ${h}`);
  }
});

test("hex-indexed sections are uppercase (strykelang convention)", () => {
  const sections = README.match(/^## \[0x[0-9A-Fa-f]+\] .+$/gm) || [];
  assert.ok(sections.length >= 6, `expected ≥6 hex sections, got ${sections.length}`);
  for (const s of sections) {
    const title = s.replace(/^## \[0x[0-9A-Fa-f]+\] /, "");
    assert.equal(title, title.toUpperCase(),
      `hex section title not uppercase: "${s}"`);
  }
});

test("README ends with the strykelang-style footer block", () => {
  assert.match(README, /^##### created by \[MenkeTechnologies\]/m);
  assert.match(README, /TRACK MRU\. SWITCH FAST\./);
});

test("README capability surface names each load-bearing tool", () => {
  // Post-rebrand: zpwrchrome is four tools in one. The capability table
  // must name `pass`, the download manager, the tab switcher, history
  // search, and the userscript engine — those are the load-bearing claims.
  assert.match(README, /UNIX `pass` integration/);
  assert.match(README, /[Ss]egmented multi-connection download/);
  assert.match(README, /tab switcher/i);
  assert.match(README, /[Ff]zf history search/);
  assert.match(README, /userscript/i);
});

test("README banner ASCII lines have consistent width", () => {
  // Banner is the first triple-backtick code block; its non-fence lines must
  // all be the same visual width or the box looks broken on GitHub.
  const m = README.match(/^```\n([\s\S]*?)\n```/);
  assert.ok(m, "no opening code fence found");
  const lines = m[1].split("\n").filter((l) => l.trim().length > 0);
  const widths = lines.map((l) => l.length);
  const max = Math.max(...widths);
  const min = Math.min(...widths);
  // Allow ±1 char (trailing-space normalization).
  assert.ok(max - min <= 1,
    `banner widths drift: min=${min} max=${max}\n` + lines.map((l, i) => `${i}:${widths[i]}: |${l}|`).join("\n"));
});
