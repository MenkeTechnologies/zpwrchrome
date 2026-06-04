// Pins for the two file-local helpers Go declares in request/configure.go:
//   getDefaultPasswordStorePath, readDefaultSettings.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use browserpass_host_rs::ported::request::configure::{
    getDefaultPasswordStorePath, readDefaultSettings,
};

// Rust runs unit tests in parallel by default. The two getDefaultPasswordStorePath
// tests both mutate PASSWORD_STORE_DIR / HOME, so they must not interleave —
// on Linux CI they raced and produced a flaky failure where test #2 saw test
// #1's PASSWORD_STORE_DIR still set. Same locking pattern as ENV_LOCK in
// tests/extensions_dl_state.rs.
static ENV_LOCK: Mutex<()> = Mutex::new(());

#[test]
fn default_path_uses_password_store_dir_env_when_set() {
    let _g = ENV_LOCK.lock().unwrap();
    let old = std::env::var("PASSWORD_STORE_DIR").ok();
    unsafe { std::env::set_var("PASSWORD_STORE_DIR", "/tmp/zp-port-defstore") };
    assert_eq!(getDefaultPasswordStorePath().unwrap(), PathBuf::from("/tmp/zp-port-defstore"));
    if let Some(v) = old { unsafe { std::env::set_var("PASSWORD_STORE_DIR", v) }; }
    else                 { unsafe { std::env::remove_var("PASSWORD_STORE_DIR") }; }
}

#[test]
fn default_path_falls_back_to_home_password_store() {
    let _g = ENV_LOCK.lock().unwrap();
    let old_psd  = std::env::var("PASSWORD_STORE_DIR").ok();
    let old_home = std::env::var("HOME").ok();
    unsafe { std::env::remove_var("PASSWORD_STORE_DIR") };
    unsafe { std::env::set_var("HOME", "/tmp/zp-port-fakehome") };
    assert_eq!(
        getDefaultPasswordStorePath().unwrap(),
        PathBuf::from("/tmp/zp-port-fakehome/.password-store")
    );
    if let Some(v) = old_psd  { unsafe { std::env::set_var("PASSWORD_STORE_DIR", v) } } else { unsafe { std::env::remove_var("PASSWORD_STORE_DIR") } };
    if let Some(v) = old_home { unsafe { std::env::set_var("HOME", v) } };
}

#[test]
fn read_default_settings_returns_empty_object_when_missing() {
    let d = std::env::temp_dir().join(format!("zp-port-cfg-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    assert_eq!(readDefaultSettings(&d).unwrap(), "{}");
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn read_default_settings_returns_raw_contents_when_present() {
    let d = std::env::temp_dir().join(format!("zp-port-cfg2-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    fs::write(d.join(".browserpass.json"), r#"{"autoSubmit":true}"#).unwrap();
    assert_eq!(readDefaultSettings(&d).unwrap(), r#"{"autoSubmit":true}"#);
    let _ = fs::remove_dir_all(&d);
}
