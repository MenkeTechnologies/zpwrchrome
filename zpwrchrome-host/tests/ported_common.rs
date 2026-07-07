// Pins for `ported::request::common::normalizePasswordStorePath`. Verifies
// the inlined env expansion (option `a`) and the empty/tilde/file paths.

use std::fs;
use std::path::PathBuf;
use zpwrchrome_host::ported::request::common::normalizePasswordStorePath;

fn tempdir(tag: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!(
        "zpwrchrome-port-common-{}-{}-{}",
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
fn rejects_empty_path() {
    let err = normalizePasswordStorePath("").unwrap_err();
    assert!(
        err.contains("empty"),
        "expected 'empty' in error, got {err}"
    );
}

#[test]
fn resolves_real_directory() {
    let d = tempdir("real");
    let got = normalizePasswordStorePath(&d.to_string_lossy()).unwrap();
    assert_eq!(
        fs::canonicalize(&got).unwrap(),
        fs::canonicalize(&d).unwrap()
    );
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn expands_tilde_to_home() {
    let home = std::env::var("HOME").unwrap_or_default();
    if home.is_empty() {
        eprintln!("skipping: $HOME not set");
        return;
    }
    let inside = std::path::Path::new(&home).join("zpwrchrome-port-tilde");
    let _ = fs::remove_dir_all(&inside);
    fs::create_dir_all(&inside).unwrap();
    let got = normalizePasswordStorePath("~/zpwrchrome-port-tilde").unwrap();
    assert_eq!(
        fs::canonicalize(&got).unwrap(),
        fs::canonicalize(&inside).unwrap()
    );
    let _ = fs::remove_dir_all(&inside);
}

#[test]
fn expands_brace_env_var() {
    let d = tempdir("env");
    let key = format!("ZPWRCHROME_PORT_COMMON_{}", std::process::id());
    unsafe { std::env::set_var(&key, &d) };
    let pattern = format!("${{{key}}}");
    let got = normalizePasswordStorePath(&pattern).unwrap();
    assert_eq!(
        fs::canonicalize(&got).unwrap(),
        fs::canonicalize(&d).unwrap()
    );
    unsafe { std::env::remove_var(&key) };
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn rejects_path_that_is_a_file() {
    let d = tempdir("file");
    let f = d.join("not-a-dir.txt");
    fs::write(&f, "x").unwrap();
    let err = normalizePasswordStorePath(&f.to_string_lossy()).unwrap_err();
    assert!(
        err.contains("not a directory")
            || err.contains("Not a directory")
            || err.contains("specified path"),
        "unexpected error message: {err}"
    );
    let _ = fs::remove_dir_all(&d);
}
