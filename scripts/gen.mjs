// Single source of truth for the command list. Emits README.md and
// docs/index.html. Invoked by scripts/gen.sh and exercised in tests.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.env.ZPWR_ROOT;
if (!ROOT) {
  console.error("ZPWR_ROOT not set");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const cmds = Object.entries(manifest.commands);
const total = cmds.length;
const withKey = cmds.filter(([, v]) => v.suggested_key);
const userBound = total - withKey.length;

// ---------------------------------------------------------------------------
// README.md

const mdRow = ([name, v]) => {
  const k = v.suggested_key?.default || "*(user-set in `chrome://extensions/shortcuts`)*";
  return `| \`${name}\` | ${k} | ${v.description} |`;
};

const readme = `# zpwrchrome

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
- Companion Chrome **theme** in [\`theme/\`](theme/) that paints the rest of the browser with the same palette

## Install (unpacked)

1. \`git clone https://github.com/MenkeTechnologies/zpwrchrome.git\`
2. Open \`chrome://extensions\`
3. Enable **Developer mode** (top-right)
4. Click **Load unpacked**, pick the cloned directory
5. Open \`chrome://extensions/shortcuts\` to bind any of the ${userBound} user-configurable commands

To also install the matching theme, **Load unpacked** the \`theme/\` subdirectory.

## Keyboard commands

Chrome’s manifest allows at most 4 default-suggested shortcuts. The rest are
bound by the user from \`chrome://extensions/shortcuts\`. **${withKey.length} ship with default keys**,
**${userBound} are user-configurable**, for **${total} total**.

| Command | Default | Description |
| --- | --- | --- |
${cmds.map(mdRow).join("\n")}

## Files

| Path | Purpose |
| --- | --- |
| \`manifest.json\` | MV3 manifest, command registry |
| \`background.js\` | Service worker: MRU tracker, command dispatcher |
| \`lib/util.js\` | Pure helpers (MRU push/drop/step, hostname parse, jump-index) — unit-testable in node |
| \`popup.html\` / \`popup.css\` / \`popup.js\` | Cyberpunk HUD popup (palette from strykelang \`docs/hud-static.css\`) |
| \`docs/index.html\` | Landing page styled with the strykelang palette |
| \`theme/\` | Companion Chrome theme (separate extension) |
| \`icons/icon.svg\` | Source SVG; PNGs rasterized via \`rsvg-convert\` |
| \`scripts/gen.sh\` | Regenerate README and landing page from \`manifest.json\` |
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
  permission is actually used, both \`README.md\` and \`docs/index.html\` match a
  fresh \`scripts/gen.sh\` run (doc-drift guard).
- **Pure logic**: \`lib/util.js\` helpers — MRU stack behavior, hostname parse,
  numeric tab-jump resolution.

## Regenerating docs

Command list, counts, and the landing-page table are derived from
\`manifest.json\`. To refresh:

\`\`\`sh
scripts/gen.sh
\`\`\`

## License

MIT, MenkeTechnologies.
`;

writeFileSync(join(ROOT, "README.md"), readme);

// ---------------------------------------------------------------------------
// docs/index.html

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

const htmlRow = ([name, v]) => {
  const key = v.suggested_key?.default;
  const cls = key ? "default" : "user-set";
  const cell = key ? `<kbd>${escape(key)}</kbd>` : `<span class="muted">user-set</span>`;
  return `        <tr class="${cls}">
          <td><code>${escape(name)}</code></td>
          <td>${cell}</td>
          <td>${escape(v.description)}</td>
        </tr>`;
};

const html = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>zpwrchrome — cyberpunk recent-tabs switcher</title>
  <meta name="description" content="Chrome extension: recent-tabs switcher with ${total} keyboard shortcuts and a cyberpunk HUD by MenkeTechnologies.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;900&family=Share+Tech+Mono&display=swap" rel="stylesheet">
  <style>
    /* Palette + animations lifted from strykelang docs/hud-static.css. */
    html { color-scheme: dark; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ::selection { background: rgba(5, 217, 232, 0.3); color: #fff; }
    :root {
      --bg-primary: #05050a; --bg-secondary: #0a0a14; --bg-card: #0d0d1a;
      --bg-hover: #12122a;
      --accent: #ff2a6d; --accent-light: #ff6b9d; --accent-glow: rgba(255, 42, 109, 0.4);
      --cyan: #05d9e8; --cyan-glow: rgba(5, 217, 232, 0.4); --cyan-dim: rgba(5, 217, 232, 0.15);
      --magenta: #d300c5; --magenta-glow: rgba(211, 0, 197, 0.3);
      --green: #39ff14; --red: #ff073a;
      --text: #e0f0ff; --text-dim: #7a8ba8; --text-muted: #3d4f6a;
      --border: #1a1a3e;
      --cyber-grid-line: rgba(5, 217, 232, 0.042);
      --cyber-grid-cross: rgba(5, 217, 232, 0.034);
    }
    body {
      font-family: 'Share Tech Mono', 'SF Mono', 'Fira Code', monospace;
      background-color: var(--bg-primary);
      background-image:
        radial-gradient(ellipse at 20% 50%, rgba(5, 217, 232, 0.045) 0%, transparent 52%),
        radial-gradient(ellipse at 80% 20%, rgba(211, 0, 197, 0.04) 0%, transparent 50%),
        radial-gradient(ellipse at 50% 82%, rgba(255, 42, 109, 0.035) 0%, transparent 48%),
        linear-gradient(var(--cyber-grid-line) 1px, transparent 1px),
        linear-gradient(90deg, var(--cyber-grid-cross) 1px, transparent 1px);
      background-size: auto, auto, auto, 52px 52px, 52px 52px;
      background-attachment: fixed;
      color: var(--text);
      min-height: 100vh;
      line-height: 1.55;
    }
    .crt::after {
      content: ''; position: fixed; inset: 0;
      background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(5,217,232,.015) 2px, rgba(5,217,232,.015) 4px);
      pointer-events: none; z-index: 9999;
    }
    .crt::before {
      content: ''; position: fixed; inset: 0;
      background: radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,.5) 100%);
      pointer-events: none; z-index: 9998;
    }
    .scanline {
      position: fixed; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg, transparent 0%, rgba(5,217,232,.03) 20%, rgba(5,217,232,.08) 50%, rgba(5,217,232,.03) 80%, transparent 100%);
      box-shadow: 0 0 15px 5px rgba(5,217,232,.04);
      pointer-events: none; z-index: 9997;
      animation: hscan 12s linear infinite;
    }
    @keyframes hscan { 0% { top: -2px; opacity: 0; } 5%, 95% { opacity: 1; } 100% { top: 100%; opacity: 0; } }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: rgba(5,5,10,.5); }
    ::-webkit-scrollbar-thumb {
      background: linear-gradient(180deg, var(--cyan), var(--magenta));
      border-radius: 4px; box-shadow: 0 0 8px var(--cyan-glow);
    }

    header.hero {
      padding: 60px 24px 40px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(180deg, #070714 0%, #0d0d22 42%, var(--bg-secondary) 100%);
      position: relative;
      text-align: center;
      box-shadow: 0 4px 28px rgba(0,0,0,.55), 0 1px 0 rgba(5,217,232,.1), inset 0 1px 0 rgba(5,217,232,.06);
    }
    header.hero::after {
      content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 1px;
      background: linear-gradient(90deg, transparent, var(--cyan), var(--accent), var(--cyan), transparent);
      opacity: .6;
    }
    h1 {
      font-family: 'Orbitron', sans-serif;
      font-size: clamp(1.6rem, 5vw, 3rem);
      font-weight: 900;
      letter-spacing: 4px;
      text-transform: uppercase;
      background: linear-gradient(90deg, var(--cyan), #fff, var(--accent), var(--cyan));
      background-size: 300% 100%;
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
      filter: drop-shadow(0 0 12px var(--cyan-glow));
      animation: shimmer 6s linear infinite;
      margin-bottom: 14px;
    }
    @keyframes shimmer { 0% { background-position: 0% 0%; } 100% { background-position: 300% 0%; } }
    .tagline { color: var(--text-dim); font-size: 14px; letter-spacing: .5px; max-width: 56rem; margin: 0 auto 26px; }
    .stat-row {
      display: flex; gap: 24px; justify-content: center; flex-wrap: wrap;
      margin: 28px auto 0; max-width: 64rem;
    }
    .stat {
      padding: 14px 22px;
      background: var(--bg-card); border: 1px solid var(--cyan); border-radius: 2px;
      box-shadow: 0 0 16px var(--cyan-glow);
      min-width: 9rem;
    }
    .stat .n { font-family: 'Orbitron', sans-serif; font-size: 28px; font-weight: 900; color: var(--cyan); letter-spacing: 2px; }
    .stat .l { font-size: 10px; letter-spacing: 1.5px; color: var(--text-muted); text-transform: uppercase; margin-top: 2px; }
    .ctas { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 30px; }
    .btn {
      padding: 10px 18px; border-radius: 2px;
      font-family: 'Share Tech Mono', monospace;
      font-size: 11px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase;
      text-decoration: none; display: inline-flex; align-items: center; gap: 8px;
      transition: all .2s;
      background-image: linear-gradient(180deg, rgba(255,255,255,.12) 0%, rgba(255,255,255,.02) 40%, transparent 60%);
    }
    .btn-primary { background: transparent; color: var(--accent); border: 1px solid var(--accent); box-shadow: 0 0 10px var(--accent-glow); }
    .btn-primary:hover { background: rgba(255,42,109,.08); box-shadow: 0 0 18px var(--accent-glow); transform: translateY(-1px); }
    .btn-secondary { background: transparent; color: var(--cyan); border: 1px solid var(--cyan); box-shadow: 0 0 8px var(--cyan-dim); }
    .btn-secondary:hover { background: rgba(5,217,232,.08); box-shadow: 0 0 15px var(--cyan-glow); transform: translateY(-1px); }

    main { max-width: 80rem; margin: 0 auto; padding: 36px 20px 60px; position: relative; z-index: 1; }
    section.card {
      background-color: var(--bg-card);
      background-image: linear-gradient(180deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.02) 30%, transparent 50%);
      border: 1px solid var(--cyan);
      border-radius: 2px;
      padding: 22px 26px;
      margin: 22px 0;
      position: relative;
      box-shadow: 0 0 30px var(--cyan-glow);
      backdrop-filter: blur(12px) saturate(1.4);
      animation: glow 3.5s ease-in-out infinite;
    }
    @keyframes glow {
      0%, 100% { box-shadow: 0 0 20px var(--cyan-glow), 0 0 4px var(--cyan-glow); border-color: var(--cyan); }
      50%      { box-shadow: 0 0 40px var(--cyan-glow), 0 0 12px var(--magenta-glow); border-color: var(--accent); }
    }
    h2 {
      font-family: 'Orbitron', sans-serif; font-size: 14px; color: var(--cyan);
      text-transform: uppercase; letter-spacing: 2.5px;
      padding-bottom: 12px; margin-bottom: 14px;
      border-bottom: 1px solid var(--border);
    }
    .features { display: grid; grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr)); gap: 14px; }
    .feature {
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-left: 3px solid var(--cyan);
      background: var(--bg-secondary);
      font-size: 12px;
      color: var(--text);
    }
    .feature strong { color: var(--accent-light); display: block; font-family: 'Orbitron', sans-serif; font-size: 11px; letter-spacing: 1px; margin-bottom: 4px; text-transform: uppercase; }

    .install ol { margin: 0 0 0 1.2rem; }
    .install li { margin: 6px 0; font-size: 13px; }
    .install code { background: var(--bg-secondary); border: 1px solid var(--border); padding: 1px 6px; border-radius: 2px; color: var(--cyan); font-size: 12px; }

    .table-wrap { overflow-x: auto; margin-top: 10px; }
    table { border-collapse: collapse; width: 100%; min-width: 50rem; }
    th, td { border: 1px solid var(--border); padding: 8px 10px; text-align: left; vertical-align: top; font-size: 12px; }
    th { background: var(--bg-secondary); color: var(--cyan); font-family: 'Orbitron', sans-serif; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; }
    td code { background: var(--bg-secondary); border: 1px solid var(--border); padding: 1px 6px; border-radius: 2px; font-size: 11px; color: var(--text); }
    kbd {
      display: inline-block;
      padding: 2px 8px;
      font-family: 'Share Tech Mono', monospace; font-size: 11px;
      color: var(--accent); background: var(--bg-secondary);
      border: 1px solid var(--accent); border-radius: 2px;
      box-shadow: 0 0 6px var(--accent-glow);
    }
    tr.user-set kbd, .muted { color: var(--text-muted); }
    .muted { font-style: italic; font-size: 11px; }

    footer { text-align: center; padding: 24px 16px 40px; color: var(--text-muted); font-size: 11px; letter-spacing: .5px; }
    footer a { color: var(--cyan); text-decoration: none; }
    footer a:hover { color: var(--accent-light); text-shadow: 0 0 8px var(--cyan-glow); }
  </style>
