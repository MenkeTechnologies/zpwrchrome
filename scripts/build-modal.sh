#!/usr/bin/env bash
# Materialize modal/content.js by inlining the woff2 fonts as base64 into
# modal/content.template.js's %%STM%% and %%ORB%% markers. CSP-safe fonts.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ZPWR_ROOT="$ROOT" node "$ROOT/scripts/build-modal.mjs"
echo "wrote $ROOT/modal/content.js" >&2
