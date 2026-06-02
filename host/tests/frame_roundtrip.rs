use std::io::Cursor;
use zpwr_chrome_host::frame;

#[test]
fn roundtrip_short() {
    let mut buf = Vec::new();
    frame::write_msg(&mut buf, b"hello").unwrap();
    let mut r = Cursor::new(buf);
    let out = frame::read_msg(&mut r).unwrap();
    assert_eq!(out, b"hello");
}

#[test]
fn empty_msg_roundtrips() {
    let mut buf = Vec::new();
    frame::write_msg(&mut buf, b"").unwrap();
    let mut r = Cursor::new(buf);
    let out = frame::read_msg(&mut r).unwrap();
    assert!(out.is_empty());
}

#[test]
fn rejects_oversize_header() {
    let bad = [0xff, 0xff, 0xff, 0xff];
    let mut r = Cursor::new(bad.to_vec());
    let err = frame::read_msg(&mut r).unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
}

#[test]
fn rejects_oversize_write() {
    let huge = vec![0u8; frame::MAX_MSG + 1];
    let mut buf = Vec::new();
    let err = frame::write_msg(&mut buf, &huge).unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
}

#[test]
fn truncated_payload_errors() {
    let mut bad = (10u32).to_le_bytes().to_vec();
    bad.extend_from_slice(b"only5");
    let mut r = Cursor::new(bad);
    let err = frame::read_msg(&mut r).unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::UnexpectedEof);
}

#[test]
fn two_messages_back_to_back() {
    let mut buf = Vec::new();
    frame::write_msg(&mut buf, b"first").unwrap();
    frame::write_msg(&mut buf, b"second").unwrap();
    let mut r = Cursor::new(buf);
    assert_eq!(frame::read_msg(&mut r).unwrap(), b"first");
    assert_eq!(frame::read_msg(&mut r).unwrap(), b"second");
}
