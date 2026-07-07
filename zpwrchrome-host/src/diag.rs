//! Diagnostic logger for the zpwrchrome native host.
//!
//! Every host invocation (Chrome-spawned or CLI) appends a labeled timestamped
//! line to `$XDG_CACHE_HOME/zpwrchrome/host.log` (or `~/.cache/zpwrchrome/host.log`).
//! Lines are kept short and grep-friendly:
//!
//!   2026-06-02T22:35:01.234Z pid=12345 START args=[] cwd=/ env_HOME=/Users/wizard
//!   2026-06-02T22:35:01.234Z pid=12345 RECV bytes=22 action=dl.list
//!   2026-06-02T22:35:01.235Z pid=12345 DISPATCH category=extension target=dl
//!   2026-06-02T22:35:01.235Z pid=12345 SEND status=ok bytes=52
//!   2026-06-02T22:35:01.235Z pid=12345 EXIT code=0
//!
//! The log is best-effort: every write swallows errors so logging itself
//! cannot break the host. A panic hook routes Rust panics into the log too.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Return the diagnostic log file path. Mirrors `cache_dir()` in `dl.rs`.
fn log_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("ZPWRCHROME_DL_CACHE_DIR") {
        let path = PathBuf::from(p);
        let _ = fs::create_dir_all(&path);
        return Some(path.join("host.log"));
    }
    let base = std::env::var("XDG_CACHE_HOME")
        .ok()
        .or_else(|| std::env::var("HOME").ok().map(|h| format!("{h}/.cache")))?;
    let dir = PathBuf::from(base).join("zpwrchrome");
    let _ = fs::create_dir_all(&dir);
    Some(dir.join("host.log"))
}

fn iso_ts() -> String {
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let total_secs = d.as_secs() as i64;
    let ms = d.subsec_millis();
    // Plain Y-M-D HH:MM:SS in UTC without bringing in chrono — POSIX gmtime via libc.
    #[cfg(unix)]
    unsafe {
        let mut tm: libc::tm = std::mem::zeroed();
        let t: libc::time_t = total_secs as libc::time_t;
        libc::gmtime_r(&t, &mut tm);
        return format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
            tm.tm_year + 1900,
            tm.tm_mon + 1,
            tm.tm_mday,
            tm.tm_hour,
            tm.tm_min,
            tm.tm_sec,
            ms
        );
    }
    #[cfg(not(unix))]
    format!("ts={total_secs}.{ms:03}")
}

/// Append one labeled line to the host log. Best-effort.
pub fn log(line: &str) {
    let Some(path) = log_path() else { return };
    let pid = std::process::id();
    let Ok(mut f) = OpenOptions::new().append(true).create(true).open(&path) else {
        return;
    };
    let _ = writeln!(f, "{} pid={} {}", iso_ts(), pid, line);
}

/// Install a panic hook routing Rust panics into the log so a crash leaves
/// a forensic trail before the process dies.
pub fn install_panic_hook() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = info
            .payload()
            .downcast_ref::<&'static str>()
            .copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str()))
            .unwrap_or("(no payload)");
        let loc = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "(no location)".into());
        log(&format!("PANIC at={loc} msg={msg:?}"));
        prev(info);
    }));
}

/// Convenience: log a startup banner with PID, args, cwd, and the env vars
/// that matter for diagnosing path/permission issues.
pub fn log_start(args: &[String]) {
    let cwd = std::env::current_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "?".into());
    let home = std::env::var("HOME").unwrap_or_else(|_| "(unset)".into());
    let xdg = std::env::var("XDG_CACHE_HOME").unwrap_or_else(|_| "(unset)".into());
    let path = std::env::var("PATH").unwrap_or_default();
    let path_short = if path.len() > 200 {
        format!("{}…", &path[..200])
    } else {
        path
    };
    log(&format!(
        "START args={:?} cwd={} HOME={} XDG_CACHE_HOME={} PATH={}",
        args, cwd, home, xdg, path_short
    ));
}

/// Convenience: log an exit code right before the process terminates.
/// Note: regular returns from main() do NOT call this — call it explicitly
/// at branches where you SendErrorAndExit / std::process::exit.
pub fn log_exit(code: i32, reason: &str) {
    log(&format!("EXIT code={} reason={}", code, reason));
}
