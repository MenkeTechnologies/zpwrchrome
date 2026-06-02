use zpwr_chrome_host::dl::{default_download_dir, guess_filename, sanitize_filename, unique_dest_path};

#[test]
fn filename_pulled_from_url_basename() {
    assert_eq!(guess_filename("https://example.com/a/b/foo.zip"), Some("foo.zip".into()));
    assert_eq!(guess_filename("https://example.com/foo.tar.gz"),  Some("foo.tar.gz".into()));
}

#[test]
fn filename_strips_query_and_fragment() {
    assert_eq!(guess_filename("https://x/a.exe?v=2"), Some("a.exe".into()));
    assert_eq!(guess_filename("https://x/a.exe#sig"), Some("a.exe".into()));
    assert_eq!(guess_filename("https://x/a.exe?v=2#sig"), Some("a.exe".into()));
}

#[test]
fn filename_none_for_root() {
    assert_eq!(guess_filename("https://example.com/"), None);
    assert_eq!(guess_filename("https://example.com"), None);
}

#[test]
fn filename_falls_through_scheme_split() {
    assert_eq!(guess_filename("http://example.com/index.html"), Some("index.html".into()));
}

#[test]
fn sanitize_strips_path_and_control_chars() {
    assert_eq!(sanitize_filename("foo/bar"), "foo_bar");
    assert_eq!(sanitize_filename("a:b*c?d"), "a_b_c_d");
    assert_eq!(sanitize_filename("a\\b\"c"), "a_b_c");
    assert_eq!(sanitize_filename("a\nb"), "a_b");
    assert_eq!(sanitize_filename("a\0b"), "a_b");
}

#[test]
fn sanitize_preserves_safe_chars() {
    assert_eq!(sanitize_filename("foo-bar_baz.tar.gz"), "foo-bar_baz.tar.gz");
    assert_eq!(sanitize_filename("v1.2.3+build"), "v1.2.3+build");
}

#[test]
fn default_dir_uses_env_override_when_set() {
    let old = std::env::var("ZPWRCHROME_DL_DIR").ok();
    let old_home = std::env::var("HOME").ok();
    // SAFETY: tests in this crate are single-threaded for env mutation here.
    unsafe { std::env::set_var("ZPWRCHROME_DL_DIR", "/tmp/zpwr-dl-test") };
    assert_eq!(default_download_dir(), std::path::PathBuf::from("/tmp/zpwr-dl-test"));
    unsafe { std::env::remove_var("ZPWRCHROME_DL_DIR") };
    if let Some(v) = old { unsafe { std::env::set_var("ZPWRCHROME_DL_DIR", v) }; }
    if let Some(v) = old_home { unsafe { std::env::set_var("HOME", v) }; }
}

#[test]
fn unique_dest_returns_basename_when_dir_is_empty() {
    let dir = std::env::temp_dir().join(format!("zpwrchrome-uniq-{}-empty", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let got = unique_dest_path(&dir, "foo.zip");
    assert_eq!(got, dir.join("foo.zip"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn unique_dest_increments_suffix_until_free() {
    let dir = std::env::temp_dir().join(format!("zpwrchrome-uniq-{}-incr", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("foo.zip"), "x").unwrap();
    let got = unique_dest_path(&dir, "foo.zip");
    assert_eq!(got, dir.join("foo (1).zip"));
    std::fs::write(dir.join("foo (1).zip"), "x").unwrap();
    let got = unique_dest_path(&dir, "foo.zip");
    assert_eq!(got, dir.join("foo (2).zip"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn unique_dest_handles_no_extension() {
    let dir = std::env::temp_dir().join(format!("zpwrchrome-uniq-{}-noext", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("README"), "x").unwrap();
    let got = unique_dest_path(&dir, "README");
    assert_eq!(got, dir.join("README (1)"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn unique_dest_handles_dotfile_prefix() {
    // Leading-dot files (`.bashrc`) have no extension by Chrome's convention;
    // our rfind('.') > 0 guard preserves that — collision should suffix
    // `.bashrc` → `.bashrc (1)`, never split into ` (1).bashrc`.
    let dir = std::env::temp_dir().join(format!("zpwrchrome-uniq-{}-dot", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(".bashrc"), "x").unwrap();
    let got = unique_dest_path(&dir, ".bashrc");
    assert_eq!(got, dir.join(".bashrc (1)"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn default_dir_falls_back_to_home_downloads() {
    let old_env = std::env::var("ZPWRCHROME_DL_DIR").ok();
    let old_home = std::env::var("HOME").ok();
    unsafe { std::env::remove_var("ZPWRCHROME_DL_DIR") };
    unsafe { std::env::set_var("HOME", "/tmp/fakehome") };
    assert_eq!(default_download_dir(), std::path::PathBuf::from("/tmp/fakehome/Downloads/zpwrchrome"));
    if let Some(v) = old_env { unsafe { std::env::set_var("ZPWRCHROME_DL_DIR", v) }; }
    if let Some(v) = old_home { unsafe { std::env::set_var("HOME", v) }; } else { unsafe { std::env::remove_var("HOME") }; }
}
