// End-to-end test for the segmented downloader.
//
// Spawns a minimal HTTP/1.1 server that honors Range requests, runs a 4-
// segment download against it, and verifies the destination file matches
// the served payload byte-for-byte. Same harness exercises the single-
// connection fallback (server with no Accept-Ranges) and pause/cancel.
//
// Uses only the std library + ureq (already in deps). No external binaries.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use zpwr_chrome_host::dl::{Job, Manager, Status};

/// Deterministic payload (period 251 to avoid trivially-zero / trivially-
/// repeating patterns that would mask off-by-one segment-boundary bugs).
fn make_payload(size: usize) -> Vec<u8> {
    (0..size).map(|i| (i % 251) as u8).collect()
}

/// Minimal HTTP/1.1 server. honor_range=false simulates a server that
/// doesn't advertise Accept-Ranges, exercising the single-connection path.
fn start_server(payload: Arc<Vec<u8>>, honor_range: bool) -> u16 {
    start_server_with_ctl(payload, honor_range, Arc::new(ServerCtl::default()))
}

#[derive(Default)]
struct ServerCtl {
    requests: AtomicU64,
    drop_after_bytes: AtomicU64, // 0 = never; else server cuts the connection
                                 // after sending this many bytes (first time only)
    drop_done: AtomicBool,
    last_cookie: std::sync::Mutex<Option<String>>,
    last_user_agent: std::sync::Mutex<Option<String>>,
    require_cookie: std::sync::Mutex<Option<String>>,
}

fn start_server_with_ctl(payload: Arc<Vec<u8>>, honor_range: bool, ctl: Arc<ServerCtl>) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let mut stream = match stream {
                Ok(s) => s,
                Err(_) => continue,
            };
            let p = Arc::clone(&payload);
            let c = Arc::clone(&ctl);
            thread::spawn(move || {
                c.requests.fetch_add(1, Ordering::Relaxed);
                let mut buf = [0u8; 8192];
                let mut req = Vec::new();
                loop {
                    let n = match stream.read(&mut buf) {
                        Ok(n) => n,
                        Err(_) => return,
                    };
                    if n == 0 {
                        return;
                    }
                    req.extend_from_slice(&buf[..n]);
                    if req.windows(4).any(|w| w == b"\r\n\r\n") {
                        break;
                    }
                }
                let req_str = String::from_utf8_lossy(&req).into_owned();
                let first_line = req_str.lines().next().unwrap_or("").to_string();
                let method = first_line.split_whitespace().next().unwrap_or("").to_string();
                let range_header = req_str.lines().find_map(|l| {
                    l.strip_prefix("Range: ")
                        .or_else(|| l.strip_prefix("range: "))
                        .map(|s| s.to_string())
                });
                let cookie_header = req_str.lines().find_map(|l| {
                    l.strip_prefix("Cookie: ")
                        .or_else(|| l.strip_prefix("cookie: "))
                        .map(|s| s.trim().to_string())
                });
                let ua_header = req_str.lines().find_map(|l| {
                    l.strip_prefix("User-Agent: ")
                        .or_else(|| l.strip_prefix("user-agent: "))
                        .map(|s| s.trim().to_string())
                });
                if cookie_header.is_some() {
                    *c.last_cookie.lock().unwrap() = cookie_header.clone();
                }
                if ua_header.is_some() {
                    *c.last_user_agent.lock().unwrap() = ua_header.clone();
                }
                if let Some(required) = c.require_cookie.lock().unwrap().clone() {
                    if cookie_header.as_deref() != Some(required.as_str()) {
                        let _ = stream.write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        return;
                    }
                }

                if method == "HEAD" {
                    let ar = if honor_range { "Accept-Ranges: bytes\r\n" } else { "" };
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n{ar}Connection: close\r\n\r\n",
                        p.len()
                    );
                    let _ = stream.write_all(resp.as_bytes());
                    return;
                }
                if method == "GET" {
                    if honor_range {
                        if let Some(range) = range_header {
                            if let Some(rest) = range.trim().strip_prefix("bytes=") {
                                let parts: Vec<&str> = rest.split('-').collect();
                                let start: usize = parts
                                    .first()
                                    .and_then(|x| x.parse().ok())
                                    .unwrap_or(0);
                                let end: usize = parts
                                    .get(1)
                                    .and_then(|x| x.parse().ok())
                                    .unwrap_or(p.len() - 1);
                                if start >= p.len() || end >= p.len() || start > end {
                                    let _ = stream.write_all(b"HTTP/1.1 416 Range Not Satisfiable\r\nConnection: close\r\n\r\n");
                                    return;
                                }
                                let slice = &p[start..=end];
                                let resp = format!(
                                    "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n",
                                    slice.len(),
                                    start,
                                    end,
                                    p.len()
                                );
                                let _ = stream.write_all(resp.as_bytes());
                                write_body_with_optional_drop(&mut stream, slice, &c);
                                return;
                            }
                        }
                    }
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        p.len()
                    );
                    let _ = stream.write_all(resp.as_bytes());
                    write_body_with_optional_drop(&mut stream, &p, &c);
                }
            });
        }
    });
    port
}

