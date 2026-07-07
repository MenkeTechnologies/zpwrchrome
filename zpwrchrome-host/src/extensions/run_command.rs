//! `run.spawn` extension action — execute a user-configured argv after a
//! download finishes. Called from the SW's `chrome.downloads.onChanged`
//! handler once a matching post-download rule fires.
//!
//! Wire shape:
//! ```text
//!   request:  {
//!     "action":    "run.spawn",
//!     "argv":      ["unzip", "-d", "/tmp", "/tmp/foo.zip"],
//!     "cwd":       "/tmp",                // optional
//!     "env":       { "FOO": "bar" },      // optional, merged with inherited
//!     "timeoutMs": 30000                  // optional, default 30s, max 5min
//!   }
//!   response: ok {
//!     "code":       0,
//!     "stdout":     "…",          // truncated to STDOUT_CAP
//!     "stderr":     "…",          // truncated to STDERR_CAP
//!     "durationMs": 142,
//!     "truncated":  false         // true if either stream was clipped
//!   }
//! ```
//!
//! Safety model: argv is parsed extension-side via a shlex-style splitter
//! and passed AS AN ARRAY. There is no shell invocation here — argv[0] is
//! resolved against PATH by `std::process::Command::new`, and argv[1..] are
//! passed as literal C strings. A `{path}` containing whitespace or quotes
//! stays one argv entry, so there is no quoting / escape surface to get
//! wrong. Users who want pipes/redirects must wrap their command in
//! `bash -c '…'` explicitly — the surface is theirs, not the host's.
#![allow(non_snake_case)]

use crate::ported::errors::{self, field};
use crate::ported::response;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const MAX_TIMEOUT_MS: u64 = 5 * 60 * 1000;
const STDOUT_CAP: usize = 64 * 1024;
const STDERR_CAP: usize = 64 * 1024;
const POLL_INTERVAL: Duration = Duration::from_millis(25);

#[derive(Deserialize, Debug, Default)]
pub struct RunSpawnRequest {
    #[serde(default)]
    pub argv: Vec<String>,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub timeoutMs: Option<u64>,
}

#[derive(Serialize, Debug)]
pub struct RunSpawnResponse {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    pub durationMs: u64,
    pub truncated: bool,
}

/// Public dispatch entry — mirrors the shape of `otp::otp` / `search::search`.
pub fn run_spawn(value: &Value) {
    let req: RunSpawnRequest = match serde_json::from_value(value.clone()) {
        Ok(r) => r,
        Err(e) => {
            response::SendErrorAndExit(
                errors::Code::ParseRequest,
                Some(response::params_of(&[
                    (field::MESSAGE, "run.spawn: invalid request"),
                    (field::ACTION, "run.spawn"),
                    (field::ERROR, &e.to_string()),
                ])),
            );
        }
    };
    if req.argv.is_empty() {
        response::SendErrorAndExit(
            errors::Code::InvalidRequestAction,
            Some(response::params_of(&[
                (field::MESSAGE, "run.spawn: argv is empty"),
                (field::ACTION, "run.spawn"),
            ])),
        );
    }
    match exec(&req) {
        Ok(resp) => response::SendOk(resp),
        Err(e) => response::SendErrorAndExit(
            errors::Code::InvalidRequestAction,
            Some(response::params_of(&[
                (field::MESSAGE, "run.spawn: spawn failed"),
                (field::ACTION, "run.spawn"),
                (field::ERROR, &e),
            ])),
        ),
    }
}

