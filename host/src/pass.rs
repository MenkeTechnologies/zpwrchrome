use crate::proto::{Request, Response};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn dispatch_pass(req: Request) -> Response {
    match req.op.as_str() {
        "list" => list(req),
        "match" => match_op(req),
        "search" => search_op(req),
        "fetch" => fetch(req),
        "otp" => otp(req),
        other => Response::err(req.id, format!("unknown pass op: {other}")),
    }
}

pub fn store_dir() -> PathBuf {
    if let Ok(p) = std::env::var("PASSWORD_STORE_DIR") {
        return PathBuf::from(p);
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join(".password-store");
    }
    PathBuf::from(".password-store")
}

#[derive(Clone, Debug, PartialEq)]
pub struct Store {
    pub name: String,
    pub dir: PathBuf,
}

// Resolve configured password stores. Multi-store: ZPWRCHROME_PASS_STORES is
// a colon-separated list of directories (`/Users/x/.password-store:/Users/x/work`),
// each named after its basename. Single store falls back to PASSWORD_STORE_DIR
// or ~/.password-store with name "default".
pub fn stores() -> Vec<Store> {
    if let Ok(list) = std::env::var("ZPWRCHROME_PASS_STORES") {
        let mut out = Vec::new();
        for s in list.split(':').filter(|s| !s.is_empty()) {
            let dir = PathBuf::from(s);
            let name = dir
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("pass")
                .to_string();
            out.push(Store { name, dir });
        }
        if !out.is_empty() {
            return out;
        }
    }
    let dir = store_dir();
    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| if n == ".password-store" { "default" } else { n }.to_string())
        .unwrap_or_else(|| "default".to_string());
    vec![Store { name, dir }]
}

pub fn store_dir_for(name: &str) -> Option<PathBuf> {
    stores().into_iter().find(|s| s.name == name).map(|s| s.dir)
}

fn list(req: Request) -> Response {
    let entries = list_all();
    let stores_meta: Vec<Value> = stores()
        .into_iter()
        .map(|s| json!({"name": s.name, "dir": s.dir.to_string_lossy()}))
        .collect();
    Response::ok(req.id, json!({"entries": entries, "stores": stores_meta}))
}

// Aggregate listing across every configured store. Returns Value array of
// {"store":..,"path":..} so single- and multi-store deployments share the
// same JSON shape (popup always knows the origin).
pub fn list_all() -> Vec<Value> {
    let mut out = Vec::new();
    for store in stores() {
        for path in list_in_dir(&store.dir) {
            out.push(json!({"store": store.name, "path": path}));
        }
    }
    out
}

pub fn list_in_dir(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    walk_store(root, root, &mut out);
    out.sort();
    out
}

fn walk_store(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let rd = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };
    for ent in rd.flatten() {
        let name = ent.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') {
            continue;
        }
        let p = ent.path();
        let ft = match ent.file_type() {
            Ok(f) => f,
            Err(_) => continue,
        };
        if ft.is_dir() {
            walk_store(root, &p, out);
        } else if let Some(stem) = name_str.strip_suffix(".gpg") {
            let parent = p.parent().unwrap_or(root);
            let rel_dir = parent.strip_prefix(root).unwrap_or(Path::new(""));
            let full = if rel_dir.as_os_str().is_empty() {
                stem.to_string()
            } else {
                format!("{}/{}", rel_dir.display(), stem)
            };
            out.push(full);
        }
    }
}

// Minimal multi-label public-suffix list. Covers the common case where the
// registrable domain is two labels past the suffix (foo.co.uk, foo.com.au).
// Single-label TLDs (com, org, io, etc.) need no entry here.
const MULTI_LABEL_SUFFIXES: &[&str] = &[
    "co.uk", "com.au", "co.jp", "co.in", "co.za", "com.br", "com.mx",
    "com.tw", "com.cn", "co.kr", "co.nz", "ac.uk", "gov.uk", "org.uk",
    "co.il", "ne.jp", "or.jp",
];

