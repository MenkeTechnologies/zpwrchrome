//! File-backed segmented download manager. Each `dl.add` invocation detaches
//! a worker process (`zpwrchrome-host --dl-worker <gid>`) that owns the
//! actual transfer. State for every job lives at
//! `${XDG_CACHE_HOME:-$HOME/.cache}/zpwrchrome/dl/gid_NNNNNN.json` so any
//! short-lived BP host invocation (`dl.list`, `dl.pause`, etc.) can query or
//! mutate state by reading/writing the same file.
//!
//! Wire shape (uses BP envelope but is NOT in upstream BP):
//!   dl.add     {url, dir?, name?, segments?, cookies?, userAgent?}
//!              → ok {gid, dest}
//!   dl.list    {}
//!              → ok {jobs: [JobState, ...]}
//!   dl.pause   {gid}
//!              → ok {gid, status: "paused"}
//!   dl.resume  {gid}
//!              → ok {gid, status: "resumed"}    (respawns worker if needed)
//!   dl.cancel  {gid}
//!              → ok {gid, status: "cancelled"}  (worker removes partial file)
//!
//! Errors use `InaccessiblePasswordStore` (code 13) for state-dir failures
//! and `InvalidPasswordStore` (code 20) for unknown gid lookups. Reuses BP
//! codes rather than inventing new ones so extension behavior stays inside
//! the existing wire vocabulary.
#![allow(non_snake_case, unused_assignments)]

use crate::ported::errors::{self, field};
use crate::ported::response;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const READ_CHUNK: usize = 64 * 1024;
const MIN_SEGMENT_BYTES: u64 = 1024 * 1024;
const DEFAULT_SEGMENTS: u32 = 6;
const MAX_RETRIES: u32 = 4;
const BASE_BACKOFF_MS: u64 = 200;
const STATE_FLUSH_INTERVAL: Duration = Duration::from_millis(250);
const FLAG_CHECK_INTERVAL: Duration = Duration::from_millis(100);

// ─── On-disk state ──────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct JobState {
    pub gid:        u64,
    pub url:        String,
    pub dest:       String,
    pub total:      u64,
    pub done:       u64,
    pub status:     String,         // pending|active|paused|done|failed|cancelled
    #[serde(default)]
    pub err:        Option<String>,
    pub segments:   u32,
    pub started_at: u64,            // unix seconds
    #[serde(default)]
    pub elapsed_ms: u64,
    /// Accumulated milliseconds spent in the paused state across the lifetime
    /// of this run. Subtracted from raw wall-clock to compute `elapsed_ms`,
    /// so a download paused for 30s for an hour and then resumed reports the
    /// active streaming time, not "1h30s". `#[serde(default)]` keeps older
    /// on-disk state files round-tripping unchanged.
    #[serde(default)]
    pub paused_offset_ms: u64,
    #[serde(default)]
    pub paused:     bool,
    #[serde(default)]
    pub cancelled:  bool,
    #[serde(default)]
    pub cookies:    String,
    #[serde(default, rename = "userAgent")]
    pub user_agent: String,
    /// PID of the worker process currently running this gid. Used by
    /// dl_resume to tell whether the existing worker is still alive (and
    /// will pick up paused=false on its own) or whether a fresh worker
    /// needs to be spawned because the previous one died.
    #[serde(default)]
    pub worker_pid: u32,
}

// Env-overridable cache dir. The XDG fallback chain matches `pass`.
pub fn cache_dir() -> std::io::Result<PathBuf> {
    if let Ok(p) = std::env::var("ZPWRCHROME_DL_CACHE_DIR") {
        let path = PathBuf::from(p);
        fs::create_dir_all(&path)?;
        return Ok(path);
    }
    let base = std::env::var("XDG_CACHE_HOME")
        .ok()
        .or_else(|| std::env::var("HOME").ok().map(|h| format!("{h}/.cache")))
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no XDG_CACHE_HOME/HOME"))?;
    let dir = PathBuf::from(base).join("zpwrchrome").join("dl");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn state_path(gid: u64) -> std::io::Result<PathBuf> {
    Ok(cache_dir()?.join(format!("gid_{gid:06}.json")))
}

pub fn read_state(gid: u64) -> std::io::Result<JobState> {
    let path = state_path(gid)?;
    let body = fs::read_to_string(&path)?;
    serde_json::from_str(&body)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

/// Atomic state-file write: serialize → tmp file → rename. Safe against
/// concurrent readers (rename is atomic on Unix).
pub fn write_state_atomic(state: &JobState) -> std::io::Result<()> {
    let path = state_path(state.gid)?;
    let tmp  = path.with_extension("json.tmp");
    let body = serde_json::to_vec_pretty(state)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    fs::write(&tmp, &body)?;
    fs::rename(tmp, path)?;
    Ok(())
}

/// Bump `next_gid` atomically. Uses an `O_EXCL` sentinel file as a
/// 5-second-timeout advisory lock. Sufficient for the low-contention case
/// of one `dl.add` per browser action.
pub fn next_gid() -> std::io::Result<u64> {
    let dir  = cache_dir()?;
    let lock = dir.join("lock");
    let start = Instant::now();
    loop {
        match fs::OpenOptions::new().write(true).create_new(true).open(&lock) {
            Ok(_) => break,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                if start.elapsed() > Duration::from_secs(5) {
                    return Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "lock timeout"));
                }
                thread::sleep(Duration::from_millis(10));
            }
            Err(e) => return Err(e),
        }
    }
    let result = (|| -> std::io::Result<u64> {
        let gid_file = dir.join("next_gid");
        let cur = fs::read_to_string(&gid_file).unwrap_or_else(|_| "1".to_string());
        let n: u64 = cur.trim().parse().unwrap_or(1);
        fs::write(&gid_file, format!("{}\n", n + 1))?;
        Ok(n)
    })();
    let _ = fs::remove_file(&lock);
    result
}

pub fn list_all_jobs() -> std::io::Result<Vec<JobState>> {
    let dir = cache_dir()?;
    let mut jobs = Vec::new();
    for entry in fs::read_dir(&dir)?.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if !name.starts_with("gid_") || !name.ends_with(".json") {
            continue;
        }
        if let Ok(body) = fs::read_to_string(&path) {
            if let Ok(job) = serde_json::from_str::<JobState>(&body) {
                jobs.push(job);
            }
        }
    }
    jobs.sort_by_key(|j| j.gid);
    Ok(jobs)
}

// ─── Filename helpers (exposed for tests + reused by the worker) ────────────

pub fn default_download_dir() -> PathBuf {
    // Match Chrome's "Downloads location" default so the toolbar 📁 button
    // opens the same folder where browser-initiated takeovers land.
    // Override with ZPWRCHROME_DL_DIR if the user wants a sandbox.
    if let Ok(p) = std::env::var("ZPWRCHROME_DL_DIR") {
        return expand_home(&p);
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join("Downloads");
    }
    PathBuf::from("./downloads")
}

/// Expand a leading `~` (or `~/`) to `$HOME`. Bare `~user` is not supported
/// (the host runs as the calling user only). Returns the input unchanged
/// when HOME is unset or the path doesn't start with `~`.
pub fn expand_home(p: &str) -> PathBuf {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(rest);
        }
    } else if p == "~" {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home);
        }
    }
    PathBuf::from(p)
}

pub fn guess_filename(url: &str) -> Option<String> {
    let trimmed = url.trim_end_matches('/');
    let after_scheme = trimmed.split("://").nth(1).unwrap_or(trimmed);
    let path = after_scheme.split('/').skip(1).collect::<Vec<_>>().join("/");
    let basename = path.rsplit('/').next().unwrap_or("");
    let no_query = basename.split('?').next().unwrap_or("");
    let no_frag  = no_query.split('#').next().unwrap_or("");
    if no_frag.is_empty() { return None; }
    if looks_like_query_garbage(no_frag) { return None; }
    let decoded = percent_decode(no_frag);
    Some(sanitize_filename(&decoded))
}

/// Heuristic: reject URL-derived basenames that look like opaque query
/// strings rather than real filenames. The worker will later rename the
/// dest using Content-Disposition from the HEAD response, so failing here
/// just buys us a clean "download-{ts}.bin" placeholder until then.
pub fn looks_like_query_garbage(s: &str) -> bool {
    let len = s.chars().count();
    if len == 0 || len > 80 { return true; }
    // Many query separators / equals signs = obviously a query string body.
    let amp_eq = s.chars().filter(|c| matches!(*c, '&' | '=')).count();
    if amp_eq >= 3 { return true; }
    // No extension at all (or extension is itself > 8 chars / has = & %) is suspect.
    let after_last_dot = s.rsplit('.').next().unwrap_or("");
    if !s.contains('.') { return true; }
    if after_last_dot.is_empty() || after_last_dot.len() > 8 { return true; }
    if after_last_dot.chars().any(|c| matches!(c, '=' | '&' | '%' | '?')) { return true; }
    false
}