/// Testable executor: spawn argv, wait with a timeout, capture
/// stdout/stderr with per-stream caps, return a structured result. Pulled
/// out of `run_spawn` so tests don't need the SendOk envelope.
///
/// Concurrency: stdout/stderr each get a dedicated reader thread that
/// blocks on `read()` until EOF, appending into a shared `Vec<u8>` under
/// a mutex. The main thread polls `try_wait` with `POLL_INTERVAL` cadence
/// and kills the child if the timeout deadline passes. The reader threads
/// exit naturally when the child closes its pipes (either on normal exit
/// or after the kill).
pub fn exec(req: &RunSpawnRequest) -> Result<RunSpawnResponse, String> {
    let timeout = Duration::from_millis(
        req.timeoutMs
            .unwrap_or(DEFAULT_TIMEOUT_MS)
            .min(MAX_TIMEOUT_MS),
    );
    let start = Instant::now();

    let mut cmd = Command::new(&req.argv[0]);
    if req.argv.len() > 1 {
        cmd.args(&req.argv[1..]);
    }
    if !req.cwd.is_empty() {
        cmd.current_dir(&req.cwd);
    }
    for (k, v) in &req.env {
        cmd.env(k, v);
    }
    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    // Put the child in its own process group via setsid(2) so a timeout
    // kill reaches grandchildren too. Without this, `sh -c "sleep 30"`
    // would leak the `sleep` process when we SIGKILL the sh wrapper —
    // sleep inherits the stdout/stderr pipes and keeps them open until it
    // naturally finishes, blocking our reader threads on EOF.
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        cmd.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn {}: {e}", req.argv[0]))?;
    #[cfg(unix)]
    let child_pgid = child.id() as libc::pid_t;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "no stdout pipe".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "no stderr pipe".to_string())?;

    let out_buf = Arc::new(Mutex::new(Vec::<u8>::with_capacity(4096)));
    let err_buf = Arc::new(Mutex::new(Vec::<u8>::with_capacity(1024)));
    let out_trun = Arc::new(Mutex::new(false));
    let err_trun = Arc::new(Mutex::new(false));

    let out_handle = spawn_reader(
        stdout,
        Arc::clone(&out_buf),
        STDOUT_CAP,
        Arc::clone(&out_trun),
    );
    let err_handle = spawn_reader(
        stderr,
        Arc::clone(&err_buf),
        STDERR_CAP,
        Arc::clone(&err_trun),
    );

    let mut killed_by_timeout = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if start.elapsed() >= timeout {
                    // SIGKILL the entire process group — pid is the group
                    // leader because pre_exec ran setsid(2). This reaps any
                    // grandchildren that inherited stdout/stderr pipes (e.g.
                    // `sh -c "sleep 30"` → sleep), so the reader threads
                    // hit EOF promptly and the wait() below returns fast.
                    #[cfg(unix)]
                    unsafe {
                        libc::killpg(child_pgid, libc::SIGKILL);
                    }
                    #[cfg(not(unix))]
                    let _ = child.kill();
                    killed_by_timeout = true;
                    break child.wait().map_err(|e| format!("wait after kill: {e}"))?;
                }
                thread::sleep(POLL_INTERVAL);
            }
            Err(e) => return Err(format!("try_wait: {e}")),
        }
    };

    // Reader threads exit on EOF once the child's pipes close. join() blocks
    // briefly; tolerable since the child (and on timeout, the whole process
    // group) has already exited.
    let _ = out_handle.join();
    let _ = err_handle.join();

    let stdout_str = String::from_utf8_lossy(&out_buf.lock().unwrap()).into_owned();
    let mut stderr_str = String::from_utf8_lossy(&err_buf.lock().unwrap()).into_owned();
    let truncated = *out_trun.lock().unwrap() || *err_trun.lock().unwrap();

    if killed_by_timeout {
        if !stderr_str.is_empty() && !stderr_str.ends_with('\n') {
            stderr_str.push('\n');
        }
        stderr_str.push_str(&format!(
            "run.spawn: killed after {}ms timeout\n",
            timeout.as_millis()
        ));
    }

    Ok(RunSpawnResponse {
        code: if killed_by_timeout {
            124
        } else {
            status.code().unwrap_or(-1)
        },
        stdout: stdout_str,
        stderr: stderr_str,
        durationMs: start.elapsed().as_millis() as u64,
        truncated,
    })
}

/// Spawn a thread that reads `r` until EOF in 4 KiB chunks, appending into
/// `buf` and flipping `trun` once `cap` bytes have been kept. Bytes past the
/// cap are drained from the pipe but discarded, preventing the child from
/// blocking on a full pipe buffer.
fn spawn_reader<R>(
    mut r: R,
    buf: Arc<Mutex<Vec<u8>>>,
    cap: usize,
    trun: Arc<Mutex<bool>>,
) -> thread::JoinHandle<()>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut tmp = [0u8; 4096];
        loop {
            match r.read(&mut tmp) {
                Ok(0) => return,
                Ok(n) => {
                    let mut b = buf.lock().unwrap();
                    let remaining = cap.saturating_sub(b.len());
                    if remaining == 0 {
                        *trun.lock().unwrap() = true;
                        continue; // keep draining so writer doesn't block
                    }
                    let take = n.min(remaining);
                    b.extend_from_slice(&tmp[..take]);
                    if take < n {
                        *trun.lock().unwrap() = true;
                    }
                }
                Err(_) => return,
            }
        }
    })
}