pub fn etld_plus_one(host: &str) -> String {
    let host = host.trim().trim_end_matches('.').to_lowercase();
    for tld in MULTI_LABEL_SUFFIXES {
        let suffix = format!(".{tld}");
        if let Some(head) = host.strip_suffix(&suffix) {
            if let Some(label) = head.rsplit('.').next() {
                if !label.is_empty() {
                    return format!("{label}.{tld}");
                }
            }
        }
    }
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() <= 2 {
        return host;
    }
    parts[parts.len() - 2..].join(".")
}

pub fn candidates(host: &str) -> Vec<String> {
    let host = host.trim().trim_end_matches('.').to_lowercase();
    if host.is_empty() {
        return Vec::new();
    }
    let etld1 = etld_plus_one(&host);
    let mut out = Vec::new();
    let mut cur = host.as_str();
    loop {
        out.push(cur.to_string());
        if cur == etld1 {
            break;
        }
        match cur.split_once('.') {
            Some((_, rest)) if !rest.is_empty() && rest.contains('.') || rest == etld1 => {
                cur = rest;
            }
            _ => break,
        }
    }
    if !out.iter().any(|c| c == &etld1) && etld1.contains('.') {
        out.push(etld1);
    }
    out
}

pub fn match_in(entries: &[String], host: &str) -> Vec<String> {
    let cands = candidates(host);
    let mut scored: BTreeMap<usize, Vec<String>> = BTreeMap::new();
    for entry in entries {
        let first = entry.split('/').next().unwrap_or("");
        // entries with no dir component — match whole basename or stripped www.
        let basename = entry.rsplit('/').next().unwrap_or(entry);
        for (idx, cand) in cands.iter().enumerate() {
            if first == *cand
                || first.ends_with(&format!(".{cand}"))
                || basename == *cand
                || basename.ends_with(&format!(".{cand}"))
            {
                scored.entry(idx).or_default().push(entry.clone());
                break;
            }
        }
    }
    let mut out = Vec::new();
    for (_score, list) in scored {
        out.extend(list);
    }
    out.sort();
    out.dedup();
    out
}

pub fn search_in(entries: &[String], query: &str) -> Vec<String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        let mut out = entries.to_vec();
        out.sort();
        return out;
    }
    // Two-pass scoring: substring matches rank above subsequence matches,
    // and earlier hits rank above later ones. No external fzf crate; the
    // store is small enough (~10⁴ entries) that an O(n*|q|) walk is fine.
    let mut scored: Vec<(i64, &String)> = Vec::new();
    for entry in entries {
        let lower = entry.to_lowercase();
        if let Some(pos) = lower.find(&q) {
            scored.push((-(1_000_000 - pos as i64), entry));
            continue;
        }
        if let Some(score) = subseq_score(&lower, &q) {
            scored.push((-score, entry));
        }
    }
    scored.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(b.1)));
    scored.into_iter().map(|(_, s)| s.clone()).collect()
}

fn subseq_score(haystack: &str, needle: &str) -> Option<i64> {
    let mut hi = haystack.chars();
    let mut last_pos: i64 = -1;
    let mut score: i64 = 0;
    let mut consumed = 0;
    for nc in needle.chars() {
        let nlc = nc.to_ascii_lowercase();
        let mut pos = -1i64;
        for (i, hc) in hi.by_ref().enumerate() {
            consumed += 1;
            if hc.to_ascii_lowercase() == nlc {
                pos = (last_pos + 1 + i as i64);
                break;
            }
        }
        if pos < 0 {
            return None;
        }
        let gap = if last_pos < 0 { 0 } else { pos - last_pos - 1 };
        score -= gap * 2;
        score += 10;
        last_pos = pos;
    }
    let _ = consumed;
    Some(score)
}

fn search_op(req: Request) -> Response {
    let query = req
        .args
        .get("query")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let limit = req
        .args
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|n| n.min(500) as usize)
        .unwrap_or(200);
    let mut all: Vec<Value> = Vec::new();
    for store in stores() {
        let entries = list_in_dir(&store.dir);
        for path in search_in(&entries, query) {
            all.push(json!({"store": store.name, "path": path}));
        }
    }
    all.truncate(limit);
    Response::ok(req.id, json!({"query": query, "matches": all}))
}

