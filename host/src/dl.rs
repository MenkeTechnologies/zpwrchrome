// Segmented download manager.
//
// Design:
//   - One Arc<Manager> shared across the dispatcher and worker threads.
//   - Each `dl.add` spawns N segment threads. Each segment owns a byte range
//     and writes into the destination file at its starting offset (pre-
//     allocated by the controller thread so writes never collide).
//   - Progress is reported by each segment via shared AtomicU64 counters.
//     A pump thread aggregates them and emits id=0 push events to stdout.
//   - Pause/cancel are AtomicBool flags read between chunk writes.
//
// Single-segment mode (when the server doesn't honor Range / sends no
// Content-Length) degrades to one thread streaming start-to-end.

use crate::proto::{Request, Response};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

const READ_CHUNK: usize = 64 * 1024;
const DEFAULT_SEGMENTS: usize = 4;
const MIN_SEGMENT_BYTES: u64 = 1 * 1024 * 1024; // <1 MiB: don't bother splitting.
const MAX_RETRIES: u32 = 4;
const BASE_BACKOFF_MS: u64 = 200;

// Distinguish transient (worth retrying) from permanent ureq failures.
// 4xx are user / auth errors — retrying just wastes time and hammers servers.
// 5xx and connection-class failures are retried.
fn is_transient(err: &ureq::Error) -> bool {
    match err {
        ureq::Error::Status(code, _) => *code >= 500,
        ureq::Error::Transport(_) => true,
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Pending,
    Active,
    Paused,
    Done,
    Failed,
    Cancelled,
}

pub struct Job {
    pub gid: u64,
    pub url: String,
    pub dest: PathBuf,
    pub total: AtomicU64,
    pub done: AtomicU64,
    pub status: Mutex<Status>,
    pub err: Mutex<Option<String>>,
    pub started_at: Instant,
    pub segments: usize,
    pub paused: AtomicBool,
    pub cancelled: AtomicBool,
    pub cookies: Option<String>,
    pub user_agent: Option<String>,
}

impl Job {
    fn snapshot(&self) -> Value {
        let status = *self.status.lock().unwrap();
        let err = self.err.lock().unwrap().clone();
        json!({
            "gid": self.gid,
            "url": self.url,
            "dest": self.dest.to_string_lossy(),
            "total": self.total.load(Ordering::Relaxed),
            "done":  self.done.load(Ordering::Relaxed),
            "status": status,
            "err": err,
            "elapsedMs": self.started_at.elapsed().as_millis() as u64,
            "segments": self.segments,
        })
    }
}

pub struct Manager {
    next_gid: AtomicU64,
    jobs: Mutex<HashMap<u64, Arc<Job>>>,
    pump_started: OnceLock<()>,
    pump_disabled: bool,
}

impl Manager {
    pub fn new() -> Self {
        Self {
            next_gid: AtomicU64::new(1),
            jobs: Mutex::new(HashMap::new()),
            pump_started: OnceLock::new(),
            pump_disabled: false,
        }
    }

    // Test constructor — skips the stdout push-event pump so cargo test
    // captures aren't polluted with binary frames.
    pub fn new_for_test() -> Self {
        Self {
            next_gid: AtomicU64::new(1),
            jobs: Mutex::new(HashMap::new()),
            pump_started: OnceLock::new(),
            pump_disabled: true,
        }
    }

    fn ensure_pump(self: &Arc<Self>) {
        if self.pump_disabled {
            return;
        }
        if self.pump_started.set(()).is_err() {
            return;
        }
        let m = Arc::clone(self);
        thread::Builder::new()
            .name("dl-pump".into())
            .spawn(move || pump_loop(m))
            .ok();
    }

    pub fn add(self: &Arc<Self>, url: String, dest: PathBuf, segments: usize) -> Arc<Job> {
        self.add_full(url, dest, segments, None, None)
    }

    pub fn add_full(
        self: &Arc<Self>,
        url: String,
        dest: PathBuf,
        segments: usize,
        cookies: Option<String>,
        user_agent: Option<String>,
    ) -> Arc<Job> {
        let gid = self.next_gid.fetch_add(1, Ordering::Relaxed);
        let job = Arc::new(Job {
            gid,
            url: url.clone(),
            dest: dest.clone(),
            total: AtomicU64::new(0),
            done: AtomicU64::new(0),
            status: Mutex::new(Status::Pending),
            err: Mutex::new(None),
            started_at: Instant::now(),
            segments,
            paused: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
            cookies,
            user_agent,
        });
        self.jobs.lock().unwrap().insert(gid, Arc::clone(&job));

        let job2 = Arc::clone(&job);
        thread::Builder::new()
            .name(format!("dl-{gid}"))
            .spawn(move || run_job(job2))
            .ok();

        self.ensure_pump();
        job
    }

    fn get(&self, gid: u64) -> Option<Arc<Job>> {
        self.jobs.lock().unwrap().get(&gid).cloned()
    }

    fn all(&self) -> Vec<Arc<Job>> {
        self.jobs.lock().unwrap().values().cloned().collect()
    }
}

static MANAGER: OnceLock<Arc<Manager>> = OnceLock::new();
fn mgr() -> Arc<Manager> {
    MANAGER.get_or_init(|| Arc::new(Manager::new())).clone()
}

pub fn dispatch_dl(req: Request) -> Response {
    match req.op.as_str() {
        "add"    => add(req),
        "list"   => list(req),
        "get"    => get(req),
        "pause"  => pause(req),
        "resume" => resume(req),
        "cancel" => cancel(req),
        other    => Response::err(req.id, format!("unknown dl op: {other}")),
    }
}

fn add(req: Request) -> Response {
    let url = match req.args.get("url").and_then(|v| v.as_str()) {
        Some(u) if !u.is_empty() => u.to_string(),
        _ => return Response::err(req.id, "add: missing args.url"),
    };
    let dir = req
        .args
        .get("dir")
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
        .unwrap_or_else(default_download_dir);
    let name = req
        .args
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| guess_filename(&url))
        .unwrap_or_else(|| format!("download-{}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)));
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return Response::err(req.id, format!("create dir {}: {e}", dir.display()));
    }
    let dest = unique_dest_path(&dir, &sanitize_filename(&name));
    let segments = req
        .args
        .get("segments")
        .and_then(|v| v.as_u64())
        .map(|n| n.clamp(1, 16) as usize)
        .unwrap_or(DEFAULT_SEGMENTS);

    let cookies = req
        .args
        .get("cookies")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let user_agent = req
        .args
        .get("userAgent")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let job = mgr().add_full(url, dest.clone(), segments, cookies, user_agent);
    Response::ok(req.id, json!({"gid": job.gid, "dest": dest.to_string_lossy()}))
}

fn list(req: Request) -> Response {
    let jobs: Vec<Value> = mgr().all().iter().map(|j| j.snapshot()).collect();
    Response::ok(req.id, json!({"jobs": jobs}))
}

fn get(req: Request) -> Response {
    let gid = match req.args.get("gid").and_then(|v| v.as_u64()) {
        Some(g) => g,
        None => return Response::err(req.id, "get: missing args.gid"),
    };
    match mgr().get(gid) {
        Some(j) => Response::ok(req.id, j.snapshot()),
        None => Response::err(req.id, format!("get: unknown gid {gid}")),
    }
}

fn pause(req: Request) -> Response {
    let gid = match req.args.get("gid").and_then(|v| v.as_u64()) {
        Some(g) => g,
        None => return Response::err(req.id, "pause: missing args.gid"),
    };
    match mgr().get(gid) {
        Some(j) => {
            j.paused.store(true, Ordering::Relaxed);
            *j.status.lock().unwrap() = Status::Paused;
            Response::ok(req.id, json!({"gid": gid, "status": "paused"}))
        }
        None => Response::err(req.id, format!("pause: unknown gid {gid}")),
    }
}

fn resume(req: Request) -> Response {
    let gid = match req.args.get("gid").and_then(|v| v.as_u64()) {
        Some(g) => g,
        None => return Response::err(req.id, "resume: missing args.gid"),
    };
    let job = match mgr().get(gid) {
        Some(j) => j,
        None => return Response::err(req.id, format!("resume: unknown gid {gid}")),
    };
    job.paused.store(false, Ordering::Relaxed);
    let was_paused = matches!(*job.status.lock().unwrap(), Status::Paused);
    if was_paused {
        *job.status.lock().unwrap() = Status::Pending;
        let job2 = Arc::clone(&job);
        thread::Builder::new()
            .name(format!("dl-{gid}-resume"))
            .spawn(move || run_job(job2))
            .ok();
    }
    Response::ok(req.id, json!({"gid": gid, "status": "resumed"}))
}

fn cancel(req: Request) -> Response {
    let gid = match req.args.get("gid").and_then(|v| v.as_u64()) {
        Some(g) => g,
        None => return Response::err(req.id, "cancel: missing args.gid"),
    };
    match mgr().get(gid) {
        Some(j) => {
            j.cancelled.store(true, Ordering::Relaxed);
            *j.status.lock().unwrap() = Status::Cancelled;
            let _ = std::fs::remove_file(&j.dest);
            Response::ok(req.id, json!({"gid": gid, "status": "cancelled"}))
        }
        None => Response::err(req.id, format!("cancel: unknown gid {gid}")),
    }
}

fn apply_headers(req: ureq::Request, job: &Job) -> ureq::Request {
    let mut r = req;
    if let Some(c) = &job.cookies {
        r = r.set("Cookie", c);
    }
    if let Some(ua) = &job.user_agent {
        r = r.set("User-Agent", ua);
    }
    r
}

// Worker — runs the actual download in its own thread. HEAD probe for size +
// Accept-Ranges, then either spawns segment threads or streams in one pass.
fn run_job(job: Arc<Job>) {
    *job.status.lock().unwrap() = Status::Active;

    let head = match apply_headers(ureq::head(&job.url), &job).call() {
        Ok(r) => r,
        Err(e) => return finish_err(&job, format!("HEAD: {e}")),
    };
    let total: u64 = head
        .header("Content-Length")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let accept_ranges = head
        .header("Accept-Ranges")
        .map(|v| v.eq_ignore_ascii_case("bytes"))
        .unwrap_or(false);
    job.total.store(total, Ordering::Relaxed);

    if total >= MIN_SEGMENT_BYTES && accept_ranges && job.segments > 1 {
        run_segmented(&job, total)
    } else {
        run_single(&job, total, accept_ranges)
    }
}

fn run_single(job: &Arc<Job>, total: u64, accept_ranges: bool) {
    if let Err(e) = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&job.dest)
    {
        return finish_err(job, format!("open {}: {e}", job.dest.display()));
    }
    let mut downloaded = 0u64;
    for attempt in 0..MAX_RETRIES {
        if job.cancelled.load(Ordering::Relaxed) {
            return;
        }
        // Resume strategy:
        //   - accept_ranges + total known + we've already received bytes → Range request from offset.
        //   - server doesn't honor Range and we have partial bytes → truncate and start over.
        //   - first attempt with empty file → plain GET.
        let use_range = accept_ranges && total > 0 && downloaded > 0;
        if !use_range && downloaded > 0 {
            job.done.fetch_sub(downloaded, Ordering::Relaxed);
            downloaded = 0;
            if let Err(e) = OpenOptions::new()
                .write(true)
                .truncate(true)
                .create(true)
                .open(&job.dest)
            {
                return finish_err(job, format!("retruncate {}: {e}", job.dest.display()));
            }
        }
        let range = if use_range {
            Some((downloaded, total.saturating_sub(1)))
        } else {
            None
        };
        match stream_into_file(job, range, &mut downloaded) {
            Ok(()) => {
                *job.status.lock().unwrap() = Status::Done;
                return;
            }
            Err(SegErr::Permanent(msg)) => return finish_err(job, msg),
            Err(SegErr::Transient(msg)) => {
                if attempt + 1 == MAX_RETRIES {
                    return finish_err(job, format!("after {MAX_RETRIES} retries: {msg}"));
                }
                let backoff = BASE_BACKOFF_MS * 3u64.pow(attempt);
                thread::sleep(Duration::from_millis(backoff));
            }
        }
    }
}

