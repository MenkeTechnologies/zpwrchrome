// Live tests against the maintainer's real ~/.password-store. Each test is
// gated on the presence of `~/.password-store/.gpg-id` so cargo test on CI
// (or any machine without `pass` set up) silently skips them rather than
// failing.
//
// Verifications:
//   1. list      → enumerates every .gpg file that `find ~/.password-store
//                   -name '*.gpg'` does, with the same relative-path format
//   2. tree      → enumerates every subdirectory (minus .git) that a manual
//                   `find ~/.password-store -type d` does
//   3. configure → returns ~/.password-store as the canonical defaultStore.path
//                  when PASSWORD_STORE_DIR points there
//   4. fetch     → optionally compares `host fetch` against `pass show <entry>`
//                  byte-for-byte (gated on BROWSERPASS_LIVE_TEST_ENTRY env var
//                  so we don't trigger a pinentry prompt by default)
//
// Cross-verify any failure by hand with the `pass` CLI — both these tests and
// `pass ls` / `pass show <entry>` read the same `.gpg` files via the same gpg
// binary, so byte-equal output is the contract.

use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const STORE: &str = "/Users/wizard/.password-store";

fn skip_if_no_real_store() -> bool {
    let p = Path::new(STORE).join(".gpg-id");
    if !p.exists() {
        eprintln!("skipping live test — no real pass store at {STORE}");
        return true;
    }
    false
}

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_browserpass-host-rs")
}

fn frame_bytes(payload: &[u8]) -> Vec<u8> {
    let mut v = (payload.len() as u32).to_le_bytes().to_vec();
    v.extend_from_slice(payload);
    v
}

fn read_one_frame(buf: &[u8]) -> Value {
    assert!(buf.len() >= 4, "response too short: {buf:?}");
    let n = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
    serde_json::from_slice(&buf[4..4 + n]).expect("valid JSON")
}

fn run(req: &Value) -> Value {
    run_env(req, &[])
}

fn run_env(req: &Value, env_pairs: &[(&str, &str)]) -> Value {
    let bytes = serde_json::to_vec(req).unwrap();
    let mut cmd = Command::new(bin());
    for (k, v) in env_pairs {
        cmd.env(k, v);
    }
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn");
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(&frame_bytes(&bytes))
        .unwrap();
    drop(child.stdin.take());
    let mut out = Vec::new();
    child.stdout.as_mut().unwrap().read_to_end(&mut out).unwrap();
    let _ = child.wait();
    read_one_frame(&out)
}

// Local walker mirroring the host's list-walker semantics exactly:
// skip `.git`, recurse everything else, collect *.gpg by relative path with
// forward slashes.
fn walk_gpg(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    walk_gpg_inner(root, root, &mut out);
    out.sort();
    out
}

fn walk_gpg_inner(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let rd = match fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    for entry in rd.flatten() {
        let name = entry.file_name();
        let n = name.to_string_lossy();
        let path = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            if n == ".git" {
                continue;
            }
            walk_gpg_inner(root, &path, out);
        } else if path.extension().and_then(|s| s.to_str()) == Some("gpg") {
            let rel = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            out.push(rel);
        }
    }
}

fn walk_dirs(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    walk_dirs_inner(root, root, &mut out);
    out.sort();
    out
}

