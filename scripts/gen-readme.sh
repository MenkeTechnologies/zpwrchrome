#!/usr/bin/env bash
# Regenerate README.md command table from manifest.json so the docs cannot drift.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/manifest.json"
README="$ROOT/README.md"

ZPWR_ROOT="$ROOT" node - <<'EOF' > "$README"
const fs = require("fs");
const path = require("path");
const root = process.env.ZPWR_ROOT;
const m = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const cmds = Object.entries(m.commands);
const total = cmds.length;
const withKey = cmds.filter(([, v]) => v.suggested_key);

const row = ([name, v]) => {
  const k = v.suggested_key?.default || "*(user-set in `chrome://extensions/shortcuts`)*";
  return `| \`${name}\` | ${k} | ${v.description} |`;
};

const out = `# zpwrchrome

Cyberpunk Chrome extension — recent-tabs switcher with ${total} keyboard commands.
Same idea as [Recent Tabs by Jason Savard](https://jasonsavard.com/wiki/Recent_Tabs), but with a much larger keymap and the strykelang HUD aesthetic.

Built by [MenkeTechnologies](https://github.com/MenkeTechnologies). Manifest V3.

## Features

- Most-recently-used (MRU) tab tracking across all windows
- One-keystroke jump back to previous tab (\`Alt+Z\`, matches Recent Tabs)
- Restore most recently closed tab (\`Alt+Shift+T\`)
- Popup with live filter over both open and recently-closed tabs
- \`↑\`/\`↓\`/\`Enter\`/\`Delete\`/\`Esc\` keyboard nav inside the popup
- Window-level batch ops: close-others, close-right, close-duplicates, reload-all, sort-by-URL, group-by-domain
- Single-tab ops: duplicate, pin, mute, detach to new window, bookmark, copy URL, copy Markdown link
- Numeric tab jumps 1-9 (1-8 = nth tab; 9 = last tab)

## Install (unpacked)

1. \`git clone https://github.com/MenkeTechnologies/zpwrchrome.git\`
2. Open \`chrome://extensions\`
3. Enable **Developer mode** (top-right)
4. Click **Load unpacked**, pick the cloned directory
5. Open \`chrome://extensions/shortcuts\` to bind any of the ${total - withKey.length} user-configurable commands

## Keyboard commands

Chrome’s manifest allows at most 4 default-suggested shortcuts. The rest are
bound by the user from \`chrome://extensions/shortcuts\`. **${withKey.length} ship with default keys**,
**${total - withKey.length} are user-configurable**, for **${total} total**.

| Command | Default | Description |
| --- | --- | --- |
${cmds.map(row).join("\n")}

## Files

| Path | Purpose |
| --- | --- |
| \`manifest.json\` | MV3 manifest, command registry |
| \`background.js\` | Service worker: MRU tracker, command dispatcher |
| \`lib/util.js\` | Pure helpers (MRU push/drop/step, hostname parse, jump-index) — unit-testable in node |
| \`popup.html\` / \`popup.css\` / \`popup.js\` | Cyberpunk HUD popup (palette from strykelang \`docs/hud-static.css\`) |
| \`icons/icon.svg\` | Source SVG; PNGs rasterized via \`rsvg-convert\` |
| \`scripts/gen-readme.sh\` | Regenerate this README from \`manifest.json\` |
| \`tests/\` | \`node:test\` suite — static manifest invariants + pure-logic unit tests |
| \`package.json\` | \`npm test\` script |

## Tests

\`\`\`sh
npm test
\`\`\`

The suite runs under stock Node ≥ 20 with no external dependencies. It covers:

- **Static invariants**: manifest validity, ≤4 suggested keys, no macOS/Chrome-reserved
  default shortcuts, command-to-handler coverage in \`background.js\`, every
  manifest-declared file exists with correct PNG dimensions, popup HTML has no
  inline event handlers (MV3 CSP), cyberpunk palette intact, every declared
  permission is actually used, and \`README.md\` matches a fresh
  \`scripts/gen-readme.sh\` run (doc-drift guard).
- **Pure logic**: \`lib/util.js\` helpers — MRU stack behavior, hostname parse,
  numeric tab-jump resolution.

## Regenerating this README

Command list and counts are derived from \`manifest.json\`. To refresh:

\`\`\`sh
scripts/gen-readme.sh
\`\`\`

## License

MIT, MenkeTechnologies.
`;

process.stdout.write(out);
EOF

echo "wrote $README" >&2