fn match_op(req: Request) -> Response {
    let host = match req.args.get("host").and_then(|v| v.as_str()) {
        Some(h) => h.to_string(),
        None => return Response::err(req.id, "match: missing args.host"),
    };
    let mut matches: Vec<Value> = Vec::new();
    for store in stores() {
        let entries = list_in_dir(&store.dir);
        for path in match_in(&entries, &host) {
            matches.push(json!({"store": store.name, "path": path}));
        }
    }
    Response::ok(req.id, json!({"host": host, "matches": matches}))
}

fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.starts_with('.')
        && !path.contains("..")
        && path.chars().all(|c| {
            c.is_ascii_alphanumeric()
                || matches!(c, '-' | '_' | '.' | '/' | '@' | '+' | ' ')
        })
}

fn run_pass(args: &[&str]) -> Result<String, String> {
    run_pass_in(args, None)
}

fn run_pass_in(args: &[&str], store: Option<&str>) -> Result<String, String> {
    let mut cmd = Command::new("pass");
    cmd.args(args);
    if let Some(name) = store {
        if let Some(dir) = store_dir_for(name) {
            cmd.env("PASSWORD_STORE_DIR", dir);
        }
    }
    let output = cmd.output().map_err(|e| format!("spawn pass: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).into_owned();
        return Err(if err.is_empty() {
            format!("pass exited {}", output.status)
        } else {
            err.trim().to_string()
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn fetch(req: Request) -> Response {
    let path = match req.args.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return Response::err(req.id, "fetch: missing args.path"),
    };
    if !safe_path(path) {
        return Response::err(req.id, "fetch: invalid path");
    }
    let store = req.args.get("store").and_then(|v| v.as_str());
    match run_pass_in(&["show", path], store) {
        Ok(text) => Response::ok(req.id, parse_entry_with_path(&text, path)),
        Err(e) => Response::err(req.id, format!("pass show: {e}")),
    }
}

// browserpass-compat: when the entry body has no login/username/user/email/mail
// field, derive the username from the entry's basename. This matches the
// convention `pass example.com/johndoe` → "johndoe" is the user.
pub fn parse_entry_with_path(text: &str, path: &str) -> Value {
    let mut v = parse_entry(text);
    let has_user = v
        .get("username")
        .and_then(|x| x.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false);
    if !has_user {
        let basename = path.rsplit('/').next().unwrap_or("");
        if !basename.is_empty() {
            v["username"] = json!(basename);
        }
    }
    v
}

fn otp(req: Request) -> Response {
    let path = match req.args.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return Response::err(req.id, "otp: missing args.path"),
    };
    if !safe_path(path) {
        return Response::err(req.id, "otp: invalid path");
    }
    let store = req.args.get("store").and_then(|v| v.as_str());
    match run_pass_in(&["otp", path], store) {
        Ok(text) => Response::ok(req.id, json!({"otp": text.trim()})),
        Err(e) => Response::err(req.id, format!("pass otp: {e}")),
    }
}

pub fn parse_entry(text: &str) -> Value {
    let mut lines = text.lines();
    let password = lines.next().unwrap_or("").to_string();
    let mut fields: HashMap<String, String> = HashMap::new();
    let mut otp_url: Option<String> = None;
    let mut notes: Vec<String> = Vec::new();
    for raw in lines {
        let line = raw.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        if line.starts_with("otpauth://") {
            otp_url = Some(line.to_string());
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim().to_lowercase();
            let val = v.trim().to_string();
            if !key.is_empty() && !key.contains(' ') {
                fields.insert(key, val);
                continue;
            }
        }
        notes.push(line.to_string());
    }
    let username = ["login", "username", "user", "email", "mail"]
        .iter()
        .find_map(|k| fields.get(*k))
        .cloned()
        .unwrap_or_default();
    // browserpass URL key synonyms — first hit wins.
    let url = ["url", "link", "website", "web", "site"]
        .iter()
        .find_map(|k| fields.get(*k))
        .cloned()
        .unwrap_or_default();
    json!({
        "password": password,
        "username": username,
        "url": url,
        "otpUrl": otp_url,
        "fields": fields,
        "notes": notes,
    })
}
