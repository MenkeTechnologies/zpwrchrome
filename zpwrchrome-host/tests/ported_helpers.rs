// Pins for `ported::helpers` — verifies the pure-fs helpers that don't
// require a real gpg keyring. gpg subprocess fns (DetectGpgBinary,
// ValidateGpgBinary, GpgDecryptFile, GpgEncryptFile) are exercised
// end-to-end at integration time.

use std::fs;
use std::path::PathBuf;
use zpwrchrome_host::ported::helpers::{DetectGpgRecipients, IsDirectoryEmpty};

fn tempdir(tag: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!(
        "zpwrchrome-port-helpers-{}-{}-{}",
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
fn detect_gpg_recipients_reads_gpg_id_file() {
    let d = tempdir("rec1");
    fs::write(d.join(".gpg-id"), "alice@example.com\nbob@example.com\n").unwrap();
    let target = d.join("amazon.com.gpg");
    fs::write(&target, "enc").unwrap();
    let r = DetectGpgRecipients(&target).unwrap();
    assert_eq!(r, vec!["alice@example.com".to_string(), "bob@example.com".to_string()]);
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn detect_gpg_recipients_walks_up_to_find_gpg_id() {
    let d = tempdir("rec2");
    fs::create_dir_all(d.join("a").join("b")).unwrap();
    fs::write(d.join(".gpg-id"), "alice@example.com").unwrap();
    let target = d.join("a").join("b").join("x.gpg");
    fs::write(&target, "enc").unwrap();
    let r = DetectGpgRecipients(&target).unwrap();
    assert_eq!(r, vec!["alice@example.com".to_string()]);
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn detect_gpg_recipients_handles_crlf_line_endings() {
    let d = tempdir("rec3");
    fs::write(d.join(".gpg-id"), "alice@example.com\r\nbob@example.com\r\n").unwrap();
    let target = d.join("x.gpg");
    fs::write(&target, "enc").unwrap();
    let r = DetectGpgRecipients(&target).unwrap();
    assert_eq!(r, vec!["alice@example.com".to_string(), "bob@example.com".to_string()]);
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn detect_gpg_recipients_errors_when_no_gpg_id_in_chain() {
    let d = tempdir("rec4");
    let target = d.join("x.gpg");
    fs::write(&target, "enc").unwrap();
    // Walks up past tempdir to root; root has no .gpg-id on macOS/Linux.
    let r = DetectGpgRecipients(&target);
    assert!(r.is_err(), "expected error walking to root, got {r:?}");
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn is_directory_empty_true_for_empty() {
    let d = tempdir("emp1");
    assert!(IsDirectoryEmpty(&d).unwrap());
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn is_directory_empty_false_when_files_present() {
    let d = tempdir("emp2");
    fs::write(d.join("x"), "x").unwrap();
    assert!(!IsDirectoryEmpty(&d).unwrap());
    let _ = fs::remove_dir_all(&d);
}
