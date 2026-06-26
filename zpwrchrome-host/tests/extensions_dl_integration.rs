// End-to-end test for the file-state download manager. Spawns a local
// HTTP/1.1 server with Range support, invokes zpwrchrome-host with a
// framed `dl.add` request, then polls the state file until the worker
// reports `done`. Verifies the downloaded bytes match the served payload.

use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

// How long a test waits for a download to reach a terminal state. The
// failure/success paths are deterministic (segment backoff sums to ~8s), so
// this is pure headroom: `cargo test` runs these heavy integration tests in
// parallel — each spawns a detached worker process, an in-process HTTP server,
// and N segment threads — which oversubscribes a 2-core CI runner and stretches
// wall-clock far past the ~8s floor. A genuine hang still fails, just later.
const DONE_TIMEOUT: Duration = Duration::from_secs(120);

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_zpwrchrome-host")
}

fn tempdir(tag: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!(
        "zpwrchrome-dl-int-{}-{}-{}",
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

fn make_payload(size: usize) -> Vec<u8> {
    (0..size).map(|i| (i % 251) as u8).collect()
}

fn start_server(payload: Arc<Vec<u8>>) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let mut stream = match stream { Ok(s) => s, Err(_) => continue };
            let p = Arc::clone(&payload);
            thread::spawn(move || {
                let mut buf = [0u8; 8192];
                let mut req = Vec::new();
                loop {
                    let n = match stream.read(&mut buf) { Ok(n) => n, Err(_) => return };
                    if n == 0 { return; }
                    req.extend_from_slice(&buf[..n]);
                    if req.windows(4).any(|w| w == b"\r\n\r\n") { break; }
                }
                let req_str = String::from_utf8_lossy(&req).into_owned();
                let first   = req_str.lines().next().unwrap_or("").to_string();
                let method  = first.split_whitespace().next().unwrap_or("").to_string();
                let range_header = req_str.lines().find_map(|l| {
                    l.strip_prefix("Range: ")
                        .or_else(|| l.strip_prefix("range: "))
                        .map(|s| s.trim().to_string())
                });
                if method == "HEAD" {
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n",
                        p.len()
                    );
                    let _ = stream.write_all(resp.as_bytes());
                    return;
                }
                if method == "GET" {
                    if let Some(range) = range_header {
                        if let Some(rest) = range.strip_prefix("bytes=") {
                            let parts: Vec<&str> = rest.split('-').collect();
                            let start: usize = parts.first().and_then(|x| x.parse().ok()).unwrap_or(0);
                            let end:   usize = parts.get(1).and_then(|x| x.parse().ok()).unwrap_or(p.len() - 1);
                            let slice = &p[start..=end];
                            let resp = format!(
                                "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n",
                                slice.len(), start, end, p.len()
                            );
                            let _ = stream.write_all(resp.as_bytes());
                            let _ = stream.write_all(slice);
                            return;
                        }
                    }
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        p.len()
                    );
                    let _ = stream.write_all(resp.as_bytes());
                    let _ = stream.write_all(&p);
                }
            });
        }
    });
    port
}

fn frame_bytes(payload: &[u8]) -> Vec<u8> {
    let mut v = (payload.len() as u32).to_le_bytes().to_vec();
    v.extend_from_slice(payload);
    v
}

fn read_one_frame(buf: &[u8]) -> Value {
    let n = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
    serde_json::from_slice(&buf[4..4 + n]).expect("valid JSON")
}

fn run_with_env(request: &Value, envs: &[(&str, &str)]) -> Value {
    let bytes = serde_json::to_vec(request).unwrap();
    let mut cmd = Command::new(bin());
    for (k, v) in envs { cmd.env(k, v); }
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn");
    child.stdin.as_mut().unwrap().write_all(&frame_bytes(&bytes)).unwrap();
    drop(child.stdin.take());
    let mut out = Vec::new();
    child.stdout.as_mut().unwrap().read_to_end(&mut out).unwrap();
    let _ = child.wait();
    read_one_frame(&out)
}

fn wait_for_done(state_dir: &PathBuf, gid: u64, timeout: Duration) -> Value {
    let path = state_dir.join(format!("gid_{gid:06}.json"));
    let start = Instant::now();
    loop {
        if start.elapsed() > timeout {
            panic!("download did not finish within {:?}, state path={path:?}", timeout);
        }
        if path.exists() {
            if let Ok(body) = fs::read_to_string(&path) {
                if let Ok(v) = serde_json::from_str::<Value>(&body) {
                    let status = v["status"].as_str().unwrap_or("");
                    if matches!(status, "done" | "failed" | "cancelled") {
                        return v;
                    }
                }
            }
        }
        thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn dl_add_downloads_file_via_detached_worker_and_marks_state_done() {
    let payload = Arc::new(make_payload(2 * 1024 * 1024));   // 2 MiB → segmented
    let port = start_server(Arc::clone(&payload));
    let cache  = tempdir("dl-add-cache");
    let dlroot = tempdir("dl-add-dest");

    let req = json!({
        "action":   "dl.add",
        "url":      format!("http://127.0.0.1:{port}/file.bin"),
        "dir":      dlroot.to_string_lossy(),
        "name":     "file.bin",
        "segments": 4,
    });
    let resp = run_with_env(
        &req,
        &[
            ("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy()),
            ("ZPWRCHROME_DL_DIR",       &dlroot.to_string_lossy()),
        ],
    );
    assert_eq!(resp["status"], "ok", "dl.add response: {resp}");
    let gid: u64 = resp["data"]["gid"].as_u64().expect("gid in response");
    let dest = resp["data"]["dest"].as_str().expect("dest in response");
    assert!(dest.ends_with("file.bin"), "unexpected dest: {dest}");

    let final_state = wait_for_done(&cache, gid, DONE_TIMEOUT);
    assert_eq!(final_state["status"], "done", "{final_state}");
    let bytes = fs::read(dest).expect("dest file readable");
    assert_eq!(bytes.len(), payload.len(), "size mismatch");
    assert_eq!(bytes, *payload,            "content mismatch");
    // Regression pin: a 5.9 MB download was rendering as "DONE  0 B / 5.9 MB"
    // because run_segmented never copied the atomic done_total into the
    // in-memory state before returning. Manifest the bug: final state.done
    // must equal the on-disk file size.
    assert_eq!(
        final_state["done"].as_u64().unwrap_or(0),
        payload.len() as u64,
        "state.done = {} but file is {} bytes (run_segmented didn't \
         hoist done_total into state — UI shows 0 B / 5.9 MB)",
        final_state["done"], payload.len(),
    );
    assert_eq!(
        final_state["total"].as_u64().unwrap_or(0),
        payload.len() as u64,
        "state.total mismatch: {} vs {}",
        final_state["total"], payload.len(),
    );

    let _ = fs::remove_dir_all(&dlroot);
    let _ = fs::remove_dir_all(&cache);
}

#[test]
fn dl_list_returns_every_gid_under_cache_dir() {
    let cache = tempdir("dl-list");
    fs::create_dir_all(&cache).unwrap();
    // Pre-seed two state files (no worker actually running).
    for gid in [1u64, 2u64] {
        let st = json!({
            "gid": gid, "url": format!("https://x/{gid}"), "dest": format!("/tmp/{gid}"),
            "total": 0, "done": 0, "status": "pending", "err": null,
            "segments": 1, "started_at": 1, "elapsed_ms": 0,
            "paused": false, "cancelled": false, "cookies": "", "userAgent": ""
        });
        fs::write(cache.join(format!("gid_{gid:06}.json")), serde_json::to_vec_pretty(&st).unwrap()).unwrap();
    }
    let req = json!({ "action": "dl.list" });
    let resp = run_with_env(&req, &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())]);
    assert_eq!(resp["status"], "ok");
    let jobs = resp["data"]["jobs"].as_array().expect("jobs array");
    assert_eq!(jobs.len(), 2);
    assert_eq!(jobs[0]["gid"], 1);
    assert_eq!(jobs[1]["gid"], 2);
    let _ = fs::remove_dir_all(&cache);
}

#[test]
fn dl_pause_writes_paused_true_into_state_file() {
    let cache = tempdir("dl-pause");
    fs::create_dir_all(&cache).unwrap();
    let st = json!({
        "gid": 5, "url": "https://x/5", "dest": "/tmp/5",
        "total": 100, "done": 50, "status": "active", "err": null,
        "segments": 1, "started_at": 1, "elapsed_ms": 0,
        "paused": false, "cancelled": false, "cookies": "", "userAgent": ""
    });
    fs::write(cache.join("gid_000005.json"), serde_json::to_vec_pretty(&st).unwrap()).unwrap();

    let req = json!({ "action": "dl.pause", "gid": 5 });
    let resp = run_with_env(&req, &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())]);
    assert_eq!(resp["status"], "ok");
    let after = fs::read_to_string(cache.join("gid_000005.json")).unwrap();
    let v: Value = serde_json::from_str(&after).unwrap();
    assert_eq!(v["paused"], true);
    assert_eq!(v["status"], "paused");
    let _ = fs::remove_dir_all(&cache);
}

