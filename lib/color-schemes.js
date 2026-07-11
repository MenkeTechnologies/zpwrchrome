// zpwrchrome — the 8 built-in color schemes, vendored verbatim from the
// app-shell source of truth (zgui-core/webui/colorscheme.js). One place
// holds the palette data; every consumer derives from here:
//
//   • lib/ui-scheme.js          — recolors zpwrchrome's own pages (popup +
//                                  scripts-manager dashboards) by applying
//                                  varsFor(id) to documentElement.
//   • scripts-manager/theme-injector.js — the picker UI + writes the chosen
//                                  scheme's palette into storage for the
//                                  page-recolor content script.
//   • lib/cyber-theme-css.js / modal/cyber-theme.js — recolor arbitrary web
//                                  pages from themeFor(id) (camelCase shape).
//
// Only the DARK variants are vendored: every zpwrchrome page is dark-only
// (popup.html / all dashboards declare data-theme="dark", no light toggle).

export const DEFAULT_SCHEME = "cyberpunk";

// The CSS custom-property keys a scheme defines. Same set as the app shell's
// SCHEME_VAR_KEYS so the vendored palettes drop in unchanged.
export const SCHEME_VAR_KEYS = [
  "--accent", "--accent-light", "--accent-glow",
  "--cyan", "--cyan-glow", "--cyan-dim",
  "--magenta", "--magenta-glow",
  "--green", "--green-bg",
  "--yellow", "--yellow-glow",
  "--orange", "--orange-bg",
  "--red",
  "--text", "--text-dim", "--text-muted",
  "--bg-primary", "--bg-secondary", "--bg-card", "--bg-hover",
  "--border", "--border-glow",
];

