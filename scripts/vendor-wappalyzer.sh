#!/usr/bin/env bash
# Re-vendor the Wappalyzer fingerprint corpus from HTTPArchive/wappalyzer
# (most actively maintained open-source fork; GPL-3.0).
#
# Output:
#   lib/wappalyzer/data/technologies.json   — merged alphabetical shards
#   lib/wappalyzer/data/categories.json     — category metadata
#   lib/wappalyzer/data/LICENSE-WAPPALYZER  — GPL-3.0 notice
#
# The engine code under lib/wappalyzer/engine.js stays MIT — only the
# data files inherit the upstream GPL-3 license.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap "rm -rf $TMP" EXIT

UPSTREAM="https://github.com/HTTPArchive/wappalyzer.git"

echo "[vendor-wappalyzer] cloning $UPSTREAM"
git clone --depth=1 "$UPSTREAM" "$TMP/wappalyzer" >/dev/null 2>&1

echo "[vendor-wappalyzer] merging alphabetical technology shards"
node -e "
  const fs = require('fs'), path = require('path');
  const dir = '$TMP/wappalyzer/src/technologies';
  const merged = {};
  for (const f of fs.readdirSync(dir).sort()) {
    Object.assign(merged, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  }
  fs.writeFileSync('$ROOT/lib/wappalyzer/data/technologies.json', JSON.stringify(merged));
  console.log('[vendor-wappalyzer] technologies:', Object.keys(merged).length);
"

cp "$TMP/wappalyzer/src/categories.json" "$ROOT/lib/wappalyzer/data/categories.json"
cp "$TMP/wappalyzer/LICENSE"              "$ROOT/lib/wappalyzer/data/LICENSE-WAPPALYZER"

echo "[vendor-wappalyzer] done. Sizes:"
ls -lh "$ROOT/lib/wappalyzer/data/"