#[test]
fn dl_cancel_marks_state_cancelled() {
    let cache = tempdir("dl-cancel");
    fs::create_dir_all(&cache).unwrap();
    let st = json!({
        "gid": 9, "url": "https://x/9", "dest": "/tmp/9",
        "total": 100, "done": 25, "status": "active", "err": null,
        "segments": 1, "started_at": 1, "elapsed_ms": 0,
        "paused": false, "cancelled": false, "cookies": "", "userAgent": ""
    });
    fs::write(cache.join("gid_000009.json"), serde_json::to_vec_pretty(&st).unwrap()).unwrap();

    let req = json!({ "action": "dl.cancel", "gid": 9 });
    let resp = run_with_env(&req, &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())]);
    assert_eq!(resp["status"], "ok");
    let v: Value = serde_json::from_str(&fs::read_to_string(cache.join("gid_000009.json")).unwrap()).unwrap();
    assert_eq!(v["cancelled"], true);
    assert_eq!(v["status"], "cancelled");
    let _ = fs::remove_dir_all(&cache);
}

#[test]
fn dl_pause_on_unknown_gid_returns_code_20() {
    let cache = tempdir("dl-pause-bad");
    fs::create_dir_all(&cache).unwrap();
    let req = json!({ "action": "dl.pause", "gid": 999 });
    let resp = run_with_env(&req, &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())]);
    assert_eq!(resp["status"], "error");
    assert_eq!(resp["code"], 20);
    let _ = fs::remove_dir_all(&cache);
}

#[test]
fn dl_clear_scope_done_removes_only_done_state_files() {
    let cache = tempdir("dl-clear-done");
    let dlroot = tempdir("dl-clear-dest");
    for (gid, status) in [(1u64, "done"), (2u64, "failed"), (3u64, "cancelled")] {
        let dest = dlroot.join(format!("file{gid}.bin"));
        fs::write(&dest, b"x").unwrap();
        let st = json!({
            "gid": gid, "url": format!("https://x/{gid}"), "dest": dest.to_string_lossy(),
            "total": 1, "done": 1, "status": status, "err": null,
            "segments": 1, "started_at": 1, "elapsed_ms": 0,
            "paused": false, "cancelled": status == "cancelled",
            "cookies": "", "userAgent": ""
        });
        fs::write(cache.join(format!("gid_{gid:06}.json")), serde_json::to_vec_pretty(&st).unwrap()).unwrap();
    }
    let resp = run_with_env(
        &json!({ "action": "dl.clear", "scope": "done", "deleteFromDisk": false }),
        &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())],
    );
    assert_eq!(resp["status"], "ok");
    let cleared = resp["data"]["cleared"].as_array().unwrap();
    assert_eq!(cleared.len(), 1);
    assert_eq!(cleared[0], 1);
    assert!(!cache.join("gid_000001.json").exists());
    assert!( cache.join("gid_000002.json").exists());
    assert!( cache.join("gid_000003.json").exists());
    assert!(dlroot.join("file1.bin").exists(), "deleteFromDisk=false → dest must remain");
    let _ = fs::remove_dir_all(&cache);
    let _ = fs::remove_dir_all(&dlroot);
}

#[test]
fn dl_clear_with_delete_from_disk_unlinks_done_dest_files() {
    let cache = tempdir("dl-clear-disk");
    let dlroot = tempdir("dl-clear-disk-dest");
    let dest = dlroot.join("kill.bin");
    fs::write(&dest, b"trash").unwrap();
    let st = json!({
        "gid": 42, "url": "https://x/42", "dest": dest.to_string_lossy(),
        "total": 5, "done": 5, "status": "done", "err": null,
        "segments": 1, "started_at": 1, "elapsed_ms": 0,
        "paused": false, "cancelled": false, "cookies": "", "userAgent": ""
    });
    fs::write(cache.join("gid_000042.json"), serde_json::to_vec_pretty(&st).unwrap()).unwrap();
    let resp = run_with_env(
        &json!({ "action": "dl.clear", "scope": "done", "deleteFromDisk": true }),
        &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())],
    );
    assert_eq!(resp["status"], "ok");
    let deleted = resp["data"]["deletedOnDisk"].as_array().unwrap();
    assert_eq!(deleted.len(), 1);
    assert!(!dest.exists());
    let _ = fs::remove_dir_all(&cache);
    let _ = fs::remove_dir_all(&dlroot);
}

#[test]
fn dl_clear_scope_failed_removes_failed_and_cancelled() {
    let cache = tempdir("dl-clear-failed");
    for (gid, status) in [(1u64, "done"), (2u64, "failed"), (3u64, "cancelled")] {
        let st = json!({
            "gid": gid, "url": format!("https://x/{gid}"), "dest": format!("/tmp/{gid}"),
            "total": 1, "done": 1, "status": status, "err": null,
            "segments": 1, "started_at": 1, "elapsed_ms": 0,
            "paused": false, "cancelled": status == "cancelled",
            "cookies": "", "userAgent": ""
        });
        fs::write(cache.join(format!("gid_{gid:06}.json")), serde_json::to_vec_pretty(&st).unwrap()).unwrap();
    }
    let resp = run_with_env(
        &json!({ "action": "dl.clear", "scope": "failed" }),
        &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())],
    );
    let gids: Vec<u64> = resp["data"]["cleared"].as_array().unwrap()
        .iter().map(|v| v.as_u64().unwrap()).collect();
    assert_eq!(gids, vec![2, 3]);
    let _ = fs::remove_dir_all(&cache);
}