export const COLOR_SCHEMES = {
  cyberpunk: {
    label: "Cyberpunk",
    desc: "Hot pink + cyan neon (default)",
    vars: {
      "--accent": "#ff2a6d", "--accent-light": "#ff6b9d", "--accent-glow": "rgba(255, 42, 109, 0.4)",
      "--cyan": "#05d9e8", "--cyan-glow": "rgba(5, 217, 232, 0.4)", "--cyan-dim": "rgba(5, 217, 232, 0.15)",
      "--magenta": "#d300c5", "--magenta-glow": "rgba(211, 0, 197, 0.3)",
      "--green": "#39ff14", "--green-bg": "rgba(57, 255, 20, 0.08)",
      "--yellow": "#f9f002", "--yellow-glow": "rgba(249, 240, 2, 0.2)",
      "--orange": "#ff6b35", "--orange-bg": "rgba(255, 107, 53, 0.1)",
      "--red": "#ff073a",
      "--text": "#e0f0ff", "--text-dim": "#7a8ba8", "--text-muted": "#3d4f6a",
      "--bg-primary": "#05050a", "--bg-secondary": "#0a0a14", "--bg-card": "#0d0d1a", "--bg-hover": "#12122a",
      "--border": "#1a1a3e", "--border-glow": "#2a1a4e",
    },
  },
  midnight: {
    label: "Midnight",
    desc: "Deep blue + electric purple",
    vars: {
      "--accent": "#7c3aed", "--accent-light": "#a78bfa", "--accent-glow": "rgba(124, 58, 237, 0.4)",
      "--cyan": "#38bdf8", "--cyan-glow": "rgba(56, 189, 248, 0.4)", "--cyan-dim": "rgba(56, 189, 248, 0.15)",
      "--magenta": "#6366f1", "--magenta-glow": "rgba(99, 102, 241, 0.3)",
      "--green": "#34d399", "--green-bg": "rgba(52, 211, 153, 0.08)",
      "--yellow": "#c084fc", "--yellow-glow": "rgba(192, 132, 252, 0.2)",
      "--orange": "#818cf8", "--orange-bg": "rgba(129, 140, 248, 0.1)",
      "--red": "#f472b6",
      "--text": "#e0e7ff", "--text-dim": "#94a3b8", "--text-muted": "#475569",
      "--bg-primary": "#050510", "--bg-secondary": "#0a0a1e", "--bg-card": "#0d0d28", "--bg-hover": "#141432",
      "--border": "#1e1e4a", "--border-glow": "#2e1e5a",
    },
  },
  matrix: {
    label: "Matrix",
    desc: "Terminal green on black",
    vars: {
      "--accent": "#22c55e", "--accent-light": "#4ade80", "--accent-glow": "rgba(34, 197, 94, 0.4)",
      "--cyan": "#39ff14", "--cyan-glow": "rgba(57, 255, 20, 0.4)", "--cyan-dim": "rgba(57, 255, 20, 0.15)",
      "--magenta": "#16a34a", "--magenta-glow": "rgba(22, 163, 74, 0.3)",
      "--green": "#4ade80", "--green-bg": "rgba(74, 222, 128, 0.08)",
      "--yellow": "#a3e635", "--yellow-glow": "rgba(163, 230, 53, 0.2)",
      "--orange": "#86efac", "--orange-bg": "rgba(134, 239, 172, 0.1)",
      "--red": "#ef4444",
      "--text": "#d1fae5", "--text-dim": "#6ee7b7", "--text-muted": "#365314",
      "--bg-primary": "#020a02", "--bg-secondary": "#061006", "--bg-card": "#081408", "--bg-hover": "#0e200e",
      "--border": "#1a3a1a", "--border-glow": "#1a4a1a",
    },
  },
  ember: {
    label: "Ember",
    desc: "Warm amber + orange tones",
    vars: {
      "--accent": "#f59e0b", "--accent-light": "#fbbf24", "--accent-glow": "rgba(245, 158, 11, 0.4)",
      "--cyan": "#fb923c", "--cyan-glow": "rgba(251, 146, 60, 0.4)", "--cyan-dim": "rgba(251, 146, 60, 0.15)",
      "--magenta": "#ea580c", "--magenta-glow": "rgba(234, 88, 12, 0.3)",
      "--green": "#84cc16", "--green-bg": "rgba(132, 204, 22, 0.08)",
      "--yellow": "#fde047", "--yellow-glow": "rgba(253, 224, 71, 0.2)",
      "--orange": "#f97316", "--orange-bg": "rgba(249, 115, 22, 0.1)",
      "--red": "#dc2626",
      "--text": "#fef3c7", "--text-dim": "#d97706", "--text-muted": "#92400e",
      "--bg-primary": "#0a0502", "--bg-secondary": "#120a04", "--bg-card": "#1a0e06", "--bg-hover": "#24140a",
      "--border": "#3e2a1a", "--border-glow": "#4e3a1a",
    },
  },
  arctic: {
    label: "Arctic",
    desc: "Cool whites + icy blue",
    vars: {
      "--accent": "#0ea5e9", "--accent-light": "#38bdf8", "--accent-glow": "rgba(14, 165, 233, 0.4)",
      "--cyan": "#67e8f9", "--cyan-glow": "rgba(103, 232, 249, 0.4)", "--cyan-dim": "rgba(103, 232, 249, 0.15)",
      "--magenta": "#06b6d4", "--magenta-glow": "rgba(6, 182, 212, 0.3)",
      "--green": "#2dd4bf", "--green-bg": "rgba(45, 212, 191, 0.08)",
      "--yellow": "#a5f3fc", "--yellow-glow": "rgba(165, 243, 252, 0.2)",
      "--orange": "#22d3ee", "--orange-bg": "rgba(34, 211, 238, 0.1)",
      "--red": "#f43f5e",
      "--text": "#ecfeff", "--text-dim": "#a5f3fc", "--text-muted": "#155e75",
      "--bg-primary": "#020a0e", "--bg-secondary": "#041218", "--bg-card": "#061a22", "--bg-hover": "#0a2430",
      "--border": "#1a3a4e", "--border-glow": "#1a4a5e",
    },
  },
  crimson: {
    label: "Crimson",
    desc: "Rose-red accent + teal highlight",
    vars: {
      "--accent": "#e11d48", "--accent-light": "#fb7185", "--accent-glow": "rgba(225, 29, 72, 0.4)",
      "--cyan": "#2dd4bf", "--cyan-glow": "rgba(45, 212, 191, 0.4)", "--cyan-dim": "rgba(45, 212, 191, 0.15)",
      "--magenta": "#f43f5e", "--magenta-glow": "rgba(244, 63, 94, 0.3)",
      "--green": "#22c55e", "--green-bg": "rgba(34, 197, 94, 0.08)",
      "--yellow": "#fbbf24", "--yellow-glow": "rgba(251, 191, 36, 0.2)",
      "--orange": "#fb923c", "--orange-bg": "rgba(251, 146, 60, 0.1)",
      "--red": "#ff073a",
      "--text": "#ffe4e6", "--text-dim": "#b08a92", "--text-muted": "#6b4a52",
      "--bg-primary": "#0a0506", "--bg-secondary": "#140a0c", "--bg-card": "#1a0d10", "--bg-hover": "#2a1318",
      "--border": "#3e1a22", "--border-glow": "#4e2030",
    },
  },
  toxic: {
    label: "Toxic",
    desc: "Acid-lime accent + magenta",
    vars: {
      "--accent": "#c6ff00", "--accent-light": "#e2ff6b", "--accent-glow": "rgba(198, 255, 0, 0.4)",
      "--cyan": "#00e5ff", "--cyan-glow": "rgba(0, 229, 255, 0.4)", "--cyan-dim": "rgba(0, 229, 255, 0.15)",
      "--magenta": "#ff00aa", "--magenta-glow": "rgba(255, 0, 170, 0.3)",
      "--green": "#39ff14", "--green-bg": "rgba(57, 255, 20, 0.08)",
      "--yellow": "#f9f002", "--yellow-glow": "rgba(249, 240, 2, 0.2)",
      "--orange": "#ff6b35", "--orange-bg": "rgba(255, 107, 53, 0.1)",
      "--red": "#ff073a",
      "--text": "#e8ffd0", "--text-dim": "#8a9a6a", "--text-muted": "#4a5a32",
      "--bg-primary": "#07090a", "--bg-secondary": "#0c0f0a", "--bg-card": "#0f130c", "--bg-hover": "#161b10",
      "--border": "#2a3a1a", "--border-glow": "#3a4a20",
    },
  },
  vapor: {
    label: "Vapor",
    desc: "Vaporwave pastel pink + cyan",
    vars: {
      "--accent": "#ff6ec7", "--accent-light": "#ff9fd8", "--accent-glow": "rgba(255, 110, 199, 0.4)",
      "--cyan": "#72f1ff", "--cyan-glow": "rgba(114, 241, 255, 0.4)", "--cyan-dim": "rgba(114, 241, 255, 0.15)",
      "--magenta": "#c792ea", "--magenta-glow": "rgba(199, 146, 234, 0.3)",
      "--green": "#5af2b0", "--green-bg": "rgba(90, 242, 176, 0.08)",
      "--yellow": "#fff59d", "--yellow-glow": "rgba(255, 245, 157, 0.2)",
      "--orange": "#ffb38a", "--orange-bg": "rgba(255, 179, 138, 0.1)",
      "--red": "#ff6b8b",
      "--text": "#f0e6ff", "--text-dim": "#a99cc4", "--text-muted": "#6a5f86",
      "--bg-primary": "#0d0814", "--bg-secondary": "#140d1f", "--bg-card": "#1a1228", "--bg-hover": "#241836",
      "--border": "#2e2142", "--border-glow": "#3e2d56",
    },
  },
};

