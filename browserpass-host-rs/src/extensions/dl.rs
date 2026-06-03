//! File-backed segmented download manager. Each `dl.add` invocation detaches
//! a worker process (`browserpass-host-rs --dl-worker <gid>`) that owns the
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
const DEFAULT_SEGMENTS: u32 = 4;
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
    #[serde(default)]
    pub paused:     bool,
    #[serde(default)]
    pub cancelled:  bool,
    #[serde(default)]
    pub cookies:    String,
    #[serde(default, rename = "userAgent")]
    pub user_agent: String,
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
    Some(sanitize_filename(no_frag))
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
        "dl.clear"   => dl_clear(&req),
        "dl.openDir" => dl_open_dir(&req),
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
    let dest = unique_dest_path(&dir, &sanitize_filename(&name));

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
        paused:     false,
        cancelled:  false,
        cookies:    req.cookies.clone(),
        user_agent: req.userAgent.clone(),
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
        if s.status == "active" { s.status = "paused".into(); }
    });
    response::SendOk(DlActionResponse { gid: req.gid, status: "paused".into() });
}

pub fn dl_resume(req: &DlRequest) {
    let was_terminal = match read_state(req.gid) {
        Ok(s) => matches!(s.status.as_str(), "failed" | "cancelled"),
        Err(_) => false,
    };
    mutate_state(req.gid, "dl.resume", |s| {
        s.paused = false;
        s.cancelled = false;
        if s.status == "paused" || s.status == "failed" || s.status == "cancelled" {
            s.status = "pending".into();
            s.err = None;
        }
    });
    if was_terminal {
        let _ = spawn_worker(req.gid);
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
    let mut state = match read_state(gid) {
        Ok(s) => s,
        Err(_) => {
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
        response::SendErrorAndExit(
            errors::Code::InaccessiblePasswordStore,
            Some(response::params_of(&[
                (field::MESSAGE, "cannot write state file"),
                (field::ACTION,  action),
                (field::ERROR,   &e.to_string()),
            ])),
        );
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
    crate::diag::log(&format!("WORKER_START gid={gid}"));
    let mut state = read_state(gid)?;
    state.status = "active".into();
    let start_instant = Instant::now();
    state.elapsed_ms = 0;
    write_state_atomic(&state)?;

    let mut head_req = ureq::head(&state.url);
    if !state.cookies.is_empty()    { head_req = head_req.set("Cookie", &state.cookies); }
    if !state.user_agent.is_empty() { head_req = head_req.set("User-Agent", &state.user_agent); }
    let head = match head_req.call() {
        Ok(r) => r,
        Err(e) => return finish_err(&mut state, format!("HEAD: {e}")),
    };
    let total: u64 = head
        .header("Content-Length")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let accept_ranges = head
        .header("Accept-Ranges")
        .map(|v| v.eq_ignore_ascii_case("bytes"))
        .unwrap_or(false);
    state.total = total;
    write_state_atomic(&state)?;

    let do_segments = total >= MIN_SEGMENT_BYTES && accept_ranges && state.segments > 1;
    let result = if do_segments {
        run_segmented(&mut state, total, start_instant)
    } else {
        run_single(&mut state, total, accept_ranges, start_instant)
    };
    match result {
        Ok(()) => {
            if state.cancelled {
                let _ = fs::remove_file(&state.dest);
                let _ = fs::remove_file(state_path(state.gid)?);
            } else {
                state.status = "done".into();
                state.elapsed_ms = start_instant.elapsed().as_millis() as u64;
                let _ = write_state_atomic(&state);
            }
        }
        Err(e) => { let _ = finish_err(&mut state, e); }
    }
    Ok(())
}

fn finish_err(state: &mut JobState, msg: String) -> std::io::Result<()> {
    state.status = "failed".into();
    state.err = Some(msg);
    write_state_atomic(state)?;
    Ok(())
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

fn run_single(state: &mut JobState, total: u64, accept_ranges: bool, start_instant: Instant) -> Result<(), String> {
    fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&state.dest)
        .map_err(|e| format!("open {}: {e}", state.dest))?;
    let mut downloaded: u64 = 0;
    for attempt in 0..MAX_RETRIES {
        if state.cancelled { return Ok(()); }
        let use_range = accept_ranges && total > 0 && downloaded > 0;
        if !use_range && downloaded > 0 {
            downloaded = 0;
            fs::OpenOptions::new()
                .write(true)
                .truncate(true)
                .create(true)
                .open(&state.dest)
                .map_err(|e| format!("retruncate: {e}"))?;
        }
        let range = if use_range { Some((downloaded, total.saturating_sub(1))) } else { None };
        match stream_into_file(state, range, &mut downloaded, start_instant) {
            Ok(()) => return Ok(()),
            Err(SegErr::Permanent(m)) => return Err(m),
            Err(SegErr::Transient(m)) => {
                if attempt + 1 == MAX_RETRIES { return Err(format!("after {MAX_RETRIES} retries: {m}")); }
                thread::sleep(Duration::from_millis(BASE_BACKOFF_MS * 3u64.pow(attempt)));
            }
            Err(SegErr::Cancelled) => return Ok(()),
        }
    }
    Ok(())
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
    if !errs.is_empty() {
        return Err(errs.join("; "));
    }
    Ok(())
}

fn progress_pump(gid: u64, done_total: Arc<AtomicU64>, start_instant: Instant) {
    loop {
        thread::sleep(STATE_FLUSH_INTERVAL);
        let mut state = match read_state(gid) {
            Ok(s) => s,
            Err(_) => return,
        };
        state.done = done_total.load(Ordering::Relaxed);
        state.elapsed_ms = start_instant.elapsed().as_millis() as u64;
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
                state.elapsed_ms = start_instant.elapsed().as_millis() as u64;
                let _ = write_state_atomic(state);
                while state.paused && !state.cancelled {
                    thread::sleep(FLAG_CHECK_INTERVAL);
                    let _ = check_control(state);
                }
                if state.cancelled { return Err(SegErr::Cancelled); }
                state.status = "active".into();
                let _ = write_state_atomic(state);
            }
            ControlSignal::Continue => {}
        }
        match reader.read(&mut buf) {
            Ok(0) => return Ok(()),
            Ok(n) => {
                f.write_all(&buf[..n])
                    .map_err(|e| SegErr::Permanent(format!("write: {e}")))?;
                *downloaded += n as u64;
                state.done += n as u64;
                if last_flush.elapsed() >= STATE_FLUSH_INTERVAL {
                    state.elapsed_ms = start_instant.elapsed().as_millis() as u64;
                    let _ = write_state_atomic(state);
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
    let mut downloaded_in_seg: u64 = 0;
    for attempt in 0..MAX_RETRIES {
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
        if from > seg_end { return Ok(()); }
        let mut req = ureq::get(url)
            .set("Range", &format!("bytes={from}-{seg_end}"));
        if !cookies.is_empty()    { req = req.set("Cookie", cookies); }
        if !user_agent.is_empty() { req = req.set("User-Agent", user_agent); }
        let resp = match req.call() {
            Ok(r) => r,
            Err(e) => {
                let transient = matches!(&e, ureq::Error::Transport(_))
                    || matches!(&e, ureq::Error::Status(c, _) if *c >= 500);
                if !transient || attempt + 1 == MAX_RETRIES {
                    return Err(format!("segment {seg_start}..{seg_end}: GET: {e}"));
                }
                thread::sleep(Duration::from_millis(BASE_BACKOFF_MS * 3u64.pow(attempt)));
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
        let mut transient_err: Option<String> = None;
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
                Ok(0) => return Ok(()),
                Ok(n) => {
                    if let Err(e) = f.write_all(&buf[..n]) {
                        return Err(format!("segment write: {e}"));
                    }
                    downloaded_in_seg += n as u64;
                    done_total.fetch_add(n as u64, Ordering::Relaxed);
                }
                Err(e) => { transient_err = Some(format!("read: {e}")); break; }
            }
        }
        if let Some(e) = transient_err {
            if attempt + 1 == MAX_RETRIES {
                return Err(format!("segment {seg_start}..{seg_end} after {MAX_RETRIES} retries: {e}"));
            }
            thread::sleep(Duration::from_millis(BASE_BACKOFF_MS * 3u64.pow(attempt)));
        } else {
            return Ok(());
        }
    }
    Err(format!("segment {seg_start}..{seg_end}: exhausted retries"))
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}