#[test]
fn dl_clear_scope_missing_targets_done_jobs_whose_dest_vanished() {
    let cache = tempdir("dl-clear-missing");
    let st = json!({
        "gid": 99, "url": "https://x/99",
        "dest": "/tmp/zp-dl-clear-vanished-on-disk-xyz.bin",
        "total": 1, "done": 1, "status": "done", "err": null,
        "segments": 1, "started_at": 1, "elapsed_ms": 0,
        "paused": false, "cancelled": false, "cookies": "", "userAgent": ""
    });
    fs::write(cache.join("gid_000099.json"), serde_json::to_vec_pretty(&st).unwrap()).unwrap();
    let resp = run_with_env(
        &json!({ "action": "dl.clear", "scope": "missing" }),
        &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())],
    );
    let cleared = resp["data"]["cleared"].as_array().unwrap();
    assert_eq!(cleared.len(), 1);
    let _ = fs::remove_dir_all(&cache);
}

#[test]
fn dl_clear_scope_all_wipes_every_state_file() {
    let cache = tempdir("dl-clear-all");
    for gid in [1u64, 2u64, 3u64, 4u64] {
        let st = json!({
            "gid": gid, "url": format!("https://x/{gid}"), "dest": format!("/tmp/{gid}"),
            "total": 1, "done": 1, "status": "done", "err": null,
            "segments": 1, "started_at": 1, "elapsed_ms": 0,
            "paused": false, "cancelled": false, "cookies": "", "userAgent": ""
        });
        fs::write(cache.join(format!("gid_{gid:06}.json")), serde_json::to_vec_pretty(&st).unwrap()).unwrap();
    }
    let resp = run_with_env(
        &json!({ "action": "dl.clear", "scope": "all" }),
        &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())],
    );
    assert_eq!(resp["data"]["cleared"].as_array().unwrap().len(), 4);
    let _ = fs::remove_dir_all(&cache);
}

#[test]
fn dl_add_with_missing_url_returns_code_12() {
    let cache = tempdir("dl-add-bad");
    fs::create_dir_all(&cache).unwrap();
    let req = json!({ "action": "dl.add" });
    let resp = run_with_env(&req, &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())]);
    assert_eq!(resp["status"], "error");
    assert_eq!(resp["code"], 12);
    let _ = fs::remove_dir_all(&cache);
}

// Regression: spawn_worker MUST detach worker from Chrome's inherited
// stdio FDs (setsid + close fds >= 3) — otherwise the worker keeps
// Chrome's stdout pipe open and the SW sees "Native host has exited"
// even though the host responded successfully.
#[test]
fn spawn_worker_detaches_worker_from_inherited_fds() {
    let src = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/extensions/dl.rs")
    ).unwrap();
    let block = src.split("fn spawn_worker").nth(1).expect("spawn_worker missing");
    let head = &block[..block.find("\nfn ").unwrap_or(block.len())];
    assert!(head.contains("setsid"),       "spawn_worker must call libc::setsid()");
    assert!(head.contains("libc::close"),  "spawn_worker must close inherited FDs");
    assert!(head.contains("pre_exec"),     "spawn_worker must use pre_exec hook");
}

// Regression: Chrome (Chromium-family) launches every native messaging
// host with the calling extension's origin URL as positional argv[1] —
// e.g. `chrome-extension://<id>/`. If the host treats unknown args as
// fatal, it exits with code 2 before reading stdin and the browser
// reports "Native host has exited." This bit us in v0.5.x prior to 0.5.3.
#[test]
fn host_ignores_chrome_extension_origin_in_argv() {
    use std::process::{Command, Stdio};
    use std::io::Write;
    let bin = env!("CARGO_BIN_EXE_zpwrchrome-host");
    let mut child = Command::new(bin)
        .arg("chrome-extension://ojnilaicjhpoamcfconboophcbfpegbk/")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().expect("spawn host");
    let payload = br#"{"action":"dl.list"}"#;
    let len = (payload.len() as u32).to_le_bytes();
    {
        let stdin = child.stdin.as_mut().unwrap();
        stdin.write_all(&len).unwrap();
        stdin.write_all(payload).unwrap();
    }
    let out = child.wait_with_output().expect("wait host");
    assert!(out.status.success(), "host exited {:?}; stderr={}", out.status, String::from_utf8_lossy(&out.stderr));
    let stdout = out.stdout;
    assert!(stdout.len() >= 4, "no framed response");
    let resp_body = std::str::from_utf8(&stdout[4..]).expect("utf-8 response");
    assert!(resp_body.contains("\"status\":\"ok\""), "unexpected body: {resp_body}");
}

#[test]
fn host_rejects_truly_unknown_argv() {
    use std::process::{Command, Stdio};
    let bin = env!("CARGO_BIN_EXE_zpwrchrome-host");
    let out = Command::new(bin)
        .arg("--nonsense")
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().expect("spawn host")
        .wait_with_output().expect("wait host");
    assert!(!out.status.success(), "host should exit non-zero on unknown args");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("unknown argument"), "stderr should mention unknown arg: {stderr}");
}

#[test]
fn expand_home_resolves_tilde_against_home_env() {
    use zpwrchrome_host::extensions::dl::expand_home;
    // Set a stable HOME for this test; restore at end.
    let prior = std::env::var("HOME").ok();
    std::env::set_var("HOME", "/tmp/zp-expand-home");
    assert_eq!(expand_home("~/Downloads").to_string_lossy(), "/tmp/zp-expand-home/Downloads");
    assert_eq!(expand_home("~").to_string_lossy(),           "/tmp/zp-expand-home");
    // Non-tilde paths unchanged.
    assert_eq!(expand_home("/absolute/x").to_string_lossy(), "/absolute/x");
    assert_eq!(expand_home("relative/y").to_string_lossy(),  "relative/y");
    match prior {
        Some(v) => std::env::set_var("HOME", v),
        None    => std::env::remove_var("HOME"),
    }
}

