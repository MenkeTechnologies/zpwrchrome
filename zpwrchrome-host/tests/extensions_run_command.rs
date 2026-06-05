// Integration tests for the `run.spawn` extension action. These cover the
// internal `exec` function (which spawns the child and harvests output) —
// the outer `run_spawn` wrapper just serializes/envelopes, so it's tested
// implicitly via the JSON path in extensions_dl_integration if needed.
//
// We assume `/bin/sh` and `/bin/sleep` / `/bin/echo` exist (true on every
// supported platform: macOS + Linux). On Windows these tests would skip;
// the host is Unix-only today.

use std::collections::HashMap;
use zpwrchrome_host::extensions::run_command::{exec, RunSpawnRequest};

fn req(argv: &[&str]) -> RunSpawnRequest {
    RunSpawnRequest {
        argv:      argv.iter().map(|s| s.to_string()).collect(),
        cwd:       String::new(),
        env:       HashMap::new(),
        timeoutMs: None,
    }
}

#[test]
fn echo_hello_returns_stdout_and_zero_exit() {
    let r = exec(&req(&["/bin/echo", "hello world"])).unwrap();
    assert_eq!(r.code, 0);
    assert_eq!(r.stdout.trim_end(), "hello world");
    assert_eq!(r.stderr, "");
    assert!(!r.truncated);
}

#[test]
fn nonexistent_binary_returns_spawn_error() {
    let err = exec(&req(&["/no/such/binary/zpwr-test"])).unwrap_err();
    assert!(err.starts_with("spawn"), "got {err:?}");
}

#[test]
fn nonzero_exit_propagates_status_code() {
    // `sh -c 'exit 7'` portable across macOS + Linux.
    let r = exec(&req(&["/bin/sh", "-c", "exit 7"])).unwrap();
    assert_eq!(r.code, 7);
    assert_eq!(r.stdout, "");
    assert_eq!(r.stderr, "");
}

#[test]
fn stderr_captured_separately_from_stdout() {
    let r = exec(&req(&[
        "/bin/sh", "-c",
        "echo to-out; echo to-err 1>&2; exit 0",
    ])).unwrap();
    assert_eq!(r.code, 0);
    assert!(r.stdout.contains("to-out"));
    assert!(r.stderr.contains("to-err"));
    assert!(!r.stdout.contains("to-err"));
    assert!(!r.stderr.contains("to-out"));
}

#[test]
fn timeout_kills_long_running_child_and_reports_124() {
    let mut req = req(&["/bin/sh", "-c", "sleep 30"]);
    req.timeoutMs = Some(200);
    let r = exec(&req).unwrap();
    assert_eq!(r.code, 124, "timeout-kill should report 124 (coreutils convention)");
    assert!(r.stderr.contains("killed after"), "stderr={:?}", r.stderr);
    assert!(r.durationMs < 2000, "took {}ms — child wasn't killed promptly", r.durationMs);
}

#[test]
fn empty_argv_via_outer_wrapper_would_fail_but_exec_panic_guarded() {
    // exec() shouldn't be called with empty argv — the outer wrapper rejects
    // it — but if it is, Command::new("") errors out cleanly rather than
    // panicking. This pins that contract.
    let r = exec(&req(&[""]));
    assert!(r.is_err(), "empty program name should error from spawn");
}

#[test]
fn env_overrides_are_visible_to_child() {
    let mut req = req(&["/bin/sh", "-c", "echo $ZPWR_TEST_VAR"]);
    req.env.insert("ZPWR_TEST_VAR".into(), "zpwr-payload".into());
    let r = exec(&req).unwrap();
    assert_eq!(r.code, 0);
    assert_eq!(r.stdout.trim_end(), "zpwr-payload");
}

#[test]
fn cwd_is_applied_when_running_child() {
    let mut req = req(&["/bin/sh", "-c", "pwd"]);
    req.cwd = "/tmp".into();
    let r = exec(&req).unwrap();
    assert_eq!(r.code, 0);
    // macOS reports /private/tmp via realpath; accept either form.
    let pwd = r.stdout.trim_end();
    assert!(pwd == "/tmp" || pwd == "/private/tmp", "pwd={pwd:?}");
}

#[test]
fn large_stdout_is_truncated_at_cap_and_flag_set() {
    // Write 200 KiB to stdout — should clip at STDOUT_CAP (64 KiB) and flip
    // `truncated`. The child must still complete (we drain past the cap to
    // avoid blocking it on a full pipe).
    let r = exec(&req(&[
        "/bin/sh", "-c",
        "head -c 200000 /dev/urandom | base64",   // ~270 KiB of base64
    ])).unwrap();
    assert_eq!(r.code, 0);
    assert!(r.truncated, "expected truncation flag on >64 KiB output");
    assert!(r.stdout.len() <= 64 * 1024,
        "captured {} bytes, cap is 64 KiB", r.stdout.len());
}

#[test]
fn duration_ms_reflects_elapsed_wall_time() {
    let r = exec(&req(&["/bin/sh", "-c", "sleep 0.1"])).unwrap();
    assert_eq!(r.code, 0);
    assert!(r.durationMs >= 90,  "expected >=90ms, got {}", r.durationMs);
    assert!(r.durationMs < 5000, "expected <5s, got {}",   r.durationMs);
}