/// Percent-decode `%xx` escapes; invalid sequences are left as literal.
pub fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let h = (bytes[i + 1] as char).to_digit(16);
            let l = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (h, l) {
                out.push(((h << 4) | l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Parse a filename out of a Content-Disposition header value. Handles:
/// * RFC 5987 extended form: `filename*=UTF-8''True%20Samples.zip`
/// * Quoted form:            `filename="True Samples.zip"`
/// * Bare form:              `filename=True_Samples.zip`
/// Strips any path components (defends against `filename=../etc/passwd`).
/// Returns None if no filename token is present.
pub fn parse_content_disposition_filename(header: &str) -> Option<String> {
    let mut best: Option<String> = None;
    let mut star: Option<String> = None;
    for part in header.split(';') {
        let part = part.trim();
        let lower = part.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("filename*=") {
            let orig = &part[part.len() - rest.len()..];
            let mut it = orig.splitn(3, '\'');
            let _charset = it.next().unwrap_or("");
            let _lang    = it.next().unwrap_or("");
            let value    = it.next().unwrap_or("");
            let decoded = percent_decode(value);
            star = Some(decoded);
        } else if let Some(rest) = lower.strip_prefix("filename=") {
            let orig = &part[part.len() - rest.len()..];
            let v = orig.trim_matches('"').trim();
            if !v.is_empty() { best = Some(v.to_string()); }
        }
    }
    // RFC 5987 says filename* takes precedence over filename.
    let raw = star.or(best)?;
    // Strip any path component to avoid traversal.
    let name = raw.rsplit(|c| c == '/' || c == '\\').next().unwrap_or("").to_string();
    if name.is_empty() { return None; }
    Some(sanitize_filename(&name))
}

/// Render a Chrono-style naming mask into a final filename.
///
/// Tokens (case-sensitive, asterisks literal):
///   `*name*`     — basename without extension
///   `*ext*`      — extension without dot (empty if none)
///   `*host*`     — URL hostname (no port)
///   `*url*`      — full URL path (slashes kept)
///   `*flat*`     — full URL path with slashes → underscores
///   `*subdirs*`  — URL path directories (no trailing slash)
///   `*date*`     — YYYY-MM-DD (UTC)
///   `*time*`     — HHMMSS (UTC)
///   `*size*`     — placeholder "?" (host doesn't know size at name time)
///
/// Unknown tokens are left literal. Returns the input verbatim if `mask`
/// is empty — callers can safely pass `&settings.namingMask` regardless
/// of whether it was set.
pub fn apply_naming_mask(mask: &str, basename: &str, url: &str) -> String {
    if mask.is_empty() { return basename.to_string(); }
    // Split basename into stem + extension.
    let (stem, ext) = match basename.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), e.to_string()),
        _ => (basename.to_string(), String::new()),
    };
    // Parse URL — best effort. Host = part between :// and next /:?#.
    let host = {
        let after = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
        let h = after.split(|c: char| matches!(c, '/' | '?' | '#' | ':')).next().unwrap_or("");
        h.to_string()
    };
    let path = {
        let after = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
        let p = after.splitn(2, '/').nth(1).unwrap_or("");
        p.split(|c: char| matches!(c, '?' | '#')).next().unwrap_or("").to_string()
    };
    let subdirs = match path.rsplit_once('/') {
        Some((d, _)) => d.to_string(),
        None         => String::new(),
    };
    let flat = path.replace('/', "_");

    // Current UTC time via libc::gmtime_r to avoid pulling chrono.
    let (date, time) = {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as libc::time_t).unwrap_or(0);
        #[cfg(unix)]
        unsafe {
            let mut tm: libc::tm = std::mem::zeroed();
            libc::gmtime_r(&t, &mut tm);
            (
                format!("{:04}-{:02}-{:02}", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday),
                format!("{:02}{:02}{:02}", tm.tm_hour, tm.tm_min, tm.tm_sec),
            )
        }
        #[cfg(not(unix))]
        { (String::from("0000-00-00"), String::from("000000")) }
    };

    mask
        .replace("*name*",    &stem)
        .replace("*ext*",     &ext)
        .replace("*host*",    &host)
        .replace("*url*",     &path)
        .replace("*flat*",    &flat)
        .replace("*subdirs*", &subdirs)
        .replace("*date*",    &date)
        .replace("*time*",    &time)
        .replace("*size*",    "?")
}

pub fn sanitize_filename(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect()
}

pub fn unique_dest_path(dir: &std::path::Path, basename: &str) -> PathBuf {
    let candidate = dir.join(basename);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match basename.rfind('.') {
        Some(i) if i > 0 => (&basename[..i], &basename[i..]),
        _ => (basename, ""),
    };
    for n in 1..=9999u32 {
        let cand = dir.join(format!("{stem} ({n}){ext}"));
        if !cand.exists() { return cand; }
    }
    candidate
}

// ─── Action handlers ────────────────────────────────────────────────────────

#[derive(Deserialize, Debug, Default)]
#[serde(default)]
pub struct DlRequest {
    pub action:   String,
    pub url:      String,
    pub dir:      String,
    pub name:     String,
    pub segments: Option<u32>,
    pub cookies:  String,
    #[serde(rename = "userAgent")]
    pub userAgent: String,
    pub gid:      u64,
    // Clear-action args:
    //   scope: "done" | "failed" | "missing" | "all"
    //   deleteFromDisk: also unlink the dest file for cleared `done` jobs
    pub scope: String,
    #[serde(rename = "deleteFromDisk")]
    pub deleteFromDisk: bool,
    /// Naming-mask template applied to the resolved filename before write.
    /// Supports tokens *name*, *ext*, *host*, *date*, *time*, *subdirs*,
    /// *flat*. Empty = use the filename verbatim.
    #[serde(default)]
    pub mask: String,
}

#[derive(Serialize, Debug)]
pub struct DlAddResponse    { pub gid: u64, pub dest: String }

#[derive(Serialize, Debug)]
pub struct DlListResponse   { pub jobs: Vec<JobView> }

/// Per-job view sent to the extension. Wraps JobState with computed
/// presence info (whether `dest` is still on disk) so the UI can hide
/// reveal/open actions for files the user deleted out of band.
#[derive(Serialize, Debug, Clone)]
pub struct JobView {
    #[serde(flatten)]
    pub state:       JobState,
    pub dest_exists: bool,
}

#[derive(Serialize, Debug)]
pub struct DlActionResponse { pub gid: u64, pub status: String }

#[derive(Serialize, Debug)]
pub struct DlClearResponse {
    pub cleared:        Vec<u64>,
    pub deletedOnDisk:  Vec<String>,
}

pub fn dispatch_dl(action: &str, value: &Value) {
    let req: DlRequest = serde_json::from_value(value.clone()).unwrap_or_default();
    match action {
        "dl.add"     => dl_add(&req),
        "dl.list"    => dl_list(),
        "dl.pause"   => dl_pause(&req),
        "dl.resume"  => dl_resume(&req),
        "dl.cancel"  => dl_cancel(&req),
        "dl.restart" => dl_restart(&req),
        "dl.clear"   => dl_clear(&req),
        "dl.remove"  => dl_remove(&req),
        "dl.openDir"        => dl_open_dir(&req),
        "dl.openFile"       => dl_open_file(&req),
        "dl.writeFile"      => dl_write_file(value),
        "dl.writeFileChunk" => dl_write_file_chunk(value),
        _ => {
            response::SendErrorAndExit(
                errors::Code::InvalidRequestAction,
                Some(response::params_of(&[
                    (field::MESSAGE, "Unknown dl action"),
                    (field::ACTION,  action),
                ])),
            );
        }
    }
}

pub fn dl_add(req: &DlRequest) {
    if req.url.is_empty() {
        response::SendErrorAndExit(
            errors::Code::InvalidRequestAction,
            Some(response::params_of(&[
                (field::MESSAGE, "dl.add: missing url"),
                (field::ACTION,  "dl.add"),
            ])),
        );
    }

    let dir = if req.dir.is_empty() {
        default_download_dir()
    } else {
        expand_home(&req.dir)
    };
    if let Err(e) = fs::create_dir_all(&dir) {
        response::SendErrorAndExit(
            errors::Code::InaccessiblePasswordStore,
            Some(response::params_of(&[
                (field::MESSAGE, "dl.add: cannot create download dir"),
                (field::ACTION,  "dl.add"),
                (field::ERROR,   &e.to_string()),
            ])),
        );
    }

    let name = if req.name.is_empty() {
        guess_filename(&req.url)
            .unwrap_or_else(|| format!("download-{}", now_secs()))
    } else {
        req.name.clone()
    };
    // Apply naming-mask template if the request carries one. Tokens
    // (*name*, *ext*, *host*, *date*, *time*, *subdirs*, *flat*, …) are
    // substituted using the URL + the resolved filename basename.
    let masked = apply_naming_mask(&req.mask, &name, &req.url);
    let dest = unique_dest_path(&dir, &sanitize_filename(&masked));

    let gid = match next_gid() {
        Ok(g) => g,
        Err(e) => {
            response::SendErrorAndExit(
                errors::Code::InaccessiblePasswordStore,
                Some(response::params_of(&[
                    (field::MESSAGE, "dl.add: next_gid failed"),
                    (field::ACTION,  "dl.add"),
                    (field::ERROR,   &e.to_string()),
                ])),
            );
        }
    };

    let segments = req.segments.unwrap_or(DEFAULT_SEGMENTS).clamp(1, 16);
    let state = JobState {
        gid,
        url:        req.url.clone(),
        dest:       dest.to_string_lossy().into_owned(),
        total:      0,
        done:       0,
        status:     "pending".into(),
        err:        None,
        segments,
        started_at: now_secs(),
        elapsed_ms: 0,
        paused_offset_ms: 0,
        paused:     false,
        cancelled:  false,
        cookies:    req.cookies.clone(),
        user_agent: req.userAgent.clone(),
        worker_pid: 0,
    };
    if let Err(e) = write_state_atomic(&state) {
        response::SendErrorAndExit(
            errors::Code::InaccessiblePasswordStore,
            Some(response::params_of(&[
                (field::MESSAGE, "dl.add: cannot write state file"),
                (field::ACTION,  "dl.add"),
                (field::ERROR,   &e.to_string()),
            ])),
        );
    }

    if let Err(e) = spawn_worker(gid) {
        response::SendErrorAndExit(
            errors::Code::InaccessiblePasswordStore,
            Some(response::params_of(&[
                (field::MESSAGE, "dl.add: cannot spawn worker"),
                (field::ACTION,  "dl.add"),
                (field::ERROR,   &e.to_string()),
            ])),
        );
    }

    response::SendOk(DlAddResponse { gid, dest: state.dest });
}