fn run_segmented(job: &Arc<Job>, total: u64) {
    let segments = job.segments.max(1);
    if let Err(e) = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&job.dest)
        .and_then(|f| f.set_len(total))
    {
        return finish_err(job, format!("alloc {}: {e}", job.dest.display()));
    }
    let seg_size = total / segments as u64;
    let mut handles = Vec::with_capacity(segments);
    for i in 0..segments {
        let start = i as u64 * seg_size;
        let end = if i + 1 == segments { total - 1 } else { (i + 1) as u64 * seg_size - 1 };
        let job_c = Arc::clone(job);
        handles.push(thread::spawn(move || run_segment(job_c, start, end)));
    }
    let mut ok = true;
    for h in handles {
        if h.join().map(|r| r.is_err()).unwrap_or(true) {
            ok = false;
        }
    }
    if !ok {
        // err already recorded by first failing segment
        return;
    }
    if job.cancelled.load(Ordering::Relaxed) {
        return;
    }
    *job.status.lock().unwrap() = Status::Done;
}

enum SegErr {
    Transient(String),
    Permanent(String),
}

fn run_segment(job: Arc<Job>, seg_start: u64, seg_end: u64) -> Result<(), ()> {
    let mut downloaded_in_seg = 0u64;
    for attempt in 0..MAX_RETRIES {
        if job.cancelled.load(Ordering::Relaxed) {
            return Err(());
        }
        let from = seg_start + downloaded_in_seg;
        if from > seg_end {
            return Ok(());
        }
        match stream_into_file(&job, Some((from, seg_end)), &mut downloaded_in_seg) {
            Ok(()) => return Ok(()),
            Err(SegErr::Permanent(msg)) => {
                finish_err(&job, format!("segment {seg_start}..{seg_end}: {msg}"));
                return Err(());
            }
            Err(SegErr::Transient(msg)) => {
                if attempt + 1 == MAX_RETRIES {
                    finish_err(
                        &job,
                        format!("segment {seg_start}..{seg_end} after {MAX_RETRIES} retries: {msg}"),
                    );
                    return Err(());
                }
                let backoff = BASE_BACKOFF_MS * 3u64.pow(attempt);
                thread::sleep(Duration::from_millis(backoff));
            }
        }
    }
    Err(())
}