#[test]
fn dl_add_with_tilde_dir_expands_to_home_in_state() {
    let cache = tempdir("dl-tilde");
    fs::create_dir_all(&cache).unwrap();
    let home = tempdir("dl-tilde-home");
    fs::create_dir_all(&home).unwrap();
    let resp = run_with_env(
        &json!({
            "action": "dl.add",
            "url":    "https://example.invalid/x.bin",
            "dir":    "~/somesub",
            "name":   "x.bin",
            "cookies": "",
            "userAgent": "test"
        }),
        &[
            ("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy()),
            ("HOME",                     &home.to_string_lossy()),
        ],
    );
    let dest = resp["data"]["dest"].as_str().unwrap_or("");
    assert!(dest.starts_with(&*home.to_string_lossy()), "expected expanded dest, got {dest}");
    assert!(!dest.contains("~"), "dest must not contain literal ~: {dest}");
    let _ = fs::remove_dir_all(&cache);
    let _ = fs::remove_dir_all(&home);
}

#[test]
fn dl_list_emits_dest_exists_true_for_existing_files_false_for_missing() {
    let cache = tempdir("dl-presence");
    fs::create_dir_all(&cache).unwrap();
    let touch = cache.join("real.bin");
    fs::write(&touch, b"x").unwrap();
    let dead = cache.join("ghost.bin");
    // Two state files: one points at a real file, one at a path we never create.
    for (gid, dest) in [(101u64, &touch), (102u64, &dead)] {
        let st = json!({
            "gid": gid, "url": format!("https://x/{gid}"),
            "dest": dest.to_string_lossy(),
            "total": 1, "done": 1, "status": "done", "err": null,
            "segments": 1, "started_at": 1, "elapsed_ms": 0,
            "paused": false, "cancelled": false, "cookies": "", "userAgent": ""
        });
        fs::write(cache.join(format!("gid_{gid:06}.json")),
                  serde_json::to_vec_pretty(&st).unwrap()).unwrap();
    }
    let resp = run_with_env(
        &json!({ "action": "dl.list" }),
        &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())],
    );
    let jobs = resp["data"]["jobs"].as_array().unwrap();
    let real = jobs.iter().find(|j| j["gid"] == 101).unwrap();
    let ghost = jobs.iter().find(|j| j["gid"] == 102).unwrap();
    assert_eq!(real["dest_exists"],  true,  "existing file must report dest_exists=true");
    assert_eq!(ghost["dest_exists"], false, "missing file must report dest_exists=false");
    let _ = fs::remove_dir_all(&cache);
}

#[test]
fn dl_open_dir_refuses_to_reveal_a_path_that_does_not_exist() {
    let cache = tempdir("dl-open-ghost");
    fs::create_dir_all(&cache).unwrap();
    let ghost = cache.join("not-real.bin");
    let resp = run_with_env(
        &json!({ "action": "dl.openDir", "dir": ghost.to_string_lossy() }),
        &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())],
    );
    assert_eq!(resp["status"], "error", "dl.openDir on missing path must error, not silently create");
    let msg = resp["params"]["message"].as_str().unwrap_or("");
    assert!(msg.contains("does not exist"), "expected does-not-exist error, got: {msg}");
    let _ = fs::remove_dir_all(&cache);
}

#[test]
fn dl_resume_respawns_worker_when_state_paused_but_old_pid_is_dead() {
    // Mirrors the user-reported "resume sticks on pending" symptom:
    // worker died (Chrome closed, SW reaped) while paused; resume must
    // detect the dead PID and start a fresh worker, not just flip the flag.
    use std::time::Duration;
    let cache = tempdir("dl-resume-dead");
    fs::create_dir_all(&cache).unwrap();
    // Pick a PID that is guaranteed-dead — PID 0x7FFFFFFE is far above any
    // real process and `kill(pid, 0)` will return ESRCH.
    let st = json!({
        "gid": 7, "url": "https://example.invalid/x.bin", "dest": "/tmp/zp-resume-dead.bin",
        "total": 100, "done": 30, "status": "paused", "err": null,
        "segments": 1, "started_at": 1, "elapsed_ms": 0,
        "paused": true, "cancelled": false, "cookies": "", "userAgent": "",
        "worker_pid": 0x7FFFFFFE_u32,
    });
    fs::write(cache.join("gid_000007.json"),
              serde_json::to_vec_pretty(&st).unwrap()).unwrap();

    let resp = run_with_env(
        &json!({ "action": "dl.resume", "gid": 7 }),
        &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())],
    );
    assert_eq!(resp["status"], "ok", "dl.resume must succeed: {resp}");

    // Give the spawned worker time to start, fail-fast on the invalid URL,
    // and reach a terminal state. We don't need it to succeed — we just need
    // proof a worker actually ran (status changed away from "pending").
    std::thread::sleep(Duration::from_millis(500));
    let on_disk = fs::read_to_string(cache.join("gid_000007.json")).unwrap();
    let job: serde_json::Value = serde_json::from_str(&on_disk).unwrap();
    let status = job["status"].as_str().unwrap_or("");
    assert!(
        matches!(status, "active" | "failed" | "done"),
        "expected a worker to have started; status stayed {status:?} (full state: {job:#})",
    );
    let _ = fs::remove_dir_all(&cache);
}

#[test]
fn dl_resume_leaves_old_worker_alone_when_pid_is_alive() {
    // Inverse case: paused state with a LIVE worker_pid. dl_resume must
    // NOT spawn a second worker — only flip paused=false so the existing
    // one breaks out of its sleep loop. Use std::process::id() of the
    // current test process as the "alive" pid.
    let cache = tempdir("dl-resume-alive");
    fs::create_dir_all(&cache).unwrap();
    let my_pid = std::process::id();
    let st = json!({
        "gid": 8, "url": "https://example.invalid/y.bin", "dest": "/tmp/zp-resume-alive.bin",
        "total": 100, "done": 30, "status": "paused", "err": null,
        "segments": 1, "started_at": 1, "elapsed_ms": 0,
        "paused": true, "cancelled": false, "cookies": "", "userAgent": "",
        "worker_pid": my_pid,
    });
    fs::write(cache.join("gid_000008.json"),
              serde_json::to_vec_pretty(&st).unwrap()).unwrap();

    let resp = run_with_env(
        &json!({ "action": "dl.resume", "gid": 8 }),
        &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())],
    );
    assert_eq!(resp["status"], "ok");

    // Immediately after: only the flag was flipped, nothing has run a worker yet.
    let job: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(cache.join("gid_000008.json")).unwrap()).unwrap();
    assert_eq!(job["paused"], false, "paused flag must be cleared");
    assert_eq!(job["status"], "pending", "no new worker, status stays pending until live worker picks up");
    assert_eq!(job["worker_pid"], my_pid, "live worker_pid must NOT be overwritten");
    let _ = fs::remove_dir_all(&cache);
}

#[test]
fn looks_like_query_garbage_recognizes_cdn_path_components() {
    use zpwrchrome_host::extensions::dl::looks_like_query_garbage;
    // Real basenames pass.
    assert!(!looks_like_query_garbage("True_Samples.zip"));
    assert!(!looks_like_query_garbage("setup.exe"));
    assert!(!looks_like_query_garbage("notes.md"));
    // Query-string-as-path → reject.
    assert!(looks_like_query_garbage(
        "J6bpmRyOJonT3VoXnDag%3D%3D&limit=0&content_type=application%2Fzip&owner_uid=1425749744"
    ));
    assert!(looks_like_query_garbage("foo=1&bar=2&baz=3"));
    // No extension at all → reject (worker will rename via Content-Disposition).
    assert!(looks_like_query_garbage("noextension"));
    // Extension >8 chars → reject.
    assert!(looks_like_query_garbage("file.toolongext"));
    // Extension containing query chars → reject.
    assert!(looks_like_query_garbage("file.zip%3D"));
}