pub fn dl_list() {
    let jobs: Vec<JobView> = list_all_jobs().unwrap_or_default().into_iter().map(|s| {
        let dest_exists = !s.dest.is_empty() && std::path::Path::new(&s.dest).exists();
        JobView { state: s, dest_exists }
    }).collect();
    response::SendOk(DlListResponse { jobs });
}

pub fn dl_pause(req: &DlRequest) {
    mutate_state(req.gid, "dl.pause", |s| {
        s.paused = true;
        // Flip status to "paused" for any in-flight state — `pending` (user
        // clicked pause before the worker transitioned to active), `active`
        // (mid-stream), or even `paused` (idempotent). Terminal states
        // ("done", "cancelled", "failed") are left alone.
        if !matches!(s.status.as_str(), "done" | "cancelled" | "failed") {
            s.status = "paused".into();
        }
    });
    response::SendOk(DlActionResponse { gid: req.gid, status: "paused".into() });
}

/// Return true if a process with this PID still exists. `kill(pid, 0)`
/// performs no-op signal delivery; success = process alive, ESRCH = gone.
/// Returns false for pid==0 (never claimed).
#[cfg(unix)]
fn worker_alive(pid: u32) -> bool {
    if pid == 0 { return false; }
    unsafe { libc::kill(pid as i32, 0) == 0 }
}
#[cfg(not(unix))]
fn worker_alive(_pid: u32) -> bool { false }   // be conservative; respawn

/// Hard-stop a live worker so a restart can reset the file without two
/// processes writing the same dest. SIGTERM with no handler in the worker
/// terminates it immediately — no further writes after this returns.
#[cfg(unix)]
fn kill_worker(pid: u32) {
    if pid != 0 { unsafe { libc::kill(pid as i32, libc::SIGTERM); } }
}
#[cfg(not(unix))]
fn kill_worker(_pid: u32) {}

pub fn dl_resume(req: &DlRequest) {
    // Two cases trigger a fresh worker spawn:
    //   1. The previous run reached a terminal state (failed / cancelled)
    //      and explicitly exited.
    //   2. The state says "paused" but the worker PID is dead — happens
    //      when the SW is suspended / Chrome closed / system slept and
    //      the parent host's detached child got reaped. The state file
    //      remains, so the user sees "paused" but no one is listening
    //      for the paused=false flip.
    let (need_spawn, prior_pid, prior_status) = match read_state(req.gid) {
        Ok(s) => {
            let terminal = matches!(s.status.as_str(), "failed" | "cancelled");
            let dead     = !worker_alive(s.worker_pid);
            let need     = terminal || dead;
            (need, s.worker_pid, s.status)
        }
        Err(_) => (false, 0, String::new()),
    };
    crate::diag::log(&format!(
        "RESUME gid={} prior_status={} prior_pid={} need_spawn={}",
        req.gid, prior_status, prior_pid, need_spawn,
    ));
    mutate_state(req.gid, "dl.resume", |s| {
        s.paused = false;
        s.cancelled = false;
        if s.status == "paused" || s.status == "failed" || s.status == "cancelled" {
            s.status = "pending".into();
            s.err = None;
        }
    });
    if need_spawn {
        if let Err(e) = spawn_worker(req.gid) {
            crate::diag::log(&format!("RESUME_SPAWN_ERR gid={} err={e}", req.gid));
        }
    }
    response::SendOk(DlActionResponse { gid: req.gid, status: "resumed".into() });
}

pub fn dl_cancel(req: &DlRequest) {
    mutate_state(req.gid, "dl.cancel", |s| {
        s.cancelled = true;
        s.status = "cancelled".into();
    });
    response::SendOk(DlActionResponse { gid: req.gid, status: "cancelled".into() });
}

/// Re-download from byte zero, whatever the current status.
///
/// Distinct from `dl.resume`, which continues a paused/failed job from where
/// it left off: restart discards the partial (or supposedly-complete) file
/// and starts a clean download. This is the recovery path for a job that was
/// stamped "done" on a truncated file, or any time the user wants a fresh
/// copy. Works from done / failed / cancelled / paused / active.
pub fn dl_restart(req: &DlRequest) {
    let (dest, prior_pid) = match read_state(req.gid) {
        Ok(s) => (s.dest.clone(), s.worker_pid),
        Err(_) => {
            response::SendErrorAndExit(
                errors::Code::InvalidPasswordStore,
                Some(response::params_of(&[
                    (field::MESSAGE,  "Unknown gid"),
                    (field::ACTION,   "dl.restart"),
                    (field::STORE_ID, &req.gid.to_string()),
                ])),
            );
        }
    };
    // Stop any live worker BEFORE touching the file, so the old and new
    // workers never write the same dest at once.
    if worker_alive(prior_pid) {
        kill_worker(prior_pid);
    }
    // Throw away the partial/old bytes; the fresh worker re-probes and
    // re-downloads from scratch.
    let _ = fs::remove_file(&dest);
    mutate_state(req.gid, "dl.restart", |s| {
        s.done = 0;
        s.status = "pending".into();
        s.err = None;
        s.paused = false;
        s.cancelled = false;
        s.elapsed_ms = 0;
        s.paused_offset_ms = 0;
        s.started_at = now_secs();
        s.worker_pid = 0;
    });
    if let Err(e) = spawn_worker(req.gid) {
        crate::diag::log(&format!("RESTART_SPAWN_ERR gid={} err={e}", req.gid));
    }
    response::SendOk(DlActionResponse { gid: req.gid, status: "restarted".into() });
}

// Clear state files in bulk. scope picks which jobs:
//   "done"    — successfully finished
//   "failed"  — status=failed OR status=cancelled
//   "missing" — done job whose dest no longer exists on disk
//   "all"     — every state file
// deleteFromDisk additionally unlinks the dest file for any "done" job
// being cleared (redundant for the other scopes — cancelled jobs already
// unlinked, failed never finished writing).
// Open a directory (or reveal a file's parent dir) in the platform file
// manager. Used by the UI's "Open downloads folder" button + per-row reveal.
// Path comes from the extension; expand `~` here so the user never sees a
// literal `~` rendered in the response.
pub fn dl_open_dir(req: &DlRequest) {
    // Two modes:
    //   * empty req.dir          → open the default-download directory
    //                              (auto-create OK; it's the host's own dir).
    //   * non-empty req.dir      → "reveal" a specific file or folder. NEVER
    //                              auto-create — that would expose a "fake"
    //                              folder the user never had. Verify the
    //                              path actually exists and refuse otherwise.
    let opener = if cfg!(target_os = "macos") { "open" }
                 else if cfg!(target_os = "windows") { "explorer" }
                 else { "xdg-open" };

    if req.dir.is_empty() {
        let target = default_download_dir();
        let _ = fs::create_dir_all(&target);
        match Command::new(opener).arg(&target).spawn() {
            Ok(_) => response::SendOk(serde_json::json!({ "opened": target.to_string_lossy() })),
            Err(e) => response::SendErrorAndExit(
                errors::Code::InaccessiblePasswordStore,
                Some(response::params_of(&[
                    (field::MESSAGE, "dl.openDir: failed to spawn opener"),
                    (field::ACTION,  "dl.openDir"),
                    (field::ERROR,   &e.to_string()),
                ])),
            ),
        }
    }

    let raw = expand_home(&req.dir);
    let raw_path = std::path::Path::new(&raw);
    if !raw_path.exists() {
        response::SendErrorAndExit(
            errors::Code::InaccessiblePasswordStore,
            Some(response::params_of(&[
                (field::MESSAGE, "dl.openDir: path does not exist (file deleted or moved)"),
                (field::ACTION,  "dl.openDir"),
                (field::ERROR,   &raw.to_string_lossy()),
            ])),
        );
    }
    // Reveal mode: open the containing folder of a file, or the folder itself.
    let target = if raw_path.is_file() {
        raw_path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| raw_path.to_path_buf())
    } else {
        raw_path.to_path_buf()
    };
    if !target.exists() {
        response::SendErrorAndExit(
            errors::Code::InaccessiblePasswordStore,
            Some(response::params_of(&[
                (field::MESSAGE, "dl.openDir: parent folder no longer exists"),
                (field::ACTION,  "dl.openDir"),
                (field::ERROR,   &target.to_string_lossy()),
            ])),
        );
    }
    match Command::new(opener).arg(&target).spawn() {
        Ok(_) => response::SendOk(serde_json::json!({ "opened": target.to_string_lossy() })),
        Err(e) => response::SendErrorAndExit(
            errors::Code::InaccessiblePasswordStore,
            Some(response::params_of(&[
                (field::MESSAGE, "dl.openDir: failed to spawn opener"),
                (field::ACTION,  "dl.openDir"),
                (field::ERROR,   &e.to_string()),
            ])),
        ),
    }
}