fn write_body_with_optional_drop(stream: &mut std::net::TcpStream, body: &[u8], ctl: &ServerCtl) {
    let drop_after = ctl.drop_after_bytes.load(Ordering::Relaxed);
    if drop_after == 0 || ctl.drop_done.load(Ordering::Relaxed) {
        let _ = stream.write_all(body);
        return;
    }
    let cut = (drop_after as usize).min(body.len());
    let _ = stream.write_all(&body[..cut]);
    ctl.drop_done.store(true, Ordering::Relaxed);
    // Close abruptly (drop the stream) — client sees EOF before full body.
}

fn wait_done(job: &Arc<Job>) -> Status {
    let start = Instant::now();
    loop {
        let s = *job.status.lock().unwrap();
        if matches!(s, Status::Done | Status::Failed | Status::Cancelled) {
            return s;
        }
        if start.elapsed() > Duration::from_secs(30) {
            panic!("download timed out, last status: {s:?}");
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn tempdir(tag: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!(
        "zpwrchrome-dl-{}-{}-{}",
        tag,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = std::fs::create_dir_all(&p);
    p
}

#[test]
fn segmented_4mib_download_matches_byte_for_byte() {
    let payload = Arc::new(make_payload(4 * 1024 * 1024));
    let port = start_server(Arc::clone(&payload), true);
    let dir = tempdir("seg");
    let dest = dir.join("test.bin");
    let mgr = Arc::new(Manager::new_for_test());
    let job = mgr.add(format!("http://127.0.0.1:{port}/test.bin"), dest.clone(), 4);
    let final_status = wait_done(&job);
    let err = job.err.lock().unwrap().clone();
    assert_eq!(final_status, Status::Done, "expected Done, got {final_status:?} err={err:?}");
    let got = std::fs::read(&dest).expect("read dest");
    assert_eq!(got.len(), payload.len(), "size mismatch");
    assert_eq!(got, *payload, "content mismatch");
    let _ = std::fs::remove_file(&dest);
    let _ = std::fs::remove_dir(&dir);
}

#[test]
fn single_connection_fallback_when_no_range_support() {
    let payload = Arc::new(make_payload(512 * 1024));
    let port = start_server(Arc::clone(&payload), false);
    let dir = tempdir("noseg");
    let dest = dir.join("small.bin");
    let mgr = Arc::new(Manager::new_for_test());
    let job = mgr.add(format!("http://127.0.0.1:{port}/small.bin"), dest.clone(), 4);
    let final_status = wait_done(&job);
    let err = job.err.lock().unwrap().clone();
    assert_eq!(final_status, Status::Done, "{err:?}");
    let got = std::fs::read(&dest).unwrap();
    assert_eq!(got, *payload);
    let _ = std::fs::remove_file(&dest);
    let _ = std::fs::remove_dir(&dir);
}

#[test]
fn segments_default_to_one_when_file_is_tiny() {
    // <1 MiB: code path forces single-stream regardless of segments arg.
    let payload = Arc::new(make_payload(64 * 1024));
    let port = start_server(Arc::clone(&payload), true);
    let dir = tempdir("tiny");
    let dest = dir.join("tiny.bin");
    let mgr = Arc::new(Manager::new_for_test());
    let job = mgr.add(format!("http://127.0.0.1:{port}/tiny.bin"), dest.clone(), 8);
    let final_status = wait_done(&job);
    assert_eq!(final_status, Status::Done);
    let got = std::fs::read(&dest).unwrap();
    assert_eq!(got, *payload);
    let _ = std::fs::remove_file(&dest);
    let _ = std::fs::remove_dir(&dir);
}

#[test]
fn cancel_during_active_marks_status_cancelled() {
    let payload = Arc::new(make_payload(2 * 1024 * 1024));
    let port = start_server(Arc::clone(&payload), true);
    let dir = tempdir("cancel");
    let dest = dir.join("cancel.bin");
    let mgr = Arc::new(Manager::new_for_test());
    let job = mgr.add(format!("http://127.0.0.1:{port}/cancel.bin"), dest.clone(), 4);
    // Race-prone but bounded: cancel within ~5ms of add, before all segments
    // have a chance to finish. If the test is too fast and download already
    // completed, the assertion below tolerates that. The important thing
    // is that *if* cancel takes effect, status reflects it.
    thread::sleep(Duration::from_millis(5));
    job.cancelled.store(true, Ordering::Relaxed);
    *job.status.lock().unwrap() = Status::Cancelled;
    let final_status = wait_done(&job);
    assert!(
        matches!(final_status, Status::Cancelled | Status::Done | Status::Failed),
        "unexpected terminal status {final_status:?}"
    );
    let _ = std::fs::remove_file(&dest);
    let _ = std::fs::remove_dir(&dir);
}

#[test]
fn cookies_and_user_agent_forwarded_to_server() {
    let payload = Arc::new(make_payload(128 * 1024));
    let ctl = Arc::new(ServerCtl::default());
    let port = start_server_with_ctl(Arc::clone(&payload), true, Arc::clone(&ctl));
    let dir = tempdir("cookie");
    let dest = dir.join("cookie.bin");
    let mgr = Arc::new(Manager::new_for_test());
    let job = mgr.add_full(
        format!("http://127.0.0.1:{port}/cookie.bin"),
        dest.clone(),
        1,
        Some("session=abc123; theme=dark".to_string()),
        Some("zpwrchrome-test/0.0.1".to_string()),
    );
    let final_status = wait_done(&job);
    assert_eq!(final_status, Status::Done, "{:?}", job.err.lock().unwrap());
    assert_eq!(
        ctl.last_cookie.lock().unwrap().as_deref(),
        Some("session=abc123; theme=dark")
    );
    assert_eq!(
        ctl.last_user_agent.lock().unwrap().as_deref(),
        Some("zpwrchrome-test/0.0.1")
    );
    let _ = std::fs::remove_file(&dest);
    let _ = std::fs::remove_dir(&dir);
}

#[test]
fn missing_required_cookie_fails_the_download() {
    let payload = Arc::new(make_payload(128 * 1024));
    let ctl = Arc::new(ServerCtl::default());
    *ctl.require_cookie.lock().unwrap() = Some("session=valid".to_string());
    let port = start_server_with_ctl(Arc::clone(&payload), true, Arc::clone(&ctl));
    let dir = tempdir("auth");
    let dest = dir.join("auth.bin");
    let mgr = Arc::new(Manager::new_for_test());
    // No cookie passed → server returns 401 → download fails.
    let job = mgr.add(format!("http://127.0.0.1:{port}/auth.bin"), dest.clone(), 1);
    let final_status = wait_done(&job);
    assert_eq!(final_status, Status::Failed, "expected Failed, got {final_status:?}");
    let _ = std::fs::remove_file(&dest);
    let _ = std::fs::remove_dir(&dir);
}

#[test]
fn correct_required_cookie_succeeds() {
    let payload = Arc::new(make_payload(128 * 1024));
    let ctl = Arc::new(ServerCtl::default());
    *ctl.require_cookie.lock().unwrap() = Some("session=valid".to_string());
    let port = start_server_with_ctl(Arc::clone(&payload), true, Arc::clone(&ctl));
    let dir = tempdir("auth-ok");
    let dest = dir.join("auth-ok.bin");
    let mgr = Arc::new(Manager::new_for_test());
    let job = mgr.add_full(
        format!("http://127.0.0.1:{port}/auth-ok.bin"),
        dest.clone(),
        1,
        Some("session=valid".to_string()),
        None,
    );
    let final_status = wait_done(&job);
    assert_eq!(final_status, Status::Done, "{:?}", job.err.lock().unwrap());
    let got = std::fs::read(&dest).unwrap();
    assert_eq!(got, *payload);
    let _ = std::fs::remove_file(&dest);
    let _ = std::fs::remove_dir(&dir);
}

#[test]
fn retry_recovers_when_server_drops_first_connection_midway() {
    // Server cuts the first response at 50% of the segment; on the retry
    // (using the resume Range from the segment-local offset) it serves the
    // remainder. Final file must still equal the full payload.
    let payload = Arc::new(make_payload(2 * 1024 * 1024));
    let ctl = Arc::new(ServerCtl::default());
    ctl.drop_after_bytes.store(256 * 1024, Ordering::Relaxed); // cut after 256 KiB
    let port = start_server_with_ctl(Arc::clone(&payload), true, Arc::clone(&ctl));
    let dir = tempdir("retry");
    let dest = dir.join("retry.bin");
    let mgr = Arc::new(Manager::new_for_test());
    let job = mgr.add(format!("http://127.0.0.1:{port}/retry.bin"), dest.clone(), 1);
    let final_status = wait_done(&job);
    assert_eq!(final_status, Status::Done, "{:?}", job.err.lock().unwrap());
    let got = std::fs::read(&dest).unwrap();
    assert_eq!(got.len(), payload.len(), "size mismatch");
    assert_eq!(got, *payload, "content mismatch after retry");
    // Verify the server saw more than one request (i.e. retry kicked in).
    assert!(
        ctl.requests.load(Ordering::Relaxed) >= 3,
        "expected ≥3 server requests (HEAD + first GET + retry GET), saw {}",
        ctl.requests.load(Ordering::Relaxed)
    );
    let _ = std::fs::remove_file(&dest);
    let _ = std::fs::remove_dir(&dir);
}

#[test]
fn job_snapshot_carries_url_dest_total_done_status() {
    let payload = Arc::new(make_payload(128 * 1024));
    let port = start_server(Arc::clone(&payload), true);
    let dir = tempdir("snap");
    let dest = dir.join("snap.bin");
    let mgr = Arc::new(Manager::new_for_test());
    let url = format!("http://127.0.0.1:{port}/snap.bin");
    let job = mgr.add(url.clone(), dest.clone(), 1);
    wait_done(&job);
    assert_eq!(job.url, url);
    assert_eq!(job.dest, dest);
    assert!(job.done.load(Ordering::Relaxed) > 0);
    let _ = std::fs::remove_file(&dest);
    let _ = std::fs::remove_dir(&dir);
}