fn walk_dirs_inner(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let rd = match fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    for entry in rd.flatten() {
        let name = entry.file_name();
        let n = name.to_string_lossy();
        let path = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if !is_dir {
            continue;
        }
        if n == ".git" {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        if !rel.is_empty() {
            out.push(rel);
        }
        walk_dirs_inner(root, &path, out);
    }
}

// ─── Live action coverage ───────────────────────────────────────────────────

#[test]
fn live_list_matches_walked_password_store_entries() {
    if skip_if_no_real_store() {
        return;
    }
    let req = json!({
        "action": "list",
        "settings": {
            "stores": {
                "personal": {
                    "id":   "personal",
                    "name": "Personal",
                    "path": STORE
                }
            }
        }
    });
    let resp = run(&req);
    assert_eq!(resp["status"], "ok", "list response: {resp}");
    assert_eq!(resp["version"], 3_001_002);

    let host_files: Vec<String> = resp["data"]["files"]["personal"]
        .as_array()
        .expect("files.personal is array")
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    let mut host_sorted = host_files.clone();
    host_sorted.sort();

    let walked = walk_gpg(Path::new(STORE));
    assert!(!walked.is_empty(), "expected at least one .gpg entry");
    assert_eq!(
        host_sorted, walked,
        "host list ({} entries) differs from filesystem walk ({} entries)",
        host_sorted.len(),
        walked.len()
    );
    eprintln!(
        "live_list verified: {} .gpg entries match between host and `find ~/.password-store -name '*.gpg'`",
        host_sorted.len()
    );
}

#[test]
fn live_tree_matches_walked_directories() {
    if skip_if_no_real_store() {
        return;
    }
    let req = json!({
        "action": "tree",
        "settings": {
            "stores": {
                "personal": {
                    "id":   "personal",
                    "name": "Personal",
                    "path": STORE
                }
            }
        }
    });
    let resp = run(&req);
    assert_eq!(resp["status"], "ok", "tree response: {resp}");

    let host_dirs: Vec<String> = resp["data"]["directories"]["personal"]
        .as_array()
        .expect("directories.personal is array")
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    let mut host_sorted = host_dirs.clone();
    host_sorted.sort();

    let walked = walk_dirs(Path::new(STORE));
    assert_eq!(
        host_sorted, walked,
        "host tree ({} dirs) differs from filesystem walk ({} dirs)",
        host_sorted.len(),
        walked.len()
    );
    eprintln!(
        "live_tree verified: {} subdirectories match between host and `find ~/.password-store -type d`",
        host_sorted.len()
    );
}

#[test]
fn live_configure_with_no_stores_finds_password_store_as_default() {
    if skip_if_no_real_store() {
        return;
    }
    let req = json!({ "action": "configure" });
    let resp = run_env(&req, &[("PASSWORD_STORE_DIR", STORE)]);
    assert_eq!(resp["status"], "ok", "configure response: {resp}");

    let path = resp["data"]["defaultStore"]["path"]
        .as_str()
        .expect("defaultStore.path is string");
    let host_canonical = fs::canonicalize(path).expect("canonicalize host path");
    let real_canonical = fs::canonicalize(STORE).expect("canonicalize STORE");
    assert_eq!(
        host_canonical, real_canonical,
        "defaultStore.path should canonicalize to ~/.password-store"
    );

    // settings is the raw contents of .browserpass.json or "{}" if absent.
    let settings = resp["data"]["defaultStore"]["settings"]
        .as_str()
        .expect("defaultStore.settings is string");
    let on_disk = Path::new(STORE).join(".browserpass.json");
    let expected_settings = if on_disk.exists() {
        fs::read_to_string(&on_disk).unwrap()
    } else {
        "{}".to_string()
    };
    assert_eq!(settings, expected_settings, "defaultStore.settings mismatch");
    eprintln!("live_configure verified: defaultStore.path → {host_canonical:?}");
}

// Optional: byte-compare `host fetch` against `pass show`. Skipped unless
// the user explicitly names a test entry — fetching prompts the gpg agent,
// which would hang the test on a fresh shell with no cached key.
//
// Enable with:
//   BROWSERPASS_LIVE_TEST_ENTRY="amazon.com/wizard" cargo test --test live_password_store
//
// The entry value is the path inside the store with no `.gpg` suffix.
#[test]
fn live_fetch_matches_pass_show_for_env_specified_entry() {
    if skip_if_no_real_store() {
        return;
    }
    let entry = match std::env::var("BROWSERPASS_LIVE_TEST_ENTRY") {
        Ok(e) if !e.is_empty() => e,
        _ => {
            eprintln!("skipping fetch — set BROWSERPASS_LIVE_TEST_ENTRY=<entry> to enable");
            return;
        }
    };
    let on_disk = Path::new(STORE).join(format!("{entry}.gpg"));
    assert!(
        on_disk.exists(),
        "entry '{entry}' does not exist in store ({:?} not found)",
        on_disk
    );

    let pass_output = Command::new("pass")
        .env("PASSWORD_STORE_DIR", STORE)
        .args(["show", &entry])
        .output()
        .expect("`pass show` spawn");
    assert!(
        pass_output.status.success(),
        "`pass show {entry}` failed: {}",
        String::from_utf8_lossy(&pass_output.stderr)
    );
    let expected = String::from_utf8_lossy(&pass_output.stdout).into_owned();

    let req = json!({
        "action": "fetch",
        "storeId": "personal",
        "file": format!("{entry}.gpg"),
        "settings": {
            "stores": {
                "personal": {
                    "id":   "personal",
                    "name": "Personal",
                    "path": STORE
                }
            }
        }
    });
    let resp = run(&req);
    assert_eq!(resp["status"], "ok", "fetch response: {resp}");
    let host_contents = resp["data"]["contents"]
        .as_str()
        .expect("contents is string");
    assert_eq!(
        host_contents, expected,
        "host fetch output differs from `pass show {entry}`"
    );
    eprintln!("live_fetch verified: byte-equal output for entry '{entry}'");
}

// Tiny sanity check that the `pass` CLI itself is available — if it isn't,
// the fetch test above would have skipped or panicked. This test acts as a
// canary so the user can see at a glance whether their environment is ready.
#[test]
fn pass_cli_is_installed_and_responsive() {
    if skip_if_no_real_store() {
        return;
    }
    let out = Command::new("pass")
        .arg("--version")
        .output();
    match out {
        Ok(o) if o.status.success() => {
            let v = String::from_utf8_lossy(&o.stdout);
            let first_line = v.lines().find(|l| l.contains(char::is_numeric)).unwrap_or(v.trim());
            eprintln!("pass CLI present: {first_line}");
        }
        Ok(o) => panic!("`pass --version` exited {}: {}", o.status, String::from_utf8_lossy(&o.stderr)),
        Err(e) => panic!("`pass --version` could not run: {e}"),
    }
    let _ = PathBuf::from(STORE);
}