/// Open a file with the platform's default application (Finder/Explorer
/// associates extension → app). Used by the "open" button on done rows.
/// Refuses to open a file that no longer exists — never silently create.
/// Write a raw byte buffer (received as base64 from the extension) to a
/// file under `dir/name`. Used by the screenshot feature to land its PNG
/// in the user-configured download directory without going through
/// chrome.downloads.download (which can't override the browser's default
/// downloads folder). Uses unique_dest_path so existing files aren't
/// clobbered. dir empty = host default download dir.
pub fn dl_write_file(value: &Value) {
    #[derive(Deserialize)]
    struct WriteReq {
        #[serde(default)] dir:    String,
        #[serde(default)] name:   String,
        #[serde(default)] base64: String,
    }
    let req: WriteReq = match serde_json::from_value(value.clone()) {
        Ok(r) => r,
        Err(e) => {
            response::SendErrorAndExit(
                errors::Code::ParseRequest,
                Some(response::params_of(&[
                    (field::MESSAGE, "dl.writeFile: malformed request"),
                    (field::ACTION,  "dl.writeFile"),
                    (field::ERROR,   &e.to_string()),
                ])),
            );
        }
    };
    if req.name.is_empty() {
        response::SendErrorAndExit(
            errors::Code::InvalidRequestAction,
            Some(response::params_of(&[
                (field::MESSAGE, "dl.writeFile: missing name"),
                (field::ACTION,  "dl.writeFile"),
            ])),
        );
    }
    let bytes = match base64_decode(&req.base64) {
        Ok(b) => b,
        Err(e) => {
            response::SendErrorAndExit(
                errors::Code::ParseRequest,
                Some(response::params_of(&[
                    (field::MESSAGE, "dl.writeFile: bad base64"),
                    (field::ACTION,  "dl.writeFile"),
                    (field::ERROR,   &e),
                ])),
            );
        }
    };
    let dir = if req.dir.is_empty() {
        default_download_dir()
    } else {
        expand_home(&req.dir)
    };
    if let Err(e) = fs::create_dir_all(&dir) {
        response::SendErrorAndExit(
            errors::Code::InaccessiblePasswordStore,
            Some(response::params_of(&[
                (field::MESSAGE, "dl.writeFile: cannot create dir"),
                (field::ACTION,  "dl.writeFile"),
                (field::ERROR,   &e.to_string()),
            ])),
        );
    }
    let dest = unique_dest_path(&dir, &sanitize_filename(&req.name));
    if let Err(e) = fs::write(&dest, &bytes) {
        response::SendErrorAndExit(
            errors::Code::InaccessiblePasswordStore,
            Some(response::params_of(&[
                (field::MESSAGE, "dl.writeFile: write failed"),
                (field::ACTION,  "dl.writeFile"),
                (field::ERROR,   &e.to_string()),
            ])),
        );
    }
    crate::diag::log(&format!("WRITE_FILE dest={} bytes={}", dest.display(), bytes.len()));
    response::SendOk(serde_json::json!({
        "dest":  dest.to_string_lossy(),
        "bytes": bytes.len(),
    }));
}

/// Minimal RFC 4648 base64 decoder (no padding required). The extension
/// passes raw base64 — keep this self-contained to avoid a base64 crate.
fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for c in s.bytes() {
        let v: u32 = match c {
            b'A'..=b'Z' => (c - b'A') as u32,
            b'a'..=b'z' => (c - b'a' + 26) as u32,
            b'0'..=b'9' => (c - b'0' + 52) as u32,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'='        => continue,
            b' ' | b'\n' | b'\r' | b'\t' => continue,
            other       => return Err(format!("invalid base64 byte 0x{:02x}", other)),
        };
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Ok(out)
}

/// Streaming counterpart to dl.writeFile for payloads bigger than Chrome's
/// native-messaging per-message cap (~1 MB). The extension generates a
/// session id, splits the base64 across N requests, and sends each chunk
/// with `sessionId` set. The first chunk (chunkIndex == 0) creates a
/// `~/.cache/zpwrchrome/dl/upload-<sessionId>.part` scratch file; later
/// chunks append. The final request carries `final: true` plus `dir` +
/// `name` and triggers rename to the user-visible destination via
/// unique_dest_path.
pub fn dl_write_file_chunk(value: &Value) {
    #[derive(Deserialize)]
    struct ChunkReq {
        #[serde(default)] sessionId:  String,
        #[serde(default)] chunkIndex: u32,
        #[serde(default)] base64:     String,
        #[serde(default)] final_:     bool,   // serde renamed below
        #[serde(default)] dir:        String,
        #[serde(default)] name:       String,
    }
    // serde gets `final` from JSON which collides with the Rust keyword.
    // Patch the Value to rename "final" → "final_" so the struct above
    // accepts it without `#[serde(rename)]` attribute juggling.
    let mut v = value.clone();
    if let Value::Object(ref mut m) = v {
        if let Some(b) = m.remove("final") {
            m.insert("final_".into(), b);
        }
    }
    let req: ChunkReq = match serde_json::from_value(v) {
        Ok(r) => r,
        Err(e) => {
            response::SendErrorAndExit(
                errors::Code::ParseRequest,
                Some(response::params_of(&[
                    (field::MESSAGE, "dl.writeFileChunk: malformed request"),
                    (field::ACTION,  "dl.writeFileChunk"),
                    (field::ERROR,   &e.to_string()),
                ])),
            );
        }
    };
    if req.sessionId.is_empty() {
        response::SendErrorAndExit(
            errors::Code::InvalidRequestAction,
            Some(response::params_of(&[
                (field::MESSAGE, "dl.writeFileChunk: missing sessionId"),
                (field::ACTION,  "dl.writeFileChunk"),
            ])),
        );
    }
    let bytes = match base64_decode(&req.base64) {
        Ok(b) => b,
        Err(e) => {
            response::SendErrorAndExit(
                errors::Code::ParseRequest,
                Some(response::params_of(&[
                    (field::MESSAGE, "dl.writeFileChunk: bad base64"),
                    (field::ACTION,  "dl.writeFileChunk"),
                    (field::ERROR,   &e),
                ])),
            );
        }
    };
    let cache = match cache_dir() {
        Ok(p) => p,
        Err(e) => {
            response::SendErrorAndExit(
                errors::Code::InaccessiblePasswordStore,
                Some(response::params_of(&[
                    (field::MESSAGE, "dl.writeFileChunk: cannot resolve cache dir"),
                    (field::ACTION,  "dl.writeFileChunk"),
                    (field::ERROR,   &e.to_string()),
                ])),
            );
        }
    };
    // Sanitize sessionId so it can't traverse out of the cache dir.
    let safe_sid: String = req.sessionId.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64).collect();
    if safe_sid.is_empty() {
        response::SendErrorAndExit(
            errors::Code::InvalidRequestAction,
            Some(response::params_of(&[
                (field::MESSAGE, "dl.writeFileChunk: invalid sessionId"),
                (field::ACTION,  "dl.writeFileChunk"),
            ])),
        );
    }
    let part_path = cache.join(format!("upload-{safe_sid}.part"));

    // First chunk: create + write. Subsequent: append. Either way use
    // OpenOptions so the offset is correct without seeking.
    let mut f_open = fs::OpenOptions::new();
    if req.chunkIndex == 0 {
        f_open.create(true).truncate(true).write(true);
    } else {
        f_open.create(true).append(true);
    }
    if let Err(e) = f_open.open(&part_path)
        .and_then(|mut f| f.write_all(&bytes))
    {
        response::SendErrorAndExit(
            errors::Code::InaccessiblePasswordStore,
            Some(response::params_of(&[
                (field::MESSAGE, "dl.writeFileChunk: cannot append chunk"),
                (field::ACTION,  "dl.writeFileChunk"),
                (field::ERROR,   &e.to_string()),
            ])),
        );
    }

    if !req.final_ {
        // More chunks coming — ack receipt and return early. SendOk doesn't
        // exit the process; if we fell through, the final-chunk block below
        // would delete the .part file we just wrote.
        response::SendOk(serde_json::json!({
            "sessionId":  safe_sid,
            "chunkIndex": req.chunkIndex,
            "received":   bytes.len(),
            "final":      false,
        }));
        return;
    }

    // Final chunk — move the .part file to its destination dir/name.
    if req.name.is_empty() {
        let _ = fs::remove_file(&part_path);
        response::SendErrorAndExit(
            errors::Code::InvalidRequestAction,
            Some(response::params_of(&[
                (field::MESSAGE, "dl.writeFileChunk: final chunk missing name"),
                (field::ACTION,  "dl.writeFileChunk"),
            ])),
        );
    }
    let target_dir = if req.dir.is_empty() {
        default_download_dir()
    } else {
        expand_home(&req.dir)
    };
    if let Err(e) = fs::create_dir_all(&target_dir) {
        let _ = fs::remove_file(&part_path);
        response::SendErrorAndExit(
            errors::Code::InaccessiblePasswordStore,
            Some(response::params_of(&[
                (field::MESSAGE, "dl.writeFileChunk: cannot create target dir"),
                (field::ACTION,  "dl.writeFileChunk"),
                (field::ERROR,   &e.to_string()),
            ])),
        );
    }
    let dest = unique_dest_path(&target_dir, &sanitize_filename(&req.name));
    if let Err(e) = fs::rename(&part_path, &dest) {
        // rename across mount points fails on Linux; fall back to copy + remove.
        if let Err(e2) = fs::copy(&part_path, &dest).and_then(|_| fs::remove_file(&part_path)) {
            response::SendErrorAndExit(
                errors::Code::InaccessiblePasswordStore,
                Some(response::params_of(&[
                    (field::MESSAGE, "dl.writeFileChunk: cannot move part file to dest"),
                    (field::ACTION,  "dl.writeFileChunk"),
                    (field::ERROR,   &format!("rename: {e}; copy: {e2}")),
                ])),
            );
        }
    }
    let bytes_total = fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    crate::diag::log(&format!(
        "WRITE_FILE_CHUNK_FINAL dest={} sessionId={} bytes={}",
        dest.display(), safe_sid, bytes_total
    ));
    response::SendOk(serde_json::json!({
        "sessionId":  safe_sid,
        "chunkIndex": req.chunkIndex,
        "final":      true,
        "dest":       dest.to_string_lossy(),
        "bytes":      bytes_total,
    }));
}