export const SCHEME_IDS = Object.keys(COLOR_SCHEMES);

// The font stack the page-recolor builders force when forceMono is on. Schemes
// only carry colors, so the font lives here (matches the original THEME.fontStack).
export const FONT_STACK = "'Share Tech Mono', 'SF Mono', 'Fira Code', monospace";

// varsFor(id) → the `--`-prefixed CSS-var map for a scheme (dark). Used to
// recolor zpwrchrome's own pages by setting these on documentElement.style.
export function varsFor(id) {
  const s = COLOR_SCHEMES[id] || COLOR_SCHEMES[DEFAULT_SCHEME];
  return s.vars;
}

// themeFor(id) → the camelCase palette shape the page-recolor CSS builders
// (lib/cyber-theme-css.js buildThemeCss, modal/cyber-theme.js buildCss) consume.
// Mirrors the THEME object those builders default to.
export function themeFor(id) {
  return themeFromVars(varsFor(id));
}

// The hex-pickable BASE tokens a custom scheme is edited by; the glow/dim/bg
// variants are auto-derived by buildCustomScheme, so they are NOT edited directly.
// Ported from zgui-core colorscheme.js CUSTOM_EDIT_KEYS (the app-shell source).
export const CUSTOM_EDIT_KEYS = [
  "--accent", "--cyan", "--magenta", "--green", "--yellow", "--orange", "--red",
  "--bg-primary", "--bg-secondary", "--bg-card", "--bg-hover",
  "--text", "--text-dim", "--text-muted", "--border",
];

// hex → rgba (for the auto-derived glow/dim variants). Port of zgui-core hexToRgba.
export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// The colorscheme BUILDER: from the base hex picks, auto-generate the glow/dim/bg
// variants so a custom scheme renders a complete palette. Exact port of zgui-core
// buildCustomScheme — keep the alpha constants in lockstep with the app shell.
export function buildCustomScheme(pickerVars) {
  const vars = Object.assign({}, pickerVars);
  if (vars["--accent"]) vars["--accent-glow"] = hexToRgba(vars["--accent"], 0.4);
  if (vars["--cyan"]) { vars["--cyan-glow"] = hexToRgba(vars["--cyan"], 0.4); vars["--cyan-dim"] = hexToRgba(vars["--cyan"], 0.15); }
  if (vars["--magenta"]) vars["--magenta-glow"] = hexToRgba(vars["--magenta"], 0.3);
  if (vars["--yellow"]) vars["--yellow-glow"] = hexToRgba(vars["--yellow"], 0.2);
  if (vars["--green"]) vars["--green-bg"] = hexToRgba(vars["--green"], 0.08);
  if (vars["--orange"]) vars["--orange-bg"] = hexToRgba(vars["--orange"], 0.1);
  return vars;
}

// themeFromVars(vars) → the same camelCase palette shape from a raw `--`-prefixed
// var map. Used for custom/edited schemes synced from ~/.zwire/global.toml, which
// have no entry in the vendored table (only a resolved var→hex map).
export function themeFromVars(v) {
  v = v || {};
  return {
    bgPrimary: v["--bg-primary"],
    bgSecondary: v["--bg-secondary"],
    bgCard: v["--bg-card"],
    bgHover: v["--bg-hover"],
    cyan: v["--cyan"],
    cyanGlow: v["--cyan-glow"],
    accent: v["--accent"],
    accentGlow: v["--accent-glow"],
    magenta: v["--magenta"],
    orange: v["--orange"],
    green: v["--green"],
    yellow: v["--yellow"],
    text: v["--text"],
    textDim: v["--text-dim"],
    textMuted: v["--text-muted"],
    border: v["--border"],
    fontStack: FONT_STACK,
  };
}