#[test]
fn parse_content_disposition_filename_handles_all_three_forms() {
    use zpwrchrome_host::extensions::dl::parse_content_disposition_filename as p;
    assert_eq!(p("attachment; filename=\"True Samples.zip\""), Some("True Samples.zip".into()));
    assert_eq!(p("attachment; filename=plain.zip"),            Some("plain.zip".into()));
    assert_eq!(p("attachment; filename*=UTF-8''True%20Samples.zip"),
               Some("True Samples.zip".into()));
    // RFC 5987 wins when both are present.
    assert_eq!(
        p("attachment; filename=fallback.zip; filename*=UTF-8''Real%20Name.zip"),
        Some("Real Name.zip".into()),
    );
    // Path traversal stripped.
    assert_eq!(
        p("attachment; filename=\"../../etc/passwd\""),
        Some("passwd".into()),
    );
    // No filename token → None.
    assert_eq!(p("inline"), None);
}

#[test]
fn guess_filename_rejects_query_garbage_so_worker_can_rename_later() {
    use zpwrchrome_host::extensions::dl::guess_filename;
    // Real filename in path → kept.
    assert_eq!(
        guess_filename("https://example.com/files/setup.exe"),
        Some("setup.exe".into()),
    );
    // CDN URL whose only path component is a query-string-style blob → None.
    let bad = "https://cdn.example.com/J6bpmRyOJonT3VoXnDag%3D%3D&limit=0&content_type=application%2Fzip";
    assert_eq!(guess_filename(bad), None,
        "CDN garbage must be rejected so the worker's HEAD rename wins");
    // Percent-encoded but otherwise valid filename → decoded.
    assert_eq!(
        guess_filename("https://example.com/dir/My%20File.pdf"),
        Some("My File.pdf".into()),
    );
}

#[test]
fn percent_decode_handles_utf8_and_invalid_escapes() {
    use zpwrchrome_host::extensions::dl::percent_decode;
    assert_eq!(percent_decode("hello%20world"),    "hello world");
    assert_eq!(percent_decode("a%2Fb"),            "a/b");
    // Invalid % escapes left literal.
    assert_eq!(percent_decode("%ZZ"),              "%ZZ");
    assert_eq!(percent_decode("trailing%2"),       "trailing%2");
    // Multi-byte UTF-8 (caf%C3%A9 = "café").
    assert_eq!(percent_decode("caf%C3%A9"),        "café");
}

#[test]
fn apply_naming_mask_substitutes_all_tokens() {
    use zpwrchrome_host::extensions::dl::apply_naming_mask;
    // *name* + *ext* are the workhorse pair.
    assert_eq!(
        apply_naming_mask("*name*.*ext*", "report.pdf", "https://x/r"),
        "report.pdf",
    );
    // *host* + *date* come from URL + clock.
    let r = apply_naming_mask("*host*-*name*.*ext*", "song.mp3", "https://music.example/album/song.mp3");
    assert!(r.starts_with("music.example-song.mp3"), "got {r}");
    // *subdirs* preserves the in-URL directory components.
    assert_eq!(
        apply_naming_mask("*subdirs*/*name*.*ext*", "a.jpg", "https://x.com/photos/2024/a.jpg"),
        "photos/2024/a.jpg",
    );
    // *flat* replaces slashes with underscores.
    assert_eq!(
        apply_naming_mask("*flat*", "a.jpg", "https://x.com/photos/2024/a.jpg"),
        "photos_2024_a.jpg",
    );
    // No extension on basename → *ext* empty.
    assert_eq!(
        apply_naming_mask("[*ext*]*name*", "README", "https://x/y"),
        "[]README",
    );
    // Empty mask passes the original filename through verbatim.
    assert_eq!(apply_naming_mask("", "thing.zip", "https://x"), "thing.zip");
    // Unknown tokens stay literal so users can detect typos.
    assert_eq!(apply_naming_mask("*nope*-*name*.*ext*", "a.b", "https://x"),
               "*nope*-a.b");
}

#[test]
fn apply_naming_mask_date_format_is_yyyy_mm_dd() {
    use zpwrchrome_host::extensions::dl::apply_naming_mask;
    let r = apply_naming_mask("*date*", "a.b", "https://x");
    assert!(r.len() == 10 && &r[4..5] == "-" && &r[7..8] == "-", "got {r}");
    // YYYY = 4 digits.
    for (i, c) in r.chars().enumerate() {
        if i == 4 || i == 7 { continue; }
        assert!(c.is_ascii_digit(), "non-digit at {i} in {r}");
    }
}

#[test]
fn dl_add_with_mask_writes_state_using_masked_filename() {
    let cache = tempdir("dl-mask");
    fs::create_dir_all(&cache).unwrap();
    let dir = tempdir("dl-mask-out");
    fs::create_dir_all(&dir).unwrap();
    let resp = run_with_env(
        &json!({
            "action":  "dl.add",
            "url":     "https://example.invalid/photos/2024/sunset.jpg",
            "dir":     dir.to_string_lossy(),
            "name":    "sunset.jpg",
            "mask":    "*host*-*name*.*ext*",
            "cookies": "",
            "userAgent": "test"
        }),
        &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())],
    );
    let dest = resp["data"]["dest"].as_str().unwrap_or("");
    assert!(dest.ends_with("example.invalid-sunset.jpg"), "got {dest}");
    let _ = fs::remove_dir_all(&cache);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn dl_write_file_writes_decoded_bytes_to_dir_name() {
    let cache = tempdir("dl-writefile");
    fs::create_dir_all(&cache).unwrap();
    let dst_dir = tempdir("dl-writefile-out");
    fs::create_dir_all(&dst_dir).unwrap();
    // "hello world" → base64 = "aGVsbG8gd29ybGQ="
    let resp = run_with_env(
        &json!({
            "action": "dl.writeFile",
            "dir":    dst_dir.to_string_lossy(),
            "name":   "greeting.txt",
            "base64": "aGVsbG8gd29ybGQ="
        }),
        &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())],
    );
    assert_eq!(resp["status"], "ok", "dl.writeFile must succeed: {resp}");
    let dest = resp["data"]["dest"].as_str().unwrap_or("");
    assert!(dest.ends_with("greeting.txt"), "got {dest}");
    let got = fs::read_to_string(dest).unwrap();
    assert_eq!(got, "hello world");
    assert_eq!(resp["data"]["bytes"], 11);
    let _ = fs::remove_dir_all(&cache);
    let _ = fs::remove_dir_all(&dst_dir);
}