</head>
<body class="crt">
  <div class="scanline"></div>

  <header class="hero">
    <h1>zpwrchrome // recent tabs</h1>
    <p class="tagline">Cyberpunk Chrome extension. ${total} keyboard commands for tab navigation, batch tab ops, and clipboard utilities.<br>Built on the strykelang HUD palette by MenkeTechnologies.</p>
    <div class="stat-row">
      <div class="stat"><div class="n">${total}</div><div class="l">commands</div></div>
      <div class="stat"><div class="n">${withKey.length}</div><div class="l">default-keyed</div></div>
      <div class="stat"><div class="n">${userBound}</div><div class="l">user-bound</div></div>
    </div>
    <div class="ctas">
      <a class="btn btn-primary"   href="https://github.com/MenkeTechnologies/zpwrchrome">▸ source on github</a>
      <a class="btn btn-secondary" href="#install">▸ install</a>
      <a class="btn btn-secondary" href="#commands">▸ commands</a>
      <a class="btn btn-secondary" href="#theme">▸ theme</a>
    </div>
  </header>

  <main>
    <section class="card">
      <h2>features</h2>
      <div class="features">
        <div class="feature"><strong>MRU tracking</strong>Cross-window most-recently-used stack. Survives service-worker restarts.</div>
        <div class="feature"><strong>Alt+Z back</strong>Jump to previous tab, just like Recent Tabs.</div>
        <div class="feature"><strong>Alt+Shift+T restore</strong>Reopen the most recently closed tab from any window.</div>
        <div class="feature"><strong>Filtered popup</strong>Live filter over open + closed tabs, ↑↓/Enter/Del nav.</div>
        <div class="feature"><strong>Batch tab ops</strong>close-others, close-right, close-duplicates, reload-all, sort-by-URL, group-by-domain.</div>
        <div class="feature"><strong>Single-tab ops</strong>duplicate, pin, mute, detach, bookmark, copy URL, copy Markdown link.</div>
        <div class="feature"><strong>Numeric jumps</strong>jump-to-1..9 (1-8 nth tab, 9 = last).</div>
        <div class="feature"><strong>${userBound} configurable shortcuts</strong>Bind anything you want at <code>chrome://extensions/shortcuts</code>.</div>
      </div>
    </section>

    <section class="card install" id="install">
      <h2>install (unpacked)</h2>
      <ol>
        <li><code>git clone https://github.com/MenkeTechnologies/zpwrchrome.git</code></li>
        <li>Open <code>chrome://extensions</code> and enable <strong>Developer mode</strong></li>
        <li>Click <strong>Load unpacked</strong>, pick the cloned directory</li>
        <li>Open <code>chrome://extensions/shortcuts</code> to bind any of the ${userBound} user-configurable commands</li>
        <li>Optional: <strong>Load unpacked</strong> the <code>theme/</code> subdirectory for the matching browser theme</li>
      </ol>
    </section>

    <section class="card" id="commands">
      <h2>keyboard commands</h2>
      <p style="color: var(--text-dim); font-size: 12px; margin-bottom: 8px;">
        Chrome caps default-suggested shortcuts at 4. The remaining ${userBound} commands are bound by the user
        in <code style="background: var(--bg-secondary); border: 1px solid var(--border); padding: 1px 6px; border-radius: 2px; color: var(--cyan);">chrome://extensions/shortcuts</code>.
      </p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>command</th><th>default</th><th>description</th></tr></thead>
          <tbody>
${cmds.map(htmlRow).join("\n")}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card" id="theme">
      <h2>companion theme</h2>
      <p style="color: var(--text-dim); font-size: 13px;">
        The <code>theme/</code> directory ships a separate Chrome theme that paints the
        browser frame, toolbar, and new-tab page with the same cyberpunk palette
        (<code>#05050a</code> bg / <code>#05d9e8</code> cyan / <code>#ff2a6d</code> accent).
        Themes cannot be bundled with action extensions, so load it as its own
        unpacked extension.
      </p>
    </section>
  </main>

  <footer>
    zpwrchrome · MIT · MenkeTechnologies ·
    <a href="https://github.com/MenkeTechnologies/zpwrchrome">github.com/MenkeTechnologies/zpwrchrome</a>
  </footer>
</body>
</html>
`;

writeFileSync(join(ROOT, "docs/index.html"), html);
