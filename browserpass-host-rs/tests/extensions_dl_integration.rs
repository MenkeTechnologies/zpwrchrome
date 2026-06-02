// End-to-end test for the file-state download manager. Spawns a local
// HTTP/1.1 server with Range support, invokes browserpass-host-rs with a
// framed `dl.add` request, then polls the state file until the worker
// reports `done`. Verifies the downloaded bytes match the served payload.

use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_browserpass-host-rs")
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

    let final_state = wait_for_done(&cache, gid, Duration::from_secs(30));
    assert_eq!(final_state["status"], "done", "{final_state}");
    let bytes = fs::read(dest).expect("dest file readable");
    assert_eq!(bytes.len(), payload.len(), "size mismatch");
    assert_eq!(bytes, *payload,            "content mismatch");

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
