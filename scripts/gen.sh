#!/usr/bin/env bash
# Regenerate README.md and docs/index.html from manifest.json so neither
# document can drift out of sync with the command registry.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ZPWR_ROOT="$ROOT" node "$ROOT/scripts/gen.mjs"
echo "wrote $ROOT/README.md + $ROOT/docs/index.html" >&2