pub fn dl_open_file(req: &DlRequest) {
    if req.dir.is_empty() {
        response::SendErrorAndExit(
            errors::Code::InvalidRequestAction,
            Some(response::params_of(&[
                (field::MESSAGE, "dl.openFile: missing path"),
                (field::ACTION,  "dl.openFile"),
            ])),
        );
    }
    let raw  = expand_home(&req.dir);
    let path = std::path::Path::new(&raw);
    if !path.is_file() {
        response::SendErrorAndExit(
            errors::Code::InaccessiblePasswordStore,
            Some(response::params_of(&[
                (field::MESSAGE, "dl.openFile: file does not exist (deleted or moved)"),
                (field::ACTION,  "dl.openFile"),
                (field::ERROR,   &raw.to_string_lossy()),
            ])),
        );
    }
    let opener = if cfg!(target_os = "macos") { "open" }
                 else if cfg!(target_os = "windows") { "explorer" }
                 else { "xdg-open" };
    match Command::new(opener).arg(&raw).spawn() {
        Ok(_) => response::SendOk(serde_json::json!({ "opened": raw.to_string_lossy() })),
        Err(e) => response::SendErrorAndExit(
            errors::Code::InaccessiblePasswordStore,
            Some(response::params_of(&[
                (field::MESSAGE, "dl.openFile: failed to spawn opener"),
                (field::ACTION,  "dl.openFile"),
                (field::ERROR,   &e.to_string()),
            ])),
        ),
    }
}

/// Remove a single job by gid: cancel the underlying worker if it's
/// still in flight, then delete the gid state file. The dest file on
/// disk is intentionally left alone — the user can re-trigger the
/// download or hand-delete the bytes themselves.
pub fn dl_remove(req: &DlRequest) {
    // Best-effort cancel — flag the running worker so it stops on its
    // next check_control. If the worker is already gone, this just
    // mutates the state file we're about to delete anyway.
    let _ = mutate_state(req.gid, "dl.remove", |s| {
        s.cancelled = true;
        s.status = "cancelled".into();
    });
    // Give the worker (if any) a moment to notice cancellation before we
    // yank the state file out from under it. FLAG_CHECK_INTERVAL is the
    // worker's poll cadence; one cycle is sufficient.
    std::thread::sleep(FLAG_CHECK_INTERVAL);

    match state_path(req.gid) {
        Ok(p) => {
            let _ = fs::remove_file(&p);
            crate::diag::log(&format!("REMOVE gid={} state_path={}", req.gid, p.display()));
            response::SendOk(DlActionResponse { gid: req.gid, status: "removed".into() });
        }
        Err(e) => {
            response::SendErrorAndExit(
                errors::Code::InaccessiblePasswordStore,
                Some(response::params_of(&[
                    (field::MESSAGE, "dl.remove: cannot resolve state path"),
                    (field::ACTION,  "dl.remove"),
                    (field::ERROR,   &e.to_string()),
                ])),
            );
        }
    }
}

pub fn dl_clear(req: &DlRequest) {
    let jobs = list_all_jobs().unwrap_or_default();
    let scope = req.scope.as_str();
    let mut cleared:        Vec<u64>    = Vec::new();
    let mut deleted_on_disk: Vec<String> = Vec::new();

    for job in jobs {
        let dest_exists = std::path::Path::new(&job.dest).exists();
        let matches = match scope {
            "done"    => job.status == "done",
            "failed"  => job.status == "failed" || job.status == "cancelled",
            "missing" => job.status == "done" && !dest_exists,
            "all"     => true,
            _         => false,
        };
        if !matches { continue; }

        if req.deleteFromDisk && job.status == "done" && dest_exists {
            if std::fs::remove_file(&job.dest).is_ok() {
                deleted_on_disk.push(job.dest.clone());
            }
        }
        if let Ok(path) = state_path(job.gid) {
            let _ = std::fs::remove_file(path);
        }
        cleared.push(job.gid);
    }

    response::SendOk(DlClearResponse { cleared, deletedOnDisk: deleted_on_disk });
}

fn mutate_state(gid: u64, action: &str, f: impl FnOnce(&mut JobState)) {
    // O_EXCL lockfile per-gid. Each `chrome.runtime.sendNativeMessage` call
    // spawns a fresh host process, so concurrent dl.pause / dl.resume on the
    // same gid would otherwise race their read-modify-write — the loser's
    // read sees pre-winner disk and its write clobbers the winner. The lock
    // serializes mutate_state across processes; the worker's check_control
    // / flush_progress / flush_status do their own merging and don't need
    // to share this lock.
    let lock = with_gid_lock(gid);
    let mut state = match read_state(gid) {
        Ok(s) => s,
        Err(_) => {
            drop(lock);
            response::SendErrorAndExit(
                errors::Code::InvalidPasswordStore,
                Some(response::params_of(&[
                    (field::MESSAGE,  "Unknown gid"),
                    (field::ACTION,   action),
                    (field::STORE_ID, &gid.to_string()),
                ])),
            );
        }
    };
    f(&mut state);
    if let Err(e) = write_state_atomic(&state) {
        drop(lock);
        response::SendErrorAndExit(
            errors::Code::InaccessiblePasswordStore,
            Some(response::params_of(&[
                (field::MESSAGE, "cannot write state file"),
                (field::ACTION,  action),
                (field::ERROR,   &e.to_string()),
            ])),
        );
    }
    drop(lock);
}

/// Cross-process per-gid lock for `mutate_state`. Holds an `O_EXCL` lockfile
/// at `<cache>/gid_NNNNNN.mlock` for the duration of the returned guard.
/// On `drop`, the lockfile is removed. Same retry pattern as `next_gid`'s
/// dir-level lock — bounded 5-second wait, 10 ms polling.
struct GidLock { path: PathBuf }
impl Drop for GidLock {
    fn drop(&mut self) { let _ = fs::remove_file(&self.path); }
}
fn with_gid_lock(gid: u64) -> Option<GidLock> {
    let dir = match cache_dir() { Ok(d) => d, Err(_) => return None };
    let path = dir.join(format!("gid_{gid:06}.mlock"));
    let start = Instant::now();
    loop {
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(_) => return Some(GidLock { path }),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                if start.elapsed() > Duration::from_secs(5) {
                    // Stale lock from a crashed process. Reap and retry once.
                    let _ = fs::remove_file(&path);
                    continue;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(_) => return None,   // best-effort; mutate_state still proceeds
        }
    }
}

// Spawn detached worker. On Unix, redirecting stdio decouples the worker
// from the parent's stdin/stdout (which Chrome will close when the BP host
// replies). The child becomes a child of init when parent exits.
fn spawn_worker(gid: u64) -> std::io::Result<()> {
    let exe = std::env::current_exe()?;
    crate::diag::log(&format!("SPAWN_WORKER gid={gid} exe={}", exe.display()));
    let log_path = cache_dir()?.join("worker.log");
    let log = fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(&log_path)?;
    let null = fs::OpenOptions::new().read(true).open("/dev/null")?;
    let mut cmd = Command::new(exe);
    cmd.args(["--dl-worker", &gid.to_string()])
        .stdin(Stdio::from(null))
        .stdout(Stdio::from(log.try_clone()?))
        .stderr(Stdio::from(log));
    // Detach the worker from the parent host process group + close every
    // inherited file descriptor above the std fds. Chrome's native-messaging
    // stdio pipe is given to the host as FD 1; without this, the worker
    // inherits a dup of that pipe, Chrome never sees EOF on its read end,
    // and reports "Native host has exited" even on a successful response.
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        cmd.pre_exec(|| {
            // New session — survive the parent host exit.
            if libc::setsid() == -1 {
                // Already a session leader → not fatal.
            }
            // Close every FD >= 3 in the worker child. Std uses CLOEXEC on
            // most opens since Rust 1.7, but Chrome's pipe-to-stdout dup is
            // a kernel-level inheritance we can't tag — only the brute close
            // sweep guarantees the worker holds none of Chrome's FDs.
            let max_fd = match libc::sysconf(libc::_SC_OPEN_MAX) {
                n if n > 0 => n as i32,
                _          => 1024,
            };
            for fd in 3..max_fd {
                libc::close(fd);
            }
            Ok(())
        });
    }
    let child = cmd.spawn()?;
    crate::diag::log(&format!("SPAWN_WORKER_OK gid={gid} child_pid={}", child.id()));
    Ok(())
}