// Single attempt at fetching either (a) a byte range into the dest file at
// offset `from`, or (b) the full body when `range` is None. Returns SegErr
// to signal whether the caller should retry. Updates `downloaded` and
// job.done in lockstep so resume picks up exactly where the stream ended.
fn stream_into_file(
    job: &Arc<Job>,
    range: Option<(u64, u64)>,
    downloaded: &mut u64,
) -> Result<(), SegErr> {
    let mut req = apply_headers(ureq::get(&job.url), job);
    if let Some((from, end)) = range {
        req = req.set("Range", &format!("bytes={from}-{end}"));
    }
    let resp = req.call().map_err(|e| {
        if is_transient(&e) {
            SegErr::Transient(format!("GET: {e}"))
        } else {
            SegErr::Permanent(format!("GET: {e}"))
        }
    })?;
    let mut f = OpenOptions::new()
        .write(true)
        .open(&job.dest)
        .map_err(|e| SegErr::Permanent(format!("open: {e}")))?;
    let seek_to = range.map(|(from, _)| from).unwrap_or(0);
    f.seek(SeekFrom::Start(seek_to))
        .map_err(|e| SegErr::Permanent(format!("seek: {e}")))?;
    let mut reader = resp.into_reader();
    let mut buf = vec![0u8; READ_CHUNK];
    loop {
        if job.cancelled.load(Ordering::Relaxed) {
            return Err(SegErr::Permanent("cancelled".into()));
        }
        while job.paused.load(Ordering::Relaxed) {
            if job.cancelled.load(Ordering::Relaxed) {
                return Err(SegErr::Permanent("cancelled".into()));
            }
            thread::sleep(Duration::from_millis(100));
        }
        match reader.read(&mut buf) {
            Ok(0) => return Ok(()),
            Ok(n) => {
                f.write_all(&buf[..n])
                    .map_err(|e| SegErr::Permanent(format!("write: {e}")))?;
                *downloaded += n as u64;
                job.done.fetch_add(n as u64, Ordering::Relaxed);
            }
            Err(e) => return Err(SegErr::Transient(format!("read: {e}"))),
        }
    }
}