#[test]
fn dl_write_file_uses_unique_dest_path_on_conflict() {
    let cache = tempdir("dl-writefile-conflict");
    fs::create_dir_all(&cache).unwrap();
    let dst_dir = tempdir("dl-writefile-conflict-out");
    fs::create_dir_all(&dst_dir).unwrap();
    fs::write(dst_dir.join("a.bin"), b"existing").unwrap();
    let resp = run_with_env(
        &json!({
            "action": "dl.writeFile",
            "dir":    dst_dir.to_string_lossy(),
            "name":   "a.bin",
            "base64": "ZnJlc2g="    // "fresh"
        }),
        &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())],
    );
    assert_eq!(resp["status"], "ok");
    let dest = resp["data"]["dest"].as_str().unwrap_or("");
    assert!(dest.contains("a") && dest.ends_with(".bin"));
    assert_ne!(dest, dst_dir.join("a.bin").to_string_lossy(),
               "existing file must not be clobbered");
    let _ = fs::remove_dir_all(&cache);
    let _ = fs::remove_dir_all(&dst_dir);
}

#[test]
fn dl_write_file_errors_on_missing_name() {
    let cache = tempdir("dl-writefile-noname");
    fs::create_dir_all(&cache).unwrap();
    let resp = run_with_env(
        &json!({ "action": "dl.writeFile", "base64": "QUE=" }),
        &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())],
    );
    assert_eq!(resp["status"], "error");
    let msg = resp["params"]["message"].as_str().unwrap_or("");
    assert!(msg.contains("missing name"), "got {msg}");
    let _ = fs::remove_dir_all(&cache);
}

#[test]
fn dl_write_file_chunk_streams_two_chunks_and_renames_to_final_dest() {
    let cache = tempdir("dl-chunk");
    fs::create_dir_all(&cache).unwrap();
    let dst_dir = tempdir("dl-chunk-out");
    fs::create_dir_all(&dst_dir).unwrap();
    let env = [("ZPWRCHROME_DL_CACHE_DIR", cache.to_string_lossy().to_string())];
    let env_refs: Vec<(&str, &str)> = env.iter().map(|(k, v)| (*k, v.as_str())).collect();

    // "hello world" split into "hello" + " world" → b64 "aGVsbG8=" + "IHdvcmxk"
    let r1 = run_with_env(
        &json!({
            "action":     "dl.writeFileChunk",
            "sessionId":  "abc123",
            "chunkIndex": 0,
            "base64":     "aGVsbG8=",
            "final":      false
        }),
        &env_refs,
    );
    assert_eq!(r1["status"], "ok");
    assert_eq!(r1["data"]["final"], false);

    let r2 = run_with_env(
        &json!({
            "action":     "dl.writeFileChunk",
            "sessionId":  "abc123",
            "chunkIndex": 1,
            "base64":     "IHdvcmxk",
            "final":      true,
            "dir":        dst_dir.to_string_lossy(),
            "name":       "out.txt"
        }),
        &env_refs,
    );
    assert_eq!(r2["status"], "ok");
    let dest = r2["data"]["dest"].as_str().unwrap_or("");
    assert!(dest.ends_with("out.txt"));
    let got = fs::read_to_string(dest).unwrap();
    assert_eq!(got, "hello world");
    assert_eq!(r2["data"]["bytes"], 11);

    // .part scratch file must be gone after the rename.
    assert!(!cache.join("upload-abc123.part").exists());
    let _ = fs::remove_dir_all(&cache);
    let _ = fs::remove_dir_all(&dst_dir);
}

#[test]
fn dl_write_file_chunk_rejects_path_traversal_session_ids() {
    let cache = tempdir("dl-chunk-traversal");
    fs::create_dir_all(&cache).unwrap();
    let resp = run_with_env(
        &json!({
            "action":     "dl.writeFileChunk",
            "sessionId":  "../etc/passwd",
            "chunkIndex": 0,
            "base64":     "aGV5"
        }),
        &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())],
    );
    // Sanitizer keeps only [A-Za-z0-9_-]; "../etc/passwd" → "etcpasswd".
    // The chunk write goes to cache/upload-etcpasswd.part, which is benign.
    assert_eq!(resp["status"], "ok");
    let part = cache.join("upload-etcpasswd.part");
    assert!(part.exists(), "sanitized sessionId must be written under cache");
    // No file written to /etc/passwd (we'd never have permission anyway,
    // but assert the sanitized name doesn't escape).
    let _ = fs::remove_dir_all(&cache);
}

#[test]
fn probe_headers_exists_with_head_then_range_get_fallback() {
    // GitHub release downloads redirect to objects.githubusercontent.com
    // S3 pre-signed URLs that 401 on HEAD because the signature is bound
    // to the GET method. probe_headers must fall back to Range:bytes=0-0
    // GET when HEAD fails. This test pins the shape of that fallback at
    // the source level — there's no easy way to integration-test it
    // without an actual misbehaving mock server, but the structural pins
    // catch the most common drift (someone reverting to head_req.call()).
    let src = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/extensions/dl.rs")
    ).unwrap();
    assert!(src.contains("fn probe_headers("),
        "probe_headers helper missing");
    let probe = src.split("fn probe_headers(").nth(1).unwrap();
    let probe_end = probe.find("\nfn ").unwrap_or(probe.len());
    let probe = &probe[..probe_end];
    assert!(probe.contains("ureq::head(url)"),
        "probe_headers must try HEAD first");
    assert!(probe.contains("ureq::get(url)"),
        "probe_headers must fall back to GET on HEAD failure");
    assert!(probe.contains(r#"set("Range", "bytes=0-0")"#),
        "fallback GET must use Range: bytes=0-0 to discover length cheaply");
    assert!(probe.contains("Content-Range"),
        "must parse Content-Range from the 206 response");
    assert!(probe.contains("status == 206"),
        "must branch on 206 (Range honored) vs 200 (Range ignored)");
    // Caller uses probe_headers, not raw ureq::head().call() inline.
    let worker = src.split("pub fn run_worker(").nth(1).unwrap_or("");
    let worker_end = worker.find("\nfn ").unwrap_or(worker.len());
    let worker = &worker[..worker_end];
    assert!(worker.contains("probe_headers(&state.url"),
        "run_worker must call probe_headers, not ureq::head() inline");
    assert!(!worker.contains("ureq::head"),
        "no raw ureq::head call in run_worker — must go through probe_headers");
}