// ─── Worker process ─────────────────────────────────────────────────────────

pub fn run_worker(gid: u64) -> std::io::Result<()> {
    crate::diag::log(&format!("WORKER_START gid={gid} pid={}", std::process::id()));
    let mut state = read_state(gid)?;
    state.status = "active".into();
    let start_instant = Instant::now();
    state.elapsed_ms = 0;
    // Claim ownership of this gid — dl_resume reads this and uses
    // worker_alive() to decide whether to respawn.
    state.worker_pid = std::process::id();
    // flush_worker (not write_state_atomic) so a dl.pause / dl.cancel that
    // landed between dl.add and this point isn't clobbered. We're
    // authoritative for status here; paused/cancelled come from disk.
    flush_worker(&state)?;
    // Re-sync our local view of paused/cancelled from disk so the rest of
    // run_worker (probe → run_segmented/single → terminal) sees the same
    // truth check_control would.
    if let Ok(disk) = read_state(gid) {
        state.paused    = disk.paused;
        state.cancelled = disk.cancelled;
    }

    // Probe headers. Try HEAD first; some CDNs (GitHub release assets
    // redirect to objects.githubusercontent.com pre-signed S3 URLs that
    // reject HEAD with 401 because the signature was computed for GET).
    // Fall back to a `Range: bytes=0-0` GET — that returns the first byte
    // plus a Content-Range header from which we recover the total size,
    // and confirms Range support all in one round-trip.
    let probe = probe_headers(&state.url, &state.cookies, &state.user_agent);
    let probe = match probe {
        Ok(p) => p,
        Err(e) => return finish_err(&mut state, format!("HEAD: {e}")),
    };
    let accept_ranges = probe.accept_ranges;
    // A re-probe (notably after dl.restart) can come back sizeless when the
    // server streams the file without a Content-Length on HEAD or the Range
    // GET. Keep the size we already knew rather than dropping the UI to "/ ?"
    // and — critically — disarming the truncation gate, which is gated on
    // total > 0. For a first run state.total is 0, so this is a no-op there.
    let total = if probe.total > 0 { probe.total } else { state.total };
    state.total = total;

    // Rename dest to a Content-Disposition-derived name when (a) the server
    // gave one and (b) the dest file hasn't been touched yet. This fixes
    // CDN URLs whose path is all query-string and Chrome's onCreated didn't
    // populate a sensible filename. Refuse to rename if the dest file
    // already exists with data (rare race), to avoid losing partial bytes.
    if let Some(srv_name) = probe.content_disposition_filename {
        let cur_name = std::path::Path::new(&state.dest)
            .file_name().and_then(|n| n.to_str()).unwrap_or("");
        let is_placeholder = cur_name.starts_with("download-")
            || looks_like_query_garbage(cur_name);
        let dest_path = std::path::Path::new(&state.dest);
        let already_has_data = match fs::metadata(dest_path) {
            Ok(m) => m.len() > 0,
            Err(_) => false,
        };
        if !already_has_data && (cur_name != srv_name || is_placeholder) {
            let parent = dest_path.parent()
                .unwrap_or(std::path::Path::new("."))
                .to_path_buf();
            let new_dest = unique_dest_path(&parent, &srv_name);
            crate::diag::log(&format!(
                "WORKER_RENAME gid={} from={} to={}",
                state.gid, cur_name, new_dest.display(),
            ));
            state.dest = new_dest.to_string_lossy().into_owned();
        }
    }
    flush_worker(&state)?;
    // Re-sync paused/cancelled from disk after the probe (could be ~seconds).
    if let Ok(disk) = read_state(gid) {
        state.paused    = disk.paused;
        state.cancelled = disk.cancelled;
    }
    // If the user cancelled while we were probing, surface that immediately
    // — running run_segmented/single only to bail seconds later wastes their
    // bandwidth. The terminal-decision block below handles cleanup; jumping
    // there directly via a tagged dummy result keeps one exit path.
    let cancelled_during_probe = state.cancelled;

    let do_segments = total >= MIN_SEGMENT_BYTES && accept_ranges && state.segments > 1;
    let result = if cancelled_during_probe {
        Ok(())   // skip the download — terminal block below sees cancelled=true and writes "cancelled"
    } else if do_segments {
        run_segmented(&mut state, total, start_instant)
    } else {
        run_single(&mut state, total, accept_ranges, start_instant)
    };
    // Re-read disk before deciding the terminal status. Segmented downloads
    // only see the cancelled flag in their per-thread disk reads; the local
    // `state.cancelled` set by run_single's stream_into_file does not exist
    // in the segmented path, so without this re-read a cancel that arrives
    // after the segments completed would get clobbered to status="done".
    if let Ok(disk) = read_state(state.gid) {
        state.cancelled       = disk.cancelled || state.cancelled;
        state.paused_offset_ms = disk.paused_offset_ms.max(state.paused_offset_ms);
    }
    match result {
        Ok(()) => {
            if state.cancelled {
                state.status = "cancelled".into();
                state.elapsed_ms = effective_elapsed_ms(start_instant, state.paused_offset_ms);
                let _ = flush_worker(&state);
                // Remove the partial bytes on disk, but keep the state file
                // so the row stays visible under the "cancelled" filter — the
                // user can clear it explicitly from there.
                let _ = fs::remove_file(&state.dest);
            } else if total > 0 && state.done < total {
                // Defense in depth: a download path returned Ok(()) but fewer
                // bytes than Content-Length actually landed on disk. This is
                // how truncated responses (server/CDN closing the connection
                // early on a multi-GB file) used to render as "DONE  10.2 GB /
                // 12.2 GB (83%)". Never stamp "done" on a short file — surface
                // it as failed so the user retries instead of trusting a
                // corrupt archive.
                state.elapsed_ms = effective_elapsed_ms(start_instant, state.paused_offset_ms);
                let done = state.done;
                let pct = done * 100 / total;   // total > 0 guaranteed by the branch guard
                let _ = finish_err(&mut state,
                    format!("incomplete: {done} of {total} bytes ({pct}%)"));
            } else {
                state.status = "done".into();
                state.elapsed_ms = effective_elapsed_ms(start_instant, state.paused_offset_ms);
                let _ = flush_worker(&state);
            }
        }
        Err(e) => { let _ = finish_err(&mut state, e); }
    }
    Ok(())
}

struct ProbeResult {
    total:                        u64,
    accept_ranges:                bool,
    content_disposition_filename: Option<String>,
}

/// Discover Content-Length + Range support + Content-Disposition for a URL.
///
/// Tries HEAD first. If HEAD fails or returns non-2xx (common on
/// pre-signed CDN URLs — e.g. GitHub redirects release downloads to
/// objects.githubusercontent.com S3 URLs whose signature is bound to
/// the GET method, so HEAD comes back 401), falls back to a
/// `Range: bytes=0-0` GET. A 206 response gives us:
///   - `Content-Range: bytes 0-0/{total}` — real total via the suffix
///   - `Content-Length: 1` — the one byte requested
///   - And confirms the server supports byte-Range, even if it omits
///     Accept-Ranges (some servers do).
/// A 200 response from the Range GET means the server ignored the Range
/// header; Content-Length is the full size and Range is unsupported.
fn probe_headers(url: &str, cookies: &str, user_agent: &str) -> Result<ProbeResult, String> {
    fn apply_headers(mut r: ureq::Request, cookies: &str, user_agent: &str) -> ureq::Request {
        if !cookies.is_empty()    { r = r.set("Cookie", cookies); }
        if !user_agent.is_empty() { r = r.set("User-Agent", user_agent); }
        r
    }
    // First attempt: HEAD. A HEAD that succeeds but omits Content-Length
    // (streamed downloads behind X-Accel-Redirect / X-Sendfile expose the
    // size only on the actual GET) must NOT short-circuit size discovery —
    // keep what HEAD gave us as defaults and fall through to the Range GET,
    // which recovers the total from Content-Range (206) or Content-Length
    // (200). Returning total=0 here is what blanked restarted downloads to
    // "/ ?" and silently disarmed the truncation gate.
    let mut head_accept_ranges = false;
    let mut head_cd: Option<String> = None;
    let head_req = apply_headers(ureq::head(url), cookies, user_agent);
    if let Ok(resp) = head_req.call() {
        let total = resp.header("Content-Length")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        head_accept_ranges = resp.header("Accept-Ranges")
            .map(|v| v.eq_ignore_ascii_case("bytes"))
            .unwrap_or(false);
        head_cd = resp.header("Content-Disposition")
            .and_then(parse_content_disposition_filename);
        if total > 0 {
            return Ok(ProbeResult {
                total,
                accept_ranges: head_accept_ranges,
                content_disposition_filename: head_cd,
            });
        }
    }
    // Fallback: Range GET. Discard the body — we only need headers.
    let get_req = apply_headers(ureq::get(url), cookies, user_agent)
        .set("Range", "bytes=0-0");
    let resp = match get_req.call() {
        Ok(r) => r,
        Err(e) => return Err(e.to_string()),
    };
    let status = resp.status();
    let cd = resp.header("Content-Disposition")
        .and_then(parse_content_disposition_filename)
        .or(head_cd);
    if status == 206 {
        // Parse Content-Range: "bytes 0-0/12345"
        let total = resp.header("Content-Range")
            .and_then(|s| s.rsplit('/').next().map(str::to_string))
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        // Drain the 1-byte body to free the connection. .into_string()
        // would error on non-UTF8; read into a vec instead.
        let mut sink = Vec::with_capacity(8);
        let _ = std::io::copy(&mut resp.into_reader().take(64), &mut sink);
        Ok(ProbeResult {
            total,
            accept_ranges: true,
            content_disposition_filename: cd,
        })
    } else {
        // 200 — server ignored Range. Whole body would download here;
        // we abort the read and just record total size. Honor HEAD's
        // Accept-Ranges: a server can advertise ranges yet answer a
        // bytes=0-0 probe with 200 (some do this only for tiny ranges).
        let total = resp.header("Content-Length")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        drop(resp);
        Ok(ProbeResult {
            total,
            accept_ranges: head_accept_ranges,
            content_disposition_filename: cd,
        })
    }
}

