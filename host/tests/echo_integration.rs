use std::io::{Read, Write};
use std::process::{Command, Stdio};

fn frame_bytes(payload: &[u8]) -> Vec<u8> {
    let mut v = (payload.len() as u32).to_le_bytes().to_vec();
    v.extend_from_slice(payload);
    v
}

fn read_frame(buf: &[u8]) -> (&[u8], &[u8]) {
    let n = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
    (&buf[4..4 + n], &buf[4 + n..])
}

fn run_with(input: &[u8]) -> Vec<u8> {
    let bin = env!("CARGO_BIN_EXE_zpwr-chrome-host");
    let mut child = Command::new(bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn host");
    child.stdin.as_mut().unwrap().write_all(input).unwrap();
    drop(child.stdin.take());

    let mut out = Vec::new();
    child.stdout.as_mut().unwrap().read_to_end(&mut out).unwrap();
    let status = child.wait().unwrap();
    assert!(status.success() || status.code().is_none(), "host exited: {status:?}");
    out
}

#[test]
fn echo_roundtrip() {
    let req = br#"{"id":42,"kind":"echo","args":"hello"}"#;
    let out = run_with(&frame_bytes(req));
    let (json, rest) = read_frame(&out);
    assert!(rest.is_empty(), "extra bytes after response");
    let s = std::str::from_utf8(json).unwrap();
    assert!(s.contains(r#""id":42"#), "{s}");
    assert!(s.contains(r#""ok":true"#), "{s}");
    assert!(s.contains(r#""hello""#), "{s}");
}

#[test]
fn meta_returns_version() {
    let req = br#"{"id":1,"kind":"meta"}"#;
    let out = run_with(&frame_bytes(req));
    let (json, _) = read_frame(&out);
    let s = std::str::from_utf8(json).unwrap();
    assert!(s.contains(r#""name":"zpwr-chrome-host""#), "{s}");
    assert!(s.contains(r#""version""#), "{s}");
}

#[test]
fn unknown_kind_returns_err() {
    let req = br#"{"id":7,"kind":"bogus"}"#;
    let out = run_with(&frame_bytes(req));
    let (json, _) = read_frame(&out);
    let s = std::str::from_utf8(json).unwrap();
    assert!(s.contains(r#""ok":false"#), "{s}");
    assert!(s.contains("unknown kind"), "{s}");
}

#[test]
fn malformed_json_returns_parse_err() {
    let req = b"{not json";
    let out = run_with(&frame_bytes(req));
    let (json, _) = read_frame(&out);
    let s = std::str::from_utf8(json).unwrap();
    assert!(s.contains(r#""ok":false"#), "{s}");
    assert!(s.contains("parse"), "{s}");
}

#[test]
fn two_requests_two_responses() {
    let mut input = frame_bytes(br#"{"id":1,"kind":"echo","args":"a"}"#);
    input.extend_from_slice(&frame_bytes(br#"{"id":2,"kind":"echo","args":"b"}"#));
    let out = run_with(&input);
    let (first, rest) = read_frame(&out);
    let (second, tail) = read_frame(rest);
    assert!(tail.is_empty());
    assert!(std::str::from_utf8(first).unwrap().contains(r#""id":1"#));
    assert!(std::str::from_utf8(second).unwrap().contains(r#""id":2"#));
}

#[test]
fn eof_exits_cleanly() {
    let out = run_with(b"");
    assert!(out.is_empty(), "expected no output on empty input, got {out:?}");
}
