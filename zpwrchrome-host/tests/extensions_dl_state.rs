// Unit tests for the file-backed download manager. Covers:
//   - Cache dir override (ZPWRCHROME_DL_CACHE_DIR)
//   - state_path formatting
//   - JobState round-trip through write_state_atomic + read_state
//   - next_gid monotonic increment
//   - list_all_jobs aggregation
//   - guess_filename / sanitize_filename / unique_dest_path pure helpers
//
// Each test isolates state by pointing ZPWRCHROME_DL_CACHE_DIR at its own
// tempdir so they don't race even when cargo runs them in parallel — the
// env var is set inside a guard at function scope.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use zpwrchrome_host::extensions::dl::{
    cache_dir, default_download_dir, guess_filename, list_all_jobs, next_gid, read_state,
    sanitize_filename, state_path, unique_dest_path, write_state_atomic, JobState,
};

// Single shared lock around env-var mutation across tests (cargo runs tests
// in parallel). Each test acquires the lock, sets env, runs, releases.
static ENV_LOCK: Mutex<()> = Mutex::new(());

fn isolated_cache(tag: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!(
        "zpwrchrome-dl-state-{}-{}-{}",
        tag,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = fs::remove_dir_all(&p);
    fs::create_dir_all(&p).unwrap();
    p
}

#[test]
fn cache_dir_uses_env_override() {
    let _g = ENV_LOCK.lock().unwrap();
    let d = isolated_cache("cache-env");
    unsafe { std::env::set_var("ZPWRCHROME_DL_CACHE_DIR", &d) };
    let got = cache_dir().unwrap();
    assert_eq!(
        fs::canonicalize(got).unwrap(),
        fs::canonicalize(&d).unwrap()
    );
    unsafe { std::env::remove_var("ZPWRCHROME_DL_CACHE_DIR") };
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn state_path_uses_gid_zero_padded_to_six_digits() {
    let _g = ENV_LOCK.lock().unwrap();
    let d = isolated_cache("state-path");
    unsafe { std::env::set_var("ZPWRCHROME_DL_CACHE_DIR", &d) };
    let p = state_path(42).unwrap();
    assert_eq!(p.file_name().unwrap(), "gid_000042.json");
    unsafe { std::env::remove_var("ZPWRCHROME_DL_CACHE_DIR") };
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn write_then_read_state_round_trips_all_fields() {
    let _g = ENV_LOCK.lock().unwrap();
    let d = isolated_cache("rw-state");
    unsafe { std::env::set_var("ZPWRCHROME_DL_CACHE_DIR", &d) };
    let state = JobState {
        gid:        7,
        url:        "https://example.com/file.zip".into(),
        dest:       "/tmp/file.zip".into(),
        total:      4_194_304,
        done:       1_048_576,
        status:     "active".into(),
        err:        None,
        segments:   4,
        started_at: 1_700_000_000,
        elapsed_ms: 1234,
        paused:     false,
        cancelled:  false,
        cookies:    "session=abc".into(),
        user_agent: "test/0.1".into(),
        worker_pid: 0,
    };
    write_state_atomic(&state).unwrap();
    let got = read_state(7).unwrap();
    assert_eq!(got.gid,        state.gid);
    assert_eq!(got.url,        state.url);
    assert_eq!(got.dest,       state.dest);
    assert_eq!(got.total,      state.total);
    assert_eq!(got.done,       state.done);
    assert_eq!(got.status,     state.status);
    assert_eq!(got.segments,   state.segments);
    assert_eq!(got.cookies,    state.cookies);
    assert_eq!(got.user_agent, state.user_agent);
    unsafe { std::env::remove_var("ZPWRCHROME_DL_CACHE_DIR") };
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn next_gid_returns_monotonic_sequence() {
    let _g = ENV_LOCK.lock().unwrap();
    let d = isolated_cache("nextgid");
    unsafe { std::env::set_var("ZPWRCHROME_DL_CACHE_DIR", &d) };
    let a = next_gid().unwrap();
    let b = next_gid().unwrap();
    let c = next_gid().unwrap();
    assert_eq!(a, 1);
    assert_eq!(b, 2);
    assert_eq!(c, 3);
    unsafe { std::env::remove_var("ZPWRCHROME_DL_CACHE_DIR") };
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn list_all_jobs_returns_every_state_file_sorted_by_gid() {
    let _g = ENV_LOCK.lock().unwrap();
    let d = isolated_cache("list-all");
    unsafe { std::env::set_var("ZPWRCHROME_DL_CACHE_DIR", &d) };
    let make = |gid: u64, status: &str| JobState {
        gid, url: format!("https://x/{gid}"), dest: format!("/tmp/{gid}"),
        total: 0, done: 0, status: status.into(), err: None,
        segments: 1, started_at: 0, elapsed_ms: 0, paused: false,
        cancelled: false, cookies: String::new(), user_agent: String::new(),
        worker_pid: 0,
    };
    write_state_atomic(&make(3, "active")).unwrap();
    write_state_atomic(&make(1, "done")).unwrap();
    write_state_atomic(&make(2, "paused")).unwrap();
    let jobs = list_all_jobs().unwrap();
    assert_eq!(jobs.len(), 3);
    assert_eq!(jobs[0].gid, 1);
    assert_eq!(jobs[1].gid, 2);
    assert_eq!(jobs[2].gid, 3);
    unsafe { std::env::remove_var("ZPWRCHROME_DL_CACHE_DIR") };
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn list_all_jobs_ignores_non_state_files() {
    let _g = ENV_LOCK.lock().unwrap();
    let d = isolated_cache("list-ignore");
    unsafe { std::env::set_var("ZPWRCHROME_DL_CACHE_DIR", &d) };
    // Sprinkle some non-gid files; they must be ignored.
    fs::write(d.join("next_gid"), "5").unwrap();
    fs::write(d.join("lock"), "").unwrap();
    fs::write(d.join("worker.log"), "log").unwrap();
    let jobs = list_all_jobs().unwrap();
    assert!(jobs.is_empty());
    unsafe { std::env::remove_var("ZPWRCHROME_DL_CACHE_DIR") };
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn read_state_errors_on_missing_gid() {
    let _g = ENV_LOCK.lock().unwrap();
    let d = isolated_cache("missing");
    unsafe { std::env::set_var("ZPWRCHROME_DL_CACHE_DIR", &d) };
    let r = read_state(999);
    assert!(r.is_err());
    unsafe { std::env::remove_var("ZPWRCHROME_DL_CACHE_DIR") };
    let _ = fs::remove_dir_all(&d);
}

// ─── Pure helpers (no env mutation) ─────────────────────────────────────────

#[test]
fn guess_filename_pulls_basename_from_url() {
    assert_eq!(guess_filename("https://example.com/a/b/foo.zip"), Some("foo.zip".into()));
    assert_eq!(guess_filename("https://example.com/foo.tar.gz"),  Some("foo.tar.gz".into()));
}

#[test]
fn guess_filename_strips_query_and_fragment() {
    assert_eq!(guess_filename("https://x/a.exe?v=2"),       Some("a.exe".into()));
    assert_eq!(guess_filename("https://x/a.exe#sig"),       Some("a.exe".into()));
    assert_eq!(guess_filename("https://x/a.exe?v=2#sig"),   Some("a.exe".into()));
}

#[test]
fn guess_filename_none_for_root() {
    assert_eq!(guess_filename("https://example.com/"), None);
    assert_eq!(guess_filename("https://example.com"),  None);
}

#[test]
fn sanitize_strips_path_and_control_chars() {
    assert_eq!(sanitize_filename("foo/bar"),     "foo_bar");
    assert_eq!(sanitize_filename("a:b*c?d"),     "a_b_c_d");
    assert_eq!(sanitize_filename("a\\b\"c"),     "a_b_c");
    assert_eq!(sanitize_filename("a\nb"),        "a_b");
    assert_eq!(sanitize_filename("a\0b"),        "a_b");
}

#[test]
fn unique_dest_returns_basename_when_dir_empty() {
    let d = isolated_cache("uniq-empty");
    let got = unique_dest_path(&d, "foo.zip");
    assert_eq!(got, d.join("foo.zip"));
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn unique_dest_increments_suffix_until_free() {
    let d = isolated_cache("uniq-incr");
    fs::write(d.join("foo.zip"), "x").unwrap();
    assert_eq!(unique_dest_path(&d, "foo.zip"), d.join("foo (1).zip"));
    fs::write(d.join("foo (1).zip"), "x").unwrap();
    assert_eq!(unique_dest_path(&d, "foo.zip"), d.join("foo (2).zip"));
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn unique_dest_handles_no_extension() {
    let d = isolated_cache("uniq-noext");
    fs::write(d.join("README"), "x").unwrap();
    assert_eq!(unique_dest_path(&d, "README"), d.join("README (1)"));
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn unique_dest_handles_dotfile_prefix() {
    let d = isolated_cache("uniq-dot");
    fs::write(d.join(".bashrc"), "x").unwrap();
    assert_eq!(unique_dest_path(&d, ".bashrc"), d.join(".bashrc (1)"));
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn default_download_dir_uses_env_override() {
    let _g = ENV_LOCK.lock().unwrap();
    let old = std::env::var("ZPWRCHROME_DL_DIR").ok();
    unsafe { std::env::set_var("ZPWRCHROME_DL_DIR", "/tmp/zp-dlcache-test") };
    assert_eq!(default_download_dir(), PathBuf::from("/tmp/zp-dlcache-test"));
    if let Some(v) = old { unsafe { std::env::set_var("ZPWRCHROME_DL_DIR", v) }; }
    else                 { unsafe { std::env::remove_var("ZPWRCHROME_DL_DIR") }; }
}
