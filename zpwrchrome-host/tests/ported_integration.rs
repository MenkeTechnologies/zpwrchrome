// End-to-end protocol tests for `zpwrchrome-host`. Spawns the compiled
// binary, frames one JSON request on stdin, reads the framed response off
// stdout, and pins both the response shape AND the exit code (which must
// match the error code per Go reference errors.ExitWithCode).

use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_zpwrchrome-host")
}

fn tempdir(tag: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!(
        "zpwrchrome-port-int-{}-{}-{}",
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

fn frame_bytes(payload: &[u8]) -> Vec<u8> {
    let mut v = (payload.len() as u32).to_le_bytes().to_vec();
    v.extend_from_slice(payload);
    v
}

fn read_one_frame(buf: &[u8]) -> Value {
    assert!(buf.len() >= 4, "response too short: {buf:?}");
    let n = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
    let body = &buf[4..4 + n];
    serde_json::from_slice(body).expect("response body must be valid JSON")
}

struct RoundTrip {
    response: Value,
    exit_code: i32,
}

fn run(request: &Value) -> RoundTrip {
    run_env(request, &[])
}

fn run_env(request: &Value, env_pairs: &[(&str, &str)]) -> RoundTrip {
    let bytes = serde_json::to_vec(request).unwrap();
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
    child
        .stdout
        .as_mut()
        .unwrap()
        .read_to_end(&mut out)
        .unwrap();
    let status = child.wait().unwrap();
    RoundTrip {
        response: read_one_frame(&out),
        exit_code: status.code().unwrap_or(-1),
    }
}

#[test]
fn echo_returns_echo_response_verbatim_with_exit_zero() {
    let req = json!({
        "action": "echo",
        "echoResponse": { "ping": "pong", "n": 42 }
    });
    let r = run(&req);
    assert_eq!(r.exit_code, 0);
    assert_eq!(r.response, json!({"ping": "pong", "n": 42}));
}

#[test]
fn unknown_action_returns_error_code_12_and_exits_12() {
    let req = json!({ "action": "bogus" });
    let r = run(&req);
    assert_eq!(r.exit_code, 12);
    assert_eq!(r.response["status"], "error");
    assert_eq!(r.response["code"], 12);
    assert_eq!(r.response["version"], 3_001_002);
    assert_eq!(r.response["params"]["message"], "Invalid request action");
    assert_eq!(r.response["params"]["action"], "bogus");
}

#[test]
fn fetch_with_non_gpg_extension_returns_code_23_and_exits_23() {
    let req = json!({
        "action": "fetch",
        "storeId": "default",
        "file": "notes.txt",
        "settings": { "stores": {} }
    });
    let r = run(&req);
    assert_eq!(r.exit_code, 23);
    assert_eq!(r.response["code"], 23);
    assert_eq!(
        r.response["params"]["message"],
        "The requested password file does not have the expected '.gpg' extension"
    );
}

#[test]
fn save_with_empty_contents_returns_code_27() {
    let req = json!({
        "action": "save",
        "storeId": "default",
        "file": "x.gpg",
        "contents": "",
        "settings": { "stores": {} }
    });
    let r = run(&req);
    assert_eq!(r.exit_code, 27);
    assert_eq!(r.response["code"], 27);
    assert_eq!(
        r.response["params"]["message"],
        "The entry contents is missing"
    );
}

#[test]
fn fetch_against_unknown_store_returns_code_20() {
    let req = json!({
        "action": "fetch",
        "storeId": "nope",
        "file": "x.gpg",
        "settings": { "stores": {} }
    });
    let r = run(&req);
    assert_eq!(r.exit_code, 20);
    assert_eq!(r.response["code"], 20);
    assert_eq!(r.response["params"]["storeId"], "nope");
}

#[test]
fn list_returns_sorted_gpg_paths_per_store_relative_to_store_root() {
    let d = tempdir("list");
    fs::create_dir_all(d.join("amazon.com")).unwrap();
    fs::write(d.join("amazon.com").join("wizard.gpg"), "x").unwrap();
    fs::write(d.join("boa.gpg"), "x").unwrap();
    fs::write(d.join("amazon.com").join("notes.txt"), "x").unwrap();

    let store_path = d.to_string_lossy().into_owned();
    let req = json!({
        "action": "list",
        "settings": {
            "stores": {
                "personal": {
                    "id": "personal",
                    "name": "Personal",
                    "path": store_path
                }
            }
        }
    });
    let r = run(&req);
    assert_eq!(r.exit_code, 0);
    assert_eq!(r.response["status"], "ok");
    assert_eq!(r.response["version"], 3_001_002);
    let files = r.response["data"]["files"]["personal"].as_array().unwrap();
    let names: Vec<&str> = files.iter().map(|v| v.as_str().unwrap()).collect();
    assert_eq!(names, vec!["amazon.com/wizard.gpg", "boa.gpg"]);
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn tree_returns_sorted_subdirs_relative_to_store_root() {
    let d = tempdir("tree");
    fs::create_dir_all(d.join("a").join("b")).unwrap();
    fs::create_dir_all(d.join("c")).unwrap();

    let store_path = d.to_string_lossy().into_owned();
    let req = json!({
        "action": "tree",
        "settings": {
            "stores": {
                "main": { "id": "main", "name": "Main", "path": store_path }
            }
        }
    });
    let r = run(&req);
    assert_eq!(r.exit_code, 0);
    let dirs = r.response["data"]["directories"]["main"]
        .as_array()
        .unwrap();
    let names: Vec<&str> = dirs.iter().map(|v| v.as_str().unwrap()).collect();
    assert_eq!(names, vec!["a", "a/b", "c"]);
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn delete_removes_file_and_cleans_empty_parent_dirs() {
    let d = tempdir("delete");
    fs::create_dir_all(d.join("a").join("b")).unwrap();
    fs::write(d.join("a").join("b").join("x.gpg"), "enc").unwrap();
    fs::write(d.join("a").join("keepme"), "x").unwrap();

    let store_path = d.to_string_lossy().into_owned();
    let req = json!({
        "action": "delete",
        "storeId": "main",
        "file": "a/b/x.gpg",
        "settings": {
            "stores": {
                "main": { "id": "main", "name": "Main", "path": store_path.clone() }
            }
        }
    });
    let r = run(&req);
    assert_eq!(r.exit_code, 0, "response={:?}", r.response);
    assert!(
        !d.join("a").join("b").exists(),
        "empty parent b/ should be removed"
    );
    assert!(
        d.join("a").exists(),
        "a/ has a sibling keepme so it must stay"
    );
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn configure_with_one_store_reads_browserpass_json() {
    let d = tempdir("cfg-one");
    fs::write(d.join(".browserpass.json"), r#"{"autoSubmit":true}"#).unwrap();

    let store_path = d.to_string_lossy().into_owned();
    let req = json!({
        "action": "configure",
        "settings": {
            "stores": {
                "work": { "id": "work", "name": "Work", "path": store_path }
            }
        }
    });
    let r = run(&req);
    assert_eq!(r.exit_code, 0, "response={:?}", r.response);
    assert_eq!(r.response["status"], "ok");
    assert_eq!(
        r.response["data"]["storeSettings"]["work"],
        json!(r#"{"autoSubmit":true}"#)
    );
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn configure_with_no_stores_falls_back_to_default_store_when_present() {
    let d = tempdir("cfg-def");
    fs::write(d.join(".browserpass.json"), "{}").unwrap();
    let store_path = d.to_string_lossy().into_owned();

    let req = json!({ "action": "configure" });
    let r = run_env(&req, &[("PASSWORD_STORE_DIR", &store_path)]);
    assert_eq!(r.exit_code, 0, "response={:?}", r.response);
    assert!(
        r.response["data"]["defaultStore"]["path"]
            .as_str()
            .unwrap()
            .contains("cfg-def"),
        "defaultStore.path should be the canonical tmp dir, got {:?}",
        r.response
    );
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn version_flag_prints_dotted_triple_and_exits_zero() {
    let out = Command::new(bin()).arg("-version").output().unwrap();
    assert!(out.status.success());
    let s = String::from_utf8_lossy(&out.stdout);
    assert!(
        s.contains("3.1.2"),
        "expected '3.1.2' in version output: {s}"
    );
    assert!(
        s.contains("Browserpass host app version"),
        "version banner missing: {s}"
    );
}

#[test]
fn help_flag_prints_usage_and_exits_zero() {
    let out = Command::new(bin()).arg("--help").output().unwrap();
    assert!(out.status.success());
    let s = String::from_utf8_lossy(&out.stdout);
    assert!(s.contains("zpwrchrome-host"));
    assert!(s.contains("version"));
}