fn finish_err(state: &mut JobState, msg: String) -> std::io::Result<()> {
    state.status = "failed".into();
    state.err = Some(msg);
    flush_worker(state)
}

// Reusable polling: between chunks, re-read state file to pick up
// pause/cancel flags issued by other BP host invocations.
fn check_control(state: &mut JobState) -> ControlSignal {
    if let Ok(disk) = read_state(state.gid) {
        state.paused    = disk.paused;
        state.cancelled = disk.cancelled;
    }
    if state.cancelled    { return ControlSignal::Cancelled; }
    if state.paused       { return ControlSignal::Paused;    }
    ControlSignal::Continue
}

enum ControlSignal { Continue, Paused, Cancelled }

// Wall-clock since worker start MINUS time spent in the paused state.
// Saturating subtraction guards against clock skew where paused_offset_ms
// could (legally? rarely?) exceed raw — never report a backward jump.
fn effective_elapsed_ms(start: Instant, paused_offset_ms: u64) -> u64 {
    (start.elapsed().as_millis() as u64).saturating_sub(paused_offset_ms)
}

/// Partial-update flush for in-progress writes. Reads disk first so any
/// status / paused / cancelled flips a `dl.pause` or `dl.cancel` invocation
/// just landed are preserved; the worker overwrites ONLY the four fields
/// it owns: `done`, `elapsed_ms`, `paused_offset_ms`, `worker_pid`. A naive
/// `write_state_atomic(local_state)` was racing dl_pause / dl_cancel —
/// every 250ms the worker flushed its stale `status: "active"` /
/// `cancelled: false` over the disk write that dl_pause / dl_cancel had
/// just made, so the UI saw a paused row revert to "active" until the
/// worker's next `check_control` pass.
pub fn flush_progress(state: &JobState) -> std::io::Result<()> {
    match read_state(state.gid) {
        Ok(mut disk) => {
            disk.done             = state.done;
            disk.elapsed_ms       = state.elapsed_ms;
            disk.paused_offset_ms = state.paused_offset_ms;
            disk.worker_pid       = state.worker_pid;
            // We're being called from the worker's active read path — if
            // disk still says "pending" (e.g. dl_resume after a prior
            // pause/fail/cancel and the worker hasn't hit a transition
            // write since), reconcile to "active". Without this fix the
            // UI label stays "pending" forever for the rest of the run.
            if !disk.paused && disk.status == "pending" {
                disk.status = "active".into();
            }
            write_state_atomic(&disk)
        }
        // No prior file — fall back to full write so the worker can bootstrap.
        Err(_) => write_state_atomic(state),
    }
}

/// Like `flush_progress` but ALSO writes `status` — used at transition
/// points the worker is authoritative for (entering pause, exiting pause).
/// `paused` and `cancelled` still come from disk so a dl.cancel that
/// landed during the spin-wait isn't lost.
pub fn flush_status(state: &JobState) -> std::io::Result<()> {
    match read_state(state.gid) {
        Ok(mut disk) => {
            disk.done             = state.done;
            disk.elapsed_ms       = state.elapsed_ms;
            disk.paused_offset_ms = state.paused_offset_ms;
            disk.worker_pid       = state.worker_pid;
            disk.status           = state.status.clone();
            write_state_atomic(&disk)
        }
        Err(_) => write_state_atomic(state),
    }
}

/// Full-state worker flush — writes EVERY worker-owned field (status, dest,
/// total, err on top of the four `flush_progress` fields) while preserving
/// the two dl-handler-owned flags (`paused`, `cancelled`) from disk. Used
/// at the worker's three "structural" write sites: initial start, after the
/// HEAD/range probe (where dest may have been renamed and total filled in),
/// and at terminal status writes. Without this, a dl.pause / dl.cancel that
/// landed between dl.add and worker startup would be clobbered by the
/// worker's full local-state write.
pub fn flush_worker(state: &JobState) -> std::io::Result<()> {
    match read_state(state.gid) {
        Ok(disk) => {
            let mut merged = state.clone();
            merged.paused    = disk.paused;
            merged.cancelled = disk.cancelled;
            write_state_atomic(&merged)
        }
        Err(_) => write_state_atomic(state),
    }
}

fn run_single(state: &mut JobState, total: u64, accept_ranges: bool, start_instant: Instant) -> Result<(), String> {
    fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&state.dest)
        .map_err(|e| format!("open {}: {e}", state.dest))?;
    let mut downloaded: u64 = 0;
    // A truncated stream that resumes (ranged) made real progress and must not
    // count against the retry budget; only no-progress attempts do. A server
    // that can't resume (no Accept-Ranges) restarts from 0 each time, so there
    // every truncation is a stall — MAX_RETRIES bounds the loop, no infinite
    // re-truncate.
    let resumable = accept_ranges && total > 0;
    let mut stalls: u32 = 0;
    loop {
        if state.cancelled { return Ok(()); }
        let use_range = resumable && downloaded > 0;
        if !use_range && downloaded > 0 {
            downloaded = 0;
            fs::OpenOptions::new()
                .write(true)
                .truncate(true)
                .create(true)
                .open(&state.dest)
                .map_err(|e| format!("retruncate: {e}"))?;
        }
        let progress_before = downloaded;
        let range = if use_range { Some((downloaded, total.saturating_sub(1))) } else { None };
        match stream_into_file(state, range, &mut downloaded, total, start_instant) {
            Ok(()) => return Ok(()),
            Err(SegErr::Permanent(m)) => return Err(m),
            Err(SegErr::Cancelled) => return Ok(()),
            Err(SegErr::Transient(m)) => {
                if resumable && downloaded > progress_before {
                    stalls = 0;
                } else {
                    stalls += 1;
                    if stalls >= MAX_RETRIES { return Err(format!("after {MAX_RETRIES} retries: {m}")); }
                    thread::sleep(Duration::from_millis(BASE_BACKOFF_MS * 3u64.saturating_pow(stalls)));
                }
            }
        }
    }
}

fn run_segmented(state: &mut JobState, total: u64, start_instant: Instant) -> Result<(), String> {
    fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&state.dest)
        .and_then(|f| f.set_len(total))
        .map_err(|e| format!("alloc {}: {e}", state.dest))?;

    let segments = state.segments.max(1) as u64;
    let seg_size = total / segments;
    let done_total = Arc::new(AtomicU64::new(0));
    let gid = state.gid;
    let dest = state.dest.clone();
    let url = state.url.clone();
    let cookies = state.cookies.clone();
    let ua = state.user_agent.clone();

    let mut handles = Vec::with_capacity(segments as usize);
    for i in 0..segments {
        let start_byte = i * seg_size;
        let end_byte = if i + 1 == segments { total - 1 } else { (i + 1) * seg_size - 1 };
        let done_total = Arc::clone(&done_total);
        let dest = dest.clone();
        let url = url.clone();
        let cookies = cookies.clone();
        let ua = ua.clone();
        handles.push(thread::spawn(move || {
            run_segment(gid, &url, &dest, &cookies, &ua, start_byte, end_byte, done_total)
        }));
    }

    let _ = {
        let done_total = Arc::clone(&done_total);
        let gid = state.gid;
        let start_instant = start_instant;
        thread::spawn(move || progress_pump(gid, done_total, start_instant))
    };

    let mut errs: Vec<String> = Vec::new();
    for h in handles {
        match h.join() {
            Ok(Ok(())) => {}
            Ok(Err(e)) => errs.push(e),
            Err(_) => errs.push("segment thread panicked".into()),
        }
    }
    // Hoist the final byte count out of the shared atomic and into the
    // caller's in-memory state. Without this, run_worker's "status = done"
    // write below would stomp the disk state with state.done = 0 because
    // only progress_pump (on a separate thread, writing to disk) ever
    // updated it. Job rows then rendered "DONE  0 B / 5.9 MB" on the
    // manager + popup strip.
    state.done = done_total.load(Ordering::Relaxed);
    state.elapsed_ms = effective_elapsed_ms(start_instant, state.paused_offset_ms);
    if !errs.is_empty() {
        return Err(errs.join("; "));
    }
    Ok(())
}