fn finish_err(job: &Arc<Job>, msg: String) {
    *job.err.lock().unwrap() = Some(msg);
    *job.status.lock().unwrap() = Status::Failed;
}

// Pump: aggregates progress and emits id=0 push events. Sends ~5x/sec while
// at least one job is active; sleeps longer when everything is idle.
fn pump_loop(mgr: Arc<Manager>) {
    loop {
        let jobs = mgr.all();
        let any_active = jobs.iter().any(|j| matches!(*j.status.lock().unwrap(), Status::Active));
        let payloads: Vec<Value> = jobs.iter().map(|j| j.snapshot()).collect();
        let evt = json!({"id": 0, "kind": "dl.progress", "jobs": payloads});
        let _ = emit_push(&evt);
        thread::sleep(if any_active { Duration::from_millis(200) } else { Duration::from_secs(2) });
    }
}

fn emit_push(payload: &Value) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(payload)?;
    crate::frame::write_msg(&mut std::io::stdout().lock(), &bytes)
}

pub fn default_download_dir() -> PathBuf {
    if let Ok(p) = std::env::var("ZPWRCHROME_DL_DIR") {
        return PathBuf::from(p);
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join("Downloads").join("zpwrchrome");
    }
    PathBuf::from("./downloads")
}

pub fn guess_filename(url: &str) -> Option<String> {
    let trimmed = url.trim_end_matches('/');
    let after_scheme = trimmed.split("://").nth(1).unwrap_or(trimmed);
    let path = after_scheme.split('/').skip(1).collect::<Vec<_>>().join("/");
    let basename = path.rsplit('/').next().unwrap_or("");
    let no_query = basename.split('?').next().unwrap_or("");
    let no_frag = no_query.split('#').next().unwrap_or("");
    if no_frag.is_empty() {
        return None;
    }
    Some(sanitize_filename(no_frag))
}

// Avoid clobbering an existing file. Matches Chrome's "Save As" convention:
// `foo.tar.gz` → `foo (1).tar.gz` → `foo (2).tar.gz` (split at the LAST dot).
//
// `.tar.gz` is a known limitation of this simple split — Chrome behaves the
// same way, so users won't be surprised. Stops after 9999 attempts and
// returns the bare path; caller will hit a real I/O error if that exists.
pub fn unique_dest_path(dir: &std::path::Path, basename: &str) -> std::path::PathBuf {
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
        if !cand.exists() {
            return cand;
        }
    }
    candidate
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
