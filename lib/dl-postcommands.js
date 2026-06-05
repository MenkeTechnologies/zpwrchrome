// zpwrchrome — post-download commands (pure helpers).
//
// After a download finishes, the SW matches the destination path
// against the user's configured rules and asks the native host to
// spawn the matching command. argv-style only — the template is
// parsed via a shlex-style splitter so `{path}` substitution doesn't
// need shell quoting and there's no command-injection surface. Users
// who want pipes / redirects / && wrap the rule's command in
// `bash -c '…'` explicitly.

export const STATE_KEY = "dl.postCommands";

export const DEFAULTS = Object.freeze({
  rules: [],   // Array<Rule>
});

// Rule shape (for reference):
//   { id: "abc",
//     name: "extract zips",     // user-facing label
//     glob: "*.zip",            // matched against the file basename
//     command: "unzip -d {dir} {path}",
//     confirm: false,            // show a Chrome notification with Run/Skip
//     enabled: true }

// Path metadata used by template substitution. Cross-platform: we
// detect both / and \ separators so a Windows path passes through.
export function pathMeta(path) {
  const p = String(path || "");
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const dir = slash >= 0 ? p.slice(0, slash) : "";
  const name = slash >= 0 ? p.slice(slash + 1) : p;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  return { path: p, dir, name, base, ext };
}

// Glob matcher — `*` matches any-chars, `?` matches one char. Matched
// against the BASENAME of the file (so `*.zip` does what users expect
// regardless of how deep the file is). Case-insensitive on the
// extension portion to match real-world filesystems.
export function matchGlob(path, glob) {
  if (!glob || typeof glob !== "string") return false;
  const name = pathMeta(path).name.toLowerCase();
  const g = glob.toLowerCase();
  // Escape regex metacharacters EXCEPT the glob wildcards * and ?.
  const re = new RegExp(
    "^" +
      g.replace(/[.+^${}()|[\]\\]/g, "\\$&")
       .replace(/\*/g, ".*")
       .replace(/\?/g, ".") +
      "$"
  );
  return re.test(name);
}

// Shlex-style argv splitter — single quotes preserve literally,
// double quotes allow backslash-escapes, unquoted whitespace splits.
// This runs on the TEMPLATE before substitution so a {path} containing
// spaces (e.g. "foo bar.zip") still passes as a single argv entry.
export function parseArgv(template) {
  const argv = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  let escape = false;
  let started = false;
  for (const ch of String(template || "")) {
    if (escape) { cur += ch; escape = false; started = true; continue; }
    if (ch === "\\" && !inSingle) { escape = true; continue; }
    if (ch === "'" && !inDouble)  { inSingle = !inSingle; started = true; continue; }
    if (ch === '"' && !inSingle)  { inDouble = !inDouble; started = true; continue; }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (started) { argv.push(cur); cur = ""; started = false; }
      continue;
    }
    cur += ch;
    started = true;
  }
  if (started) argv.push(cur);
  return argv;
}

// Substitute {path} / {dir} / {name} / {base} / {ext} placeholders.
// Per-token so a {path} containing spaces remains one argv element.
export function expandToken(token, meta) {
  return String(token || "")
    .replace(/\{path\}/g, meta.path || "")
    .replace(/\{dir\}/g, meta.dir || "")
    .replace(/\{name\}/g, meta.name || "")
    .replace(/\{base\}/g, meta.base || "")
    .replace(/\{ext\}/g, meta.ext || "");
}
export function expandArgv(argv, meta) {
  return argv.map((t) => expandToken(t, meta));
}

// First-match rule selection. Rules are stored in user-provided order.
export function pickRule(rules, path) {
  if (!Array.isArray(rules)) return null;
  for (const r of rules) {
    if (r && r.enabled !== false && matchGlob(path, r.glob)) return r;
  }
  return null;
}

// Build the argv that should actually be spawned for a given rule + file.
// Returns { argv, displayCommand } — argv is what the host runs;
// displayCommand is what we show in the confirm notification.
export function buildSpawn(rule, path) {
  const meta = pathMeta(path);
  const tokens = parseArgv(rule.command || "");
  const argv = expandArgv(tokens, meta);
  // Display joins with spaces, quoting any arg that contains whitespace
  // so the user can see what would run. This is for display only — the
  // host gets the raw argv array.
  const displayCommand = argv
    .map((a) => /\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)
    .join(" ");
  return { argv, displayCommand, meta };
}