fn progress_pump(gid: u64, done_total: Arc<AtomicU64>, start_instant: Instant) {
    // Pause-edge tracker for segmented mode. Segment workers only read disk
    // state for pause/cancel flags; they don't mutate paused_offset_ms (any
    // of them writing concurrently would race). progress_pump is the sole
    // writer of state in segmented mode, so it owns the bookkeeping.
    let mut pause_started: Option<Instant> = None;
    loop {
        thread::sleep(STATE_FLUSH_INTERVAL);
        // Always re-read so we pick up dl.pause / dl.cancel / dl.resume
        // writes between pumps. We mutate done / elapsed_ms /
        // paused_offset_ms; status / paused / cancelled pass through —
        // with one exception: a "pending" status with paused=false is a
        // stale dl.resume write that the worker (us, here) is the only
        // one positioned to clear. Flip it to "active" so the UI label
        // tracks reality. Without this, segmented downloads that the
        // user paused-then-resumed stay labelled "pending" forever even
        // though bytes are flowing.
        let mut state = match read_state(gid) {
            Ok(s) => s,
            Err(_) => return,
        };
        state.done = done_total.load(Ordering::Relaxed);
        if state.paused {
            if pause_started.is_none() {
                pause_started = Some(Instant::now());
            }
            // Leave elapsed_ms untouched while paused — frozen at the value
            // last written before pause began.
        } else {
            if let Some(p) = pause_started.take() {
                state.paused_offset_ms = state.paused_offset_ms
                    .saturating_add(p.elapsed().as_millis() as u64);
            }
            state.elapsed_ms = effective_elapsed_ms(start_instant, state.paused_offset_ms);
            if state.status == "pending" {
                state.status = "active".into();
            }
        }
        let _ = write_state_atomic(&state);
        if matches!(state.status.as_str(), "done" | "failed" | "cancelled") {
            return;
        }
    }
}

enum SegErr {
    Transient(String),
    Permanent(String),
    Cancelled,
}

fn stream_into_file(
    state: &mut JobState,
    range: Option<(u64, u64)>,
    downloaded: &mut u64,
    total: u64,
    start_instant: Instant,
) -> Result<(), SegErr> {
    let mut req = ureq::get(&state.url);
    if !state.cookies.is_empty()    { req = req.set("Cookie", &state.cookies); }
    if !state.user_agent.is_empty() { req = req.set("User-Agent", &state.user_agent); }
    if let Some((from, end)) = range {
        req = req.set("Range", &format!("bytes={from}-{end}"));
    }
    let resp = req.call().map_err(|e| match &e {
        ureq::Error::Status(c, _) if *c >= 500 => SegErr::Transient(format!("GET: {e}")),
        ureq::Error::Status(_, _) => SegErr::Permanent(format!("GET: {e}")),
        ureq::Error::Transport(_) => SegErr::Transient(format!("GET: {e}")),
    })?;
    let mut f = fs::OpenOptions::new()
        .write(true)
        .open(&state.dest)
        .map_err(|e| SegErr::Permanent(format!("open: {e}")))?;
    let seek_to = range.map(|(from, _)| from).unwrap_or(0);
    f.seek(SeekFrom::Start(seek_to))
        .map_err(|e| SegErr::Permanent(format!("seek: {e}")))?;

    let mut reader = resp.into_reader();
    let mut buf = vec![0u8; READ_CHUNK];
    let mut last_flush = Instant::now();
    loop {
        match check_control(state) {
            ControlSignal::Cancelled => return Err(SegErr::Cancelled),
            ControlSignal::Paused => {
                state.status = "paused".into();
                state.elapsed_ms = effective_elapsed_ms(start_instant, state.paused_offset_ms);
                // Write status="paused" through flush_status (read-merge-write)
                // so a concurrent dl.cancel that just flipped cancelled=true on
                // disk is preserved — a naive full-state write would clobber it.
                let _ = flush_status(state);
                // elapsed_ms is now frozen at the moment of pause. The wait
                // loop below does NOT touch elapsed_ms; on resume we just
                // accumulate the pause window into paused_offset_ms so the
                // post-resume formula picks up where we left off.
                let pause_start = Instant::now();
                while state.paused && !state.cancelled {
                    thread::sleep(FLAG_CHECK_INTERVAL);
                    let _ = check_control(state);
                }
                state.paused_offset_ms = state.paused_offset_ms
                    .saturating_add(pause_start.elapsed().as_millis() as u64);
                if state.cancelled { return Err(SegErr::Cancelled); }
                state.status = "active".into();
                let _ = flush_status(state);
            }
            ControlSignal::Continue => {}
        }
        match reader.read(&mut buf) {
            Ok(0) => {
                // Premature EOF: the connection closed before Content-Length
                // bytes arrived. Treat as transient so run_single resumes
                // (ranged) instead of recording a truncated file as "done".
                if total > 0 && *downloaded < total {
                    return Err(SegErr::Transient(
                        format!("truncated: got {downloaded} of {total} bytes")));
                }
                return Ok(());
            }
            Ok(n) => {
                f.write_all(&buf[..n])
                    .map_err(|e| SegErr::Permanent(format!("write: {e}")))?;
                *downloaded += n as u64;
                state.done += n as u64;
                if last_flush.elapsed() >= STATE_FLUSH_INTERVAL {
                    state.elapsed_ms = effective_elapsed_ms(start_instant, state.paused_offset_ms);
                    // Partial flush — leave dl.pause / dl.cancel's writes
                    // to `status` / `paused` / `cancelled` intact. A full
                    // write here would race those handlers.
                    let _ = flush_progress(state);
                    last_flush = Instant::now();
                }
            }
            Err(e) => return Err(SegErr::Transient(format!("read: {e}"))),
        }
    }
}

fn run_segment(
    gid: u64,
    url: &str,
    dest: &str,
    cookies: &str,
    user_agent: &str,
    seg_start: u64,
    seg_end: u64,
    done_total: Arc<AtomicU64>,
) -> Result<(), String> {
    let expected = seg_end - seg_start + 1;
    let mut downloaded_in_seg: u64 = 0;
    // `stalls` counts only attempts that made ZERO forward progress. A short
    // read that still advanced the offset — the server closed the connection
    // early on a multi-GB range — resets it, so a segment that truncates
    // repeatedly keeps resuming from where it left off instead of burning its
    // retry budget on attempts that are actually succeeding.
    let mut stalls: u32 = 0;
    loop {
        if let Ok(s) = read_state(gid) {
            if s.cancelled { return Ok(()); }
            while s.paused {
                thread::sleep(FLAG_CHECK_INTERVAL);
                let s2 = read_state(gid).unwrap_or(s.clone());
                if s2.cancelled { return Ok(()); }
                if !s2.paused { break; }
            }
        }
        let from = seg_start + downloaded_in_seg;
        if from > seg_end { return Ok(()); }   // every requested byte is on disk
        let progress_before = downloaded_in_seg;
        let mut req = ureq::get(url)
            .set("Range", &format!("bytes={from}-{seg_end}"));
        if !cookies.is_empty()    { req = req.set("Cookie", cookies); }
        if !user_agent.is_empty() { req = req.set("User-Agent", user_agent); }
        let resp = match req.call() {
            Ok(r) => r,
            Err(e) => {
                let transient = matches!(&e, ureq::Error::Transport(_))
                    || matches!(&e, ureq::Error::Status(c, _) if *c >= 500);
                if !transient { return Err(format!("segment {seg_start}..{seg_end}: GET: {e}")); }
                stalls += 1;
                if stalls >= MAX_RETRIES {
                    return Err(format!("segment {seg_start}..{seg_end} after {MAX_RETRIES} retries: GET: {e}"));
                }
                thread::sleep(Duration::from_millis(BASE_BACKOFF_MS * 3u64.saturating_pow(stalls)));
                continue;
            }
        };
        let mut f = match fs::OpenOptions::new().write(true).open(dest) {
            Ok(f) => f,
            Err(e) => return Err(format!("segment open: {e}")),
        };
        if let Err(e) = f.seek(SeekFrom::Start(from)) {
            return Err(format!("seek: {e}"));
        }
        let mut reader = resp.into_reader();
        let mut buf = vec![0u8; READ_CHUNK];
        let mut read_err: Option<String> = None;
        loop {
            if let Ok(s) = read_state(gid) {
                if s.cancelled { return Ok(()); }
                while s.paused {
                    thread::sleep(FLAG_CHECK_INTERVAL);
                    let s2 = read_state(gid).unwrap_or(s.clone());
                    if s2.cancelled { return Ok(()); }
                    if !s2.paused { break; }
                }
            }
            match reader.read(&mut buf) {
                Ok(0) => break,   // EOF — completeness is verified after the loop
                Ok(n) => {
                    if let Err(e) = f.write_all(&buf[..n]) {
                        return Err(format!("segment write: {e}"));
                    }
                    downloaded_in_seg += n as u64;
                    done_total.fetch_add(n as u64, Ordering::Relaxed);
                }
                Err(e) => { read_err = Some(format!("read: {e}")); break; }
            }
        }
        if downloaded_in_seg >= expected {
            return Ok(());   // segment fully transferred
        }
        // Short: a read error, or a premature EOF that earlier reported the
        // segment "done" when only part of the range arrived. Resume. Forward
        // progress means the resume is working, so don't spend a retry on it;
        // only a no-progress attempt consumes the budget.
        if downloaded_in_seg > progress_before {
            stalls = 0;
        } else {
            stalls += 1;
            if stalls >= MAX_RETRIES {
                let why = read_err.unwrap_or_else(||
                    format!("truncated: got {downloaded_in_seg} of {expected} bytes"));
                return Err(format!("segment {seg_start}..{seg_end} after {MAX_RETRIES} retries: {why}"));
            }
            thread::sleep(Duration::from_millis(BASE_BACKOFF_MS * 3u64.saturating_pow(stalls)));
        }
    }
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}