#[test]
fn dl_remove_cancels_and_deletes_state_file() {
    let cache = tempdir("dl-remove");
    fs::create_dir_all(&cache).unwrap();
    let st = json!({
        "gid": 99, "url": "https://example.invalid/x", "dest": "/tmp/x",
        "total": 100, "done": 30, "status": "active", "err": null,
        "segments": 1, "started_at": 1, "elapsed_ms": 0,
        "paused": false, "cancelled": false, "cookies": "", "userAgent": ""
    });
    fs::write(cache.join("gid_000099.json"),
              serde_json::to_vec_pretty(&st).unwrap()).unwrap();

    let resp = run_with_env(
        &json!({ "action": "dl.remove", "gid": 99 }),
        &[("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy())],
    );
    assert_eq!(resp["status"], "ok", "dl.remove must succeed: {resp}");
    assert_eq!(resp["data"]["status"], "removed");
    assert!(!cache.join("gid_000099.json").exists(),
        "state file must be gone after dl.remove");
    let _ = fs::remove_dir_all(&cache);
}

/// HTTP server that simulates a flaky CDN closing connections early.
///
/// - `truncate_once`: the FIRST GET (across all segments) writes only half
///   the bytes it advertised, then drops the connection — a premature EOF.
///   The download must resume and still finish complete.
/// - `cap`: never serve a byte at/after this absolute offset. A ranged GET
///   whose start is past `cap` returns a 206 header but writes zero bytes and
///   closes, so the download can never progress past `cap` — it must fail,
///   never report "done".
///
/// The advertised Content-Length always reflects the FULL slice/file; the
/// truncation is the connection closing before those bytes arrive, exactly
/// the real-world failure that used to render as "DONE  10.2 GB / 12.2 GB".
fn start_flaky_server(
    payload: Arc<Vec<u8>>,
    truncate_once: Arc<AtomicBool>,
    cap: Option<usize>,
) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let mut stream = match stream { Ok(s) => s, Err(_) => continue };
            let p = Arc::clone(&payload);
            let once = Arc::clone(&truncate_once);
            thread::spawn(move || {
                let mut buf = [0u8; 8192];
                let mut req = Vec::new();
                loop {
                    let n = match stream.read(&mut buf) { Ok(n) => n, Err(_) => return };
                    if n == 0 { return; }
                    req.extend_from_slice(&buf[..n]);
                    if req.windows(4).any(|w| w == b"\r\n\r\n") { break; }
                }
                let req_str = String::from_utf8_lossy(&req).into_owned();
                let first   = req_str.lines().next().unwrap_or("").to_string();
                let method  = first.split_whitespace().next().unwrap_or("").to_string();
                let range_header = req_str.lines().find_map(|l| {
                    l.strip_prefix("Range: ")
                        .or_else(|| l.strip_prefix("range: "))
                        .map(|s| s.trim().to_string())
                });
                if method == "HEAD" {
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n",
                        p.len()
                    );
                    let _ = stream.write_all(resp.as_bytes());
                    return;
                }
                if method != "GET" { return; }
                let (start, end) = match range_header.as_deref().and_then(|r| r.strip_prefix("bytes=")) {
                    Some(rest) => {
                        let parts: Vec<&str> = rest.split('-').collect();
                        let s: usize = parts.first().and_then(|x| x.parse().ok()).unwrap_or(0);
                        let e: usize = parts.get(1).and_then(|x| x.parse().ok()).unwrap_or(p.len() - 1);
                        (s, e)
                    }
                    None => (0, p.len() - 1),
                };
                // Past the cap: advertise the range but send nothing, then close.
                if let Some(c) = cap {
                    if start >= c {
                        let resp = format!(
                            "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n",
                            end - start + 1, start, end, p.len()
                        );
                        let _ = stream.write_all(resp.as_bytes());
                        return;   // zero body → premature EOF with no progress
                    }
                }
                // Clamp the served tail to the cap so the boundary segment
                // stalls exactly at `cap` on its next resume.
                let served_end = match cap {
                    Some(c) => end.min(c - 1),
                    None    => end,
                };
                let full = &p[start..=served_end];
                let resp = format!(
                    "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n",
                    full.len(), start, served_end, p.len()
                );
                let _ = stream.write_all(resp.as_bytes());
                // First GET truncates to half its body then closes early.
                if once.swap(true, Ordering::SeqCst) == false {
                    let half = full.len() / 2;
                    let _ = stream.write_all(&full[..half]);
                } else {
                    let _ = stream.write_all(full);
                }
            });
        }
    });
    port
}

