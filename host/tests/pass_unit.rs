use serde_json::json;
use std::fs;
use std::path::PathBuf;
use zpwr_chrome_host::pass::{candidates, etld_plus_one, list_in_dir, match_in, parse_entry, parse_entry_with_path, search_in, stores, store_dir_for, Store};

fn make_store() -> PathBuf {
    let base = std::env::temp_dir().join(format!(
        "zpwrchrome-pass-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = fs::remove_dir_all(&base);
    fs::create_dir_all(base.join("amazon.com")).unwrap();
    fs::create_dir_all(base.join("google.com").join("personal")).unwrap();
    fs::create_dir_all(base.join("bbc.co.uk")).unwrap();
    fs::write(base.join("amazon.com").join("wizard.gpg"), "x").unwrap();
    fs::write(base.join("google.com").join("personal").join("a.gpg"), "x").unwrap();
    fs::write(base.join("google.com").join("work.gpg"), "x").unwrap();
    fs::write(base.join("bbc.co.uk").join("login.gpg"), "x").unwrap();
    fs::write(base.join("boa.gpg"), "x").unwrap();
    fs::write(base.join("www.myloops.net.gpg"), "x").unwrap();
    fs::write(base.join(".gitignore"), "x").unwrap();
    base
}

#[test]
fn etld_strips_to_two_labels() {
    assert_eq!(etld_plus_one("www.amazon.com"), "amazon.com");
    assert_eq!(etld_plus_one("amazon.com"), "amazon.com");
    assert_eq!(etld_plus_one("mail.google.com"), "google.com");
}

#[test]
fn etld_handles_multi_label_suffix() {
    assert_eq!(etld_plus_one("www.bbc.co.uk"), "bbc.co.uk");
    assert_eq!(etld_plus_one("foo.bar.bbc.co.uk"), "bbc.co.uk");
    assert_eq!(etld_plus_one("example.com.au"), "example.com.au");
    assert_eq!(etld_plus_one("sub.example.com.au"), "example.com.au");
}

#[test]
fn etld_lowercases_and_trims() {
    assert_eq!(etld_plus_one("WWW.Amazon.COM."), "amazon.com");
    assert_eq!(etld_plus_one("  amazon.com  "), "amazon.com");
}

#[test]
fn candidates_walks_subdomains_but_stops_at_etld1() {
    let c = candidates("a.b.amazon.com");
    assert!(c.contains(&"a.b.amazon.com".to_string()));
    assert!(c.contains(&"b.amazon.com".to_string()));
    assert!(c.contains(&"amazon.com".to_string()));
    assert!(!c.contains(&"com".to_string()), "bare TLD must not be a candidate: {c:?}");
}

#[test]
fn candidates_for_etld1_only_returns_one() {
    let c = candidates("amazon.com");
    assert_eq!(c, vec!["amazon.com".to_string()]);
}

#[test]
fn candidates_for_multilabel_suffix_stops_at_3labels() {
    let c = candidates("news.bbc.co.uk");
    assert!(c.contains(&"news.bbc.co.uk".to_string()));
    assert!(c.contains(&"bbc.co.uk".to_string()));
    assert!(!c.contains(&"co.uk".to_string()), "multi-label suffix must not match: {c:?}");
    assert!(!c.contains(&"uk".to_string()));
}

#[test]
fn list_skips_hidden_and_walks_subdirs() {
    let dir = make_store();
    let entries = list_in_dir(&dir);
    assert!(entries.iter().any(|e| e == "amazon.com/wizard"));
    assert!(entries.iter().any(|e| e == "google.com/personal/a"));
    assert!(entries.iter().any(|e| e == "google.com/work"));
    assert!(entries.iter().any(|e| e == "bbc.co.uk/login"));
    assert!(entries.iter().any(|e| e == "boa"));
    assert!(entries.iter().any(|e| e == "www.myloops.net"));
    assert!(!entries.iter().any(|e| e.contains(".gitignore")));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn match_finds_subdir_entry_by_host() {
    let dir = make_store();
    let entries = list_in_dir(&dir);
    let m = match_in(&entries, "www.amazon.com");
    assert_eq!(m, vec!["amazon.com/wizard"]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn match_finds_multiple_under_one_domain() {
    let dir = make_store();
    let entries = list_in_dir(&dir);
    let m = match_in(&entries, "google.com");
    assert!(m.contains(&"google.com/work".to_string()));
    assert!(m.contains(&"google.com/personal/a".to_string()));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn match_finds_co_uk_entry() {
    let dir = make_store();
    let entries = list_in_dir(&dir);
    let m = match_in(&entries, "news.bbc.co.uk");
    assert_eq!(m, vec!["bbc.co.uk/login"]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn match_finds_root_gpg_entry() {
    let dir = make_store();
    let entries = list_in_dir(&dir);
    let m = match_in(&entries, "www.myloops.net");
    assert!(m.iter().any(|e| e == "www.myloops.net"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn match_returns_empty_for_no_hit() {
    let dir = make_store();
    let entries = list_in_dir(&dir);
    let m = match_in(&entries, "nonexistent.example");
    assert!(m.is_empty());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn search_returns_all_entries_for_empty_query() {
    let entries = vec![
        "amazon.com/wiz".to_string(),
        "google.com/work".to_string(),
        "boa".to_string(),
    ];
    let got = search_in(&entries, "");
    assert_eq!(got.len(), 3);
}

#[test]
fn search_substring_matches_outrank_subsequence() {
    let entries = vec![
        "amazon.com/wiz".to_string(),
        "amzn-test".to_string(),
    ];
    let got = search_in(&entries, "amazon");
    assert_eq!(got[0], "amazon.com/wiz", "substring match must win");
}

#[test]
fn search_subsequence_matches_when_no_substring() {
    let entries = vec!["aaazznbcd".to_string()];
    let got = search_in(&entries, "azn");
    assert_eq!(got.len(), 1);
}

#[test]
fn search_case_insensitive() {
    let entries = vec!["Amazon.com/Wiz".to_string()];
    let got = search_in(&entries, "AMAZON");
    assert_eq!(got, vec!["Amazon.com/Wiz".to_string()]);
}

#[test]
fn search_rejects_non_matching_entries() {
    let entries = vec![
        "amazon.com/wiz".to_string(),
        "google.com/work".to_string(),
    ];
    let got = search_in(&entries, "xyz");
    assert!(got.is_empty());
}

#[test]
fn parse_extracts_password_and_username() {
    let p = parse_entry("hunter2\nusername: alice\nurl: https://example.com\n");
    assert_eq!(p["password"], json!("hunter2"));
    assert_eq!(p["username"], json!("alice"));
    assert_eq!(p["url"], json!("https://example.com"));
}

#[test]
fn parse_accepts_login_and_user_synonyms() {
    let a = parse_entry("pw\nlogin: bob\n");
    assert_eq!(a["username"], json!("bob"));
    let b = parse_entry("pw\nuser: carol\n");
    assert_eq!(b["username"], json!("carol"));
    let c = parse_entry("pw\nemail: dave@x.com\n");
    assert_eq!(c["username"], json!("dave@x.com"));
}

#[test]
fn parse_pulls_otp_url() {
    let p = parse_entry("pw\notpauth://totp/Example:alice?secret=ABC&issuer=Example\n");
    assert_eq!(
        p["otpUrl"],
        json!("otpauth://totp/Example:alice?secret=ABC&issuer=Example")
    );
}

#[test]
fn parse_collects_free_text_notes() {
    let p = parse_entry("pw\nsome free text line\nanother note\n");
    let notes = p["notes"].as_array().unwrap();
    assert_eq!(notes.len(), 2);
    assert_eq!(notes[0], json!("some free text line"));
}

#[test]
fn parse_handles_empty_input() {
    let p = parse_entry("");
    assert_eq!(p["password"], json!(""));
    assert_eq!(p["username"], json!(""));
}

#[test]
fn parse_with_path_derives_username_from_basename_when_field_absent() {
    let p = parse_entry_with_path("hunter2\n", "example.com/johndoe");
    assert_eq!(p["password"], json!("hunter2"));
    assert_eq!(p["username"], json!("johndoe"));
}

#[test]
fn parse_with_path_preserves_explicit_username() {
    let p = parse_entry_with_path("pw\nusername: alice\n", "example.com/johndoe");
    assert_eq!(p["username"], json!("alice"));
}

#[test]
fn parse_with_path_root_entry_uses_full_basename() {
    let p = parse_entry_with_path("pw\n", "boa");
    assert_eq!(p["username"], json!("boa"));
}

#[test]
fn stores_splits_zpwrchrome_pass_stores_env() {
    let old_env = std::env::var("ZPWRCHROME_PASS_STORES").ok();
    let old_home = std::env::var("HOME").ok();
    unsafe { std::env::set_var("ZPWRCHROME_PASS_STORES", "/tmp/personal:/tmp/work") };
    let s = stores();
    assert_eq!(s.len(), 2);
    assert_eq!(s[0].name, "personal");
    assert_eq!(s[1].name, "work");
    assert_eq!(s[0].dir, std::path::PathBuf::from("/tmp/personal"));
    assert_eq!(s[1].dir, std::path::PathBuf::from("/tmp/work"));
    unsafe { std::env::remove_var("ZPWRCHROME_PASS_STORES") };
    if let Some(v) = old_env { unsafe { std::env::set_var("ZPWRCHROME_PASS_STORES", v) } };
    if let Some(v) = old_home { unsafe { std::env::set_var("HOME", v) } };
}

#[test]
fn stores_falls_back_to_single_store_with_default_name() {
    let old_env = std::env::var("ZPWRCHROME_PASS_STORES").ok();
    let old_psd = std::env::var("PASSWORD_STORE_DIR").ok();
    unsafe { std::env::remove_var("ZPWRCHROME_PASS_STORES") };
    unsafe { std::env::set_var("PASSWORD_STORE_DIR", "/tmp/myhome/.password-store") };
    let s = stores();
    assert_eq!(s.len(), 1);
    assert_eq!(s[0].name, "default", "the canonical store name should be 'default' when dir basename is .password-store");
    if let Some(v) = old_env { unsafe { std::env::set_var("ZPWRCHROME_PASS_STORES", v) } } else { unsafe { std::env::remove_var("ZPWRCHROME_PASS_STORES") } };
    if let Some(v) = old_psd { unsafe { std::env::set_var("PASSWORD_STORE_DIR", v) } } else { unsafe { std::env::remove_var("PASSWORD_STORE_DIR") } };
}

#[test]
fn store_dir_for_resolves_named_store() {
    let old_env = std::env::var("ZPWRCHROME_PASS_STORES").ok();
    unsafe { std::env::set_var("ZPWRCHROME_PASS_STORES", "/tmp/personal:/tmp/work") };
    assert_eq!(store_dir_for("work"), Some(std::path::PathBuf::from("/tmp/work")));
    assert_eq!(store_dir_for("personal"), Some(std::path::PathBuf::from("/tmp/personal")));
    assert_eq!(store_dir_for("nonexistent"), None);
    if let Some(v) = old_env { unsafe { std::env::set_var("ZPWRCHROME_PASS_STORES", v) } } else { unsafe { std::env::remove_var("ZPWRCHROME_PASS_STORES") } };
}

#[test]
fn store_struct_derives_eq() {
    let a = Store { name: "x".into(), dir: std::path::PathBuf::from("/y") };
    let b = Store { name: "x".into(), dir: std::path::PathBuf::from("/y") };
    assert_eq!(a, b);
}

#[test]
fn parse_handles_crlf() {
    let p = parse_entry("pw\r\nusername: alice\r\n");
    assert_eq!(p["password"], json!("pw"));
    assert_eq!(p["username"], json!("alice"));
}
