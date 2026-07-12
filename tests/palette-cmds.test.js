// Pins the SHARED command-palette item source (lib/palette-cmds.js). The same
// file is vendored verbatim into hud-internal + newtab, so a drift here silently
// desyncs the ⌘K palette across all three surfaces. Backend-agnostic (no chrome.*),
// so it runs in plain Node by binding `this` to a fake global for the UMD wrapper.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "lib", "palette-cmds.js"), "utf8");

function loadPaletteCmds() {
  // The file ends with `})(typeof window !== 'undefined' ? window : this)`.
  // `window` is undefined in Node, so it falls back to `this` — bind it to a
  // fresh object and read the export back off it.
  const root = {};
  // eslint-disable-next-line no-new-func
  new Function(src).call(root);
  return root.ZWIRE_PALETTE_CMDS;
}

const ZPWR_ID = "hpppdchpnphmiijdeanibpcadgknmaja";
const EXPECTED_PAGES = [
  "dashboard.html", "downloads.html", "manager.html", "pass.html", "host.html",
  "find-all.html", "reader-mode.html", "lights-off.html", "theme-injector.html",
  "modheader.html", "ua-switcher.html", "dl-settings.html", "dl-rules.html",
  "dl-extfilter.html", "dl-postcommands.html", "dl-interface.html",
  "dl-diag.html", "dl-help.html", "dl-about.html",
];

test("palette-cmds exposes zpwrchrome's fixed extension id", () => {
  const PC = loadPaletteCmds();
  assert.equal(PC.ZPWR_ID, ZPWR_ID);
});

test("makeZpwrItems builds one row per zpwrchrome page with absolute scripts-manager URLs", () => {
  const PC = loadPaletteCmds();
  const opened = [];
  const rows = PC.makeZpwrItems((url) => opened.push(url));
  assert.equal(rows.length, EXPECTED_PAGES.length, "row count must match the page list");

  const pagesSeen = new Set();
  for (const row of rows) {
    assert.ok(row.label.startsWith("zpwrchrome: "), `row label should be namespaced: ${row.label}`);
    assert.equal(typeof row.run, "function");
    pagesSeen.add(row.detail); // detail carries the bare page filename
  }
  for (const page of EXPECTED_PAGES) {
    assert.ok(pagesSeen.has(page), `missing palette row for ${page}`);
  }

  // run() must open the absolute cross-extension URL, not the bare filename —
  // this is what lets the HUD / New Tab palettes reach zpwrchrome's pages.
  rows[0].run();
  assert.equal(opened.length, 1);
  assert.equal(opened[0], `chrome-extension://${ZPWR_ID}/scripts-manager/dashboard.html`);
});

test("host console is reachable from the shared palette", () => {
  const PC = loadPaletteCmds();
  const rows = PC.makeZpwrItems(() => {});
  const host = rows.find((r) => r.detail === "host.html");
  assert.ok(host, "the palette must offer the Host Console");
  assert.equal(host.label, "zpwrchrome: Host Console");
});