#[test]
fn dl_recovers_from_premature_eof_and_finishes_complete() {
    // A segment's first connection closes after only half its range arrives.
    // Before the fix run_segment returned Ok(()) on that EOF and the worker
    // stamped "done" on a short file. The resume must complete the file.
    let payload = Arc::new(make_payload(2 * 1024 * 1024));   // 2 MiB → segmented
    let truncate_once = Arc::new(AtomicBool::new(false));
    let port = start_flaky_server(Arc::clone(&payload), Arc::clone(&truncate_once), None);
    let cache  = tempdir("dl-trunc-once-cache");
    let dlroot = tempdir("dl-trunc-once-dest");

    let resp = run_with_env(
        &json!({
            "action":   "dl.add",
            "url":      format!("http://127.0.0.1:{port}/file.bin"),
            "dir":      dlroot.to_string_lossy(),
            "name":     "file.bin",
            "segments": 4,
        }),
        &[
            ("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy()),
            ("ZPWRCHROME_DL_DIR",       &dlroot.to_string_lossy()),
        ],
    );
    assert_eq!(resp["status"], "ok", "dl.add response: {resp}");
    let gid: u64 = resp["data"]["gid"].as_u64().expect("gid");
    let dest = resp["data"]["dest"].as_str().expect("dest").to_string();

    let final_state = wait_for_done(&cache, gid, DONE_TIMEOUT);
    assert_eq!(final_state["status"], "done",
        "must resume past the truncated connection and finish: {final_state}");
    let bytes = fs::read(&dest).expect("dest readable");
    assert_eq!(bytes.len(), payload.len(), "size mismatch after recovery");
    assert_eq!(bytes, *payload, "content mismatch after recovery");
    assert_eq!(final_state["done"].as_u64().unwrap_or(0), payload.len() as u64,
        "state.done must equal full size: {final_state}");

    let _ = fs::remove_dir_all(&dlroot);
    let _ = fs::remove_dir_all(&cache);
}

#[test]
fn dl_restart_redownloads_a_done_job_from_scratch() {
    // A finished job is restarted: the worker must discard the file, respawn,
    // and re-download from byte zero to a complete copy again.
    let payload = Arc::new(make_payload(2 * 1024 * 1024));   // 2 MiB → segmented
    let port = start_server(Arc::clone(&payload));
    let cache  = tempdir("dl-restart-cache");
    let dlroot = tempdir("dl-restart-dest");
    let envs = [
        ("ZPWRCHROME_DL_CACHE_DIR", cache.to_string_lossy().to_string()),
        ("ZPWRCHROME_DL_DIR",       dlroot.to_string_lossy().to_string()),
    ];
    let env_refs: Vec<(&str, &str)> = envs.iter().map(|(k, v)| (*k, v.as_str())).collect();

    let resp = run_with_env(
        &json!({
            "action":   "dl.add",
            "url":      format!("http://127.0.0.1:{port}/file.bin"),
            "dir":      dlroot.to_string_lossy(),
            "name":     "file.bin",
            "segments": 4,
        }),
        &env_refs,
    );
    assert_eq!(resp["status"], "ok", "dl.add: {resp}");
    let gid: u64 = resp["data"]["gid"].as_u64().expect("gid");
    let dest = resp["data"]["dest"].as_str().expect("dest").to_string();

    let first = wait_for_done(&cache, gid, DONE_TIMEOUT);
    assert_eq!(first["status"], "done", "initial download: {first}");

    // Corrupt the finished file so we can prove restart actually rewrote it.
    fs::write(&dest, b"corrupt").unwrap();

    let r = run_with_env(&json!({ "action": "dl.restart", "gid": gid }), &env_refs);
    assert_eq!(r["status"], "ok", "dl.restart response: {r}");
    assert_eq!(r["data"]["status"], "restarted", "{r}");

    // Poll until it finishes again (status flips away from done→pending→done).
    let start = Instant::now();
    let path = cache.join(format!("gid_{gid:06}.json"));
    loop {
        assert!(start.elapsed() < DONE_TIMEOUT, "restart never re-finished");
        if let Ok(body) = fs::read_to_string(&path) {
            if let Ok(v) = serde_json::from_str::<Value>(&body) {
                if v["status"] == "done" && v["done"].as_u64() == Some(payload.len() as u64) {
                    break;
                }
                if v["status"] == "failed" { panic!("restart failed: {v}"); }
            }
        }
        thread::sleep(Duration::from_millis(50));
    }
    let bytes = fs::read(&dest).expect("dest readable after restart");
    assert_eq!(bytes.len(), payload.len(), "restart size mismatch");
    assert_eq!(bytes, *payload, "restart did not rewrite the corrupt file");

    let _ = fs::remove_dir_all(&dlroot);
    let _ = fs::remove_dir_all(&cache);
}

#[test]
fn dl_marks_failed_not_done_when_server_truncates_permanently() {
    // The server never serves past 50% of the file. The download can never
    // complete; it must end "failed", never "done". This is the regression
    // for "DONE  10.2 GB / 12.2 GB (83%)".
    let size = 2 * 1024 * 1024;
    let payload = Arc::new(make_payload(size));
    let truncate_once = Arc::new(AtomicBool::new(true));   // disable the once-path
    let port = start_flaky_server(Arc::clone(&payload), truncate_once, Some(size / 2));
    let cache  = tempdir("dl-trunc-perma-cache");
    let dlroot = tempdir("dl-trunc-perma-dest");

    let resp = run_with_env(
        &json!({
            "action":   "dl.add",
            "url":      format!("http://127.0.0.1:{port}/file.bin"),
            "dir":      dlroot.to_string_lossy(),
            "name":     "file.bin",
            "segments": 4,
        }),
        &[
            ("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy()),
            ("ZPWRCHROME_DL_DIR",       &dlroot.to_string_lossy()),
        ],
    );
    assert_eq!(resp["status"], "ok", "dl.add response: {resp}");
    let gid: u64 = resp["data"]["gid"].as_u64().expect("gid");

    let final_state = wait_for_done(&cache, gid, DONE_TIMEOUT);
    assert_eq!(final_state["status"], "failed",
        "a permanently-truncated download must be failed, never done: {final_state}");
    assert_ne!(final_state["status"], "done",
        "must never stamp done on a short file: {final_state}");

    let _ = fs::remove_dir_all(&dlroot);
    let _ = fs::remove_dir_all(&cache);
}

/// Server whose HEAD answers 200 but WITHOUT Content-Length (streamed
/// downloads behind X-Accel-Redirect / X-Sendfile, e.g. the teknovault
/// "digital-downloads/download/<uuid>" delivery links). The size is only
/// recoverable from the Range GET's Content-Range. Range GETs are served
/// normally so the download itself completes.
fn start_sizeless_head_server(payload: Arc<Vec<u8>>) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let mut stream = match stream { Ok(s) => s, Err(_) => continue };
            let p = Arc::clone(&payload);
            thread::spawn(move || {
                let mut buf = [0u8; 8192];
                let mut req = Vec::new();
                loop {
                    let n = match stream.read(&mut buf) { Ok(n) => n, Err(_) => return };
                    if n == 0 { return; }
                    req.extend_from_slice(&buf[..n]);
                    if req.windows(4).any(|w| w == b"\r\n\r\n") { break; }
                }
                let req_str = String::from_utf8_lossy(&req).into_owned();
                let first   = req_str.lines().next().unwrap_or("").to_string();
                let method  = first.split_whitespace().next().unwrap_or("").to_string();
                let range_header = req_str.lines().find_map(|l| {
                    l.strip_prefix("Range: ")
                        .or_else(|| l.strip_prefix("range: "))
                        .map(|s| s.trim().to_string())
                });
                if method == "HEAD" {
                    // 200, Accept-Ranges, but deliberately NO Content-Length.
                    let _ = stream.write_all(
                        b"HTTP/1.1 200 OK\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n");
                    return;
                }
                if method != "GET" { return; }
                if let Some(rest) = range_header.as_deref().and_then(|r| r.strip_prefix("bytes=")) {
                    let parts: Vec<&str> = rest.split('-').collect();
                    let start: usize = parts.first().and_then(|x| x.parse().ok()).unwrap_or(0);
                    let end:   usize = parts.get(1).and_then(|x| x.parse().ok()).unwrap_or(p.len() - 1);
                    let slice = &p[start..=end];
                    let resp = format!(
                        "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n",
                        slice.len(), start, end, p.len()
                    );
                    let _ = stream.write_all(resp.as_bytes());
                    let _ = stream.write_all(slice);
                    return;
                }
                // Non-range GET: chunked-style with no Content-Length.
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n");
                let _ = stream.write_all(&p);
            });
        }
    });
    port
}

#[test]
fn dl_recovers_total_when_head_omits_content_length() {
    // Regression for restarted downloads rendering "2.1 GB / ?": a HEAD that
    // returns 200 without Content-Length used to make probe_headers report
    // total=0 (skipping the Range-GET fallback). The worker must recover the
    // size from the Range GET's Content-Range and persist a real total.
    let payload = Arc::new(make_payload(2 * 1024 * 1024));   // 2 MiB → segmented
    let port = start_sizeless_head_server(Arc::clone(&payload));
    let cache  = tempdir("dl-sizeless-cache");
    let dlroot = tempdir("dl-sizeless-dest");

    let resp = run_with_env(
        &json!({
            "action":   "dl.add",
            "url":      format!("http://127.0.0.1:{port}/download/abc?from=Thank%20you%20page"),
            "dir":      dlroot.to_string_lossy(),
            "name":     "file.bin",
            "segments": 4,
        }),
        &[
            ("ZPWRCHROME_DL_CACHE_DIR", &cache.to_string_lossy()),
            ("ZPWRCHROME_DL_DIR",       &dlroot.to_string_lossy()),
        ],
    );
    assert_eq!(resp["status"], "ok", "dl.add: {resp}");
    let gid: u64 = resp["data"]["gid"].as_u64().expect("gid");
    let dest = resp["data"]["dest"].as_str().expect("dest").to_string();

    let final_state = wait_for_done(&cache, gid, DONE_TIMEOUT);
    assert_eq!(final_state["status"], "done", "{final_state}");
    assert_eq!(final_state["total"].as_u64().unwrap_or(0), payload.len() as u64,
        "total must be recovered from the Range GET, not left at 0 (UI shows '/ ?'): {final_state}");
    let bytes = fs::read(&dest).expect("dest readable");
    assert_eq!(bytes, *payload, "content mismatch");

    let _ = fs::remove_dir_all(&dlroot);
    let _ = fs::remove_dir_all(&cache);
}
