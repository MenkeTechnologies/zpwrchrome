// Tests for the `pass.unlock` / `pass.lock` / `pass.status` extension actions — entering the
// GPG passphrase from the browser instead of from a terminal.
//
// The pure helpers (`classify`, `first_entry`) always run. The end-to-end test
// builds a disposable GNUPGHOME with its own key + store and asserts the whole
// point of the feature:
//
//   1. cold agent + `fetch`      → error 24, no passphrase anywhere to be had
//   2. `pass.unlock`             → ok
//   3. the same `fetch`          → decrypts, unchanged ported code path
//   4. `pass.lock` + `fetch`     → error 24 again
//   5. `pass.unlock` (wrong pw)  → error 24, message "Bad passphrase"
//
// `pass.status` is covered separately: it must report the same locked /
// unlocked state the fetch path experiences, since the toolbar chip renders it.
//
// Step 3 is the contract: unlocking primes gpg-agent, so `--batch` decrypts
// that previously needed a terminal now succeed.
//
// Skipped when `gpg` is absent or the throwaway key can't be generated, so CI
// without GnuPG stays green.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use zpwrchrome_host::extensions::gpg_unlock::{classify, first_entry};

const PASSPHRASE: &str = "correct-horse-battery-staple";

// ─── pure helpers ────────────────────────────────────────────────────────

#[test]
fn classify_separates_bad_passphrase_from_loopback_refusal() {
    assert_eq!(
        classify("gpg: public key decryption failed: Bad passphrase"),
        "Bad passphrase"
    );
    let loopback = classify("gpg: public key decryption failed: Inappropriate ioctl for device");
    assert!(
        loopback.contains("allow-loopback-pinentry"),
        "loopback refusal must name the gpg-agent.conf fix, got: {loopback}"
    );
}

#[test]
fn classify_falls_back_to_a_generic_message() {
    assert_eq!(
        classify("gpg: some unrecognized failure"),
        "Unable to unlock the password store"
    );
}

#[test]
fn first_entry_picks_the_lowest_sorted_gpg_and_skips_dot_git() {
    let dir = scratch("first-entry");
    std::fs::create_dir_all(dir.join("zz")).unwrap();
    std::fs::create_dir_all(dir.join(".git")).unwrap();
    // `.git` object files end in .gpg only in this fixture — the point is that
    // the walker never descends into `.git` at all.
    std::fs::write(dir.join(".git/aaa.gpg"), b"x").unwrap();
    std::fs::write(dir.join("zz/mmm.gpg"), b"x").unwrap();
    std::fs::write(dir.join("bbb.gpg"), b"x").unwrap();
    std::fs::write(dir.join("aaa.txt"), b"x").unwrap();

    assert_eq!(first_entry(&dir), Some("bbb.gpg".to_string()));
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn first_entry_is_none_for_a_store_with_no_entries() {
    let dir = scratch("empty-store");
    std::fs::create_dir_all(&dir).unwrap();
    assert_eq!(first_entry(&dir), None);
    std::fs::remove_dir_all(&dir).ok();
}

// ─── end-to-end against a disposable keyring ─────────────────────────────

#[test]
fn unlock_primes_the_agent_so_batch_fetch_stops_needing_a_terminal() {
    let Some(fx) = Fixture::build("unlock") else {
        eprintln!("skipping — gpg unavailable or key generation failed");
        return;
    };

    // 1. Cold agent: the ported --batch decrypt has no way to get a passphrase.
    fx.flush_agent();
    let cold = fx.run(&fx.fetch_req());
    assert_eq!(
        cold["status"], "error",
        "cold-cache fetch must fail, got: {cold}"
    );
    assert_eq!(cold["code"], 24, "expected UnableToDecryptPasswordFile");

    // 2. Unlock with the passphrase the browser would have collected.
    let unlocked = fx.run(&fx.unlock_req(PASSPHRASE));
    assert_eq!(
        unlocked["status"], "ok",
        "unlock must succeed, got: {unlocked}"
    );
    assert_eq!(unlocked["data"]["unlocked"], true);
    assert_eq!(unlocked["data"]["probe"], "site.gpg");

    // 3. The unmodified ported path now decrypts.
    let warm = fx.run(&fx.fetch_req());
    assert_eq!(
        warm["status"], "ok",
        "fetch after unlock must succeed, got: {warm}"
    );
    assert_eq!(
        warm["data"]["contents"].as_str().unwrap(),
        "s3cr3t\nusername: alice\n"
    );

    // 4. Locking drops the cached passphrase again.
    let locked = fx.run(&json!({"action": "pass.lock"}));
    assert_eq!(locked["status"], "ok", "lock must succeed, got: {locked}");
    assert_eq!(locked["data"]["locked"], true);
    let after_lock = fx.run(&fx.fetch_req());
    assert_eq!(
        after_lock["status"], "error",
        "fetch after lock must fail again, got: {after_lock}"
    );

    // 5. A wrong passphrase is reported as such, not as a generic failure —
    //    the popup shows this string verbatim.
    let bad = fx.run(&fx.unlock_req("not-the-passphrase"));
    assert_eq!(bad["status"], "error", "wrong passphrase must fail");
    assert_eq!(bad["code"], 24);
    assert_eq!(
        bad["params"]["message"], "Bad passphrase",
        "wrong passphrase must be distinguishable, got: {bad}"
    );
}

/// `pass.status` is what the toolbar's lock chip renders, so it has to track
/// the agent cache rather than guess: locked before an unlock, unlocked after
/// one, locked again after a lock. A wrong answer here either hides a locked
/// store or prompts for a passphrase that is already cached.
#[test]
fn status_follows_the_agent_cache_through_unlock_and_lock() {
    let Some(fx) = Fixture::build("status") else {
        eprintln!("skipping — gpg unavailable or key generation failed");
        return;
    };

    fx.flush_agent();
    let cold = fx.run(&fx.status_req());
    assert_eq!(cold["status"], "ok", "status must answer, got: {cold}");
    assert_eq!(cold["data"]["unlocked"], false, "cold agent is locked");
    assert_eq!(
        cold["data"]["known"], true,
        "recipients come from .gpg-id, so the state is knowable: {cold}"
    );
    // `total` counts the store's encryption keygrips this agent holds a secret
    // half for — the fixture key carries more than one encryption subkey, so
    // assert the shape, not a subkey count gpg is free to change.
    assert!(
        cold["data"]["total"].as_u64().unwrap() >= 1,
        "fixture store must have at least one usable key: {cold}"
    );
    assert_eq!(cold["data"]["cached"], 0);

    assert_eq!(fx.run(&fx.unlock_req(PASSPHRASE))["status"], "ok");
    let warm = fx.run(&fx.status_req());
    assert_eq!(
        warm["data"]["unlocked"], true,
        "status must see the primed agent, got: {warm}"
    );
    assert!(
        warm["data"]["cached"].as_u64().unwrap() >= 1,
        "the unlocked key must be counted as cached: {warm}"
    );

    assert_eq!(fx.run(&json!({"action": "pass.lock"}))["status"], "ok");
    let relocked = fx.run(&fx.status_req());
    assert_eq!(
        relocked["data"]["unlocked"], false,
        "status must see the flushed cache, got: {relocked}"
    );
}

/// A store with no readable `.gpg-id` has no resolvable recipients. Reporting
/// that as locked would prompt for a passphrase that cannot help, so the host
/// reports it as unknown instead.
#[test]
fn status_reports_unknown_when_recipients_cannot_be_resolved() {
    let Some(fx) = Fixture::build("unknown") else {
        eprintln!("skipping — gpg unavailable or key generation failed");
        return;
    };
    std::fs::remove_file(fx.store.join(".gpg-id")).unwrap();

    let unknown = fx.run(&fx.status_req());
    assert_eq!(unknown["status"], "ok", "status must still answer");
    assert_eq!(unknown["data"]["known"], false, "got: {unknown}");
    assert_eq!(unknown["data"]["unlocked"], false, "unknown is never unlocked");
    assert_eq!(unknown["data"]["total"], 0);
}

// ─── fixture ─────────────────────────────────────────────────────────────

/// Disposable GNUPGHOME + password store. Dropping it kills the agent it
/// started and removes the directory.
struct Fixture {
    home: PathBuf,
    store: PathBuf,
}

impl Fixture {
    fn build(name: &str) -> Option<Self> {
        if Command::new("gpg").arg("--version").output().is_err() {
            return None;
        }
        // Short path on purpose: a gpg-agent socket lives under GNUPGHOME and
        // AF_UNIX paths cap at ~104 bytes, which macOS's $TMPDIR
        // (/var/folders/…/T/) blows through — gpg then dies with
        // "can't connect to the gpg-agent: File name too long".
        let home = PathBuf::from(format!("/tmp/zpc-gpg-{name}-{}", std::process::id()));
        std::fs::remove_dir_all(&home).ok();
        std::fs::create_dir_all(&home).ok()?;
        set_mode_700(&home);
        std::fs::write(
            home.join("gpg-agent.conf"),
            "default-cache-ttl 600\nmax-cache-ttl 600\nallow-loopback-pinentry\n",
        )
        .ok()?;

        let fx = Fixture {
            home: home.clone(),
            store: home.join("store"),
        };

        // Primary key is sign+certify only, so add an encryption subkey — a
        // password store encrypts to it.
        let gen = fx
            .gpg(&[
                "--batch",
                "--pinentry-mode",
                "loopback",
                "--passphrase",
                PASSPHRASE,
                "--quick-generate-key",
                "zpwrchrome test <test@example.invalid>",
                // ed25519/cv25519 over RSA purely for generation speed — RSA-2048
                // keygen adds seconds of CPU load to a suite that runs test
                // binaries in parallel, and this test does not care about the
                // algorithm.
                "ed25519",
                "default",
                "never",
            ])
            .ok()?;
        if !gen.status.success() {
            eprintln!("key generation failed: {}", String::from_utf8_lossy(&gen.stderr));
            return None;
        }
        let fpr = fx.primary_fingerprint()?;
        let sub = fx
            .gpg(&[
                "--batch",
                "--pinentry-mode",
                "loopback",
                "--passphrase",
                PASSPHRASE,
                "--quick-add-key",
                &fpr,
                "cv25519",
                "encr",
                "never",
            ])
            .ok()?;
        if !sub.status.success() {
            eprintln!("subkey generation failed: {}", String::from_utf8_lossy(&sub.stderr));
            return None;
        }

        std::fs::create_dir_all(&fx.store).ok()?;
        std::fs::write(fx.store.join(".gpg-id"), format!("{fpr}\n")).ok()?;
        let enc = fx.encrypt("s3cr3t\nusername: alice\n", &fpr, &fx.store.join("site.gpg"))?;
        if !enc {
            return None;
        }
        Some(fx)
    }

    fn gpg(&self, args: &[&str]) -> std::io::Result<std::process::Output> {
        Command::new("gpg")
            .env("GNUPGHOME", &self.home)
            .args(args)
            .output()
    }

    fn primary_fingerprint(&self) -> Option<String> {
        let out = self
            .gpg(&["--list-secret-keys", "--with-colons"])
            .ok()?
            .stdout;
        String::from_utf8_lossy(&out)
            .lines()
            .find(|l| l.starts_with("fpr:"))
            .and_then(|l| l.split(':').nth(9))
            .map(|s| s.to_string())
    }

    fn encrypt(&self, body: &str, recipient: &str, out: &Path) -> Option<bool> {
        let mut child = Command::new("gpg")
            .env("GNUPGHOME", &self.home)
            .args([
                "--batch",
                "--yes",
                "--quiet",
                "--trust-model",
                "always",
                "--encrypt",
                "--recipient",
                recipient,
                "--output",
            ])
            .arg(out)
            .stdin(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .ok()?;
        child.stdin.as_mut()?.write_all(body.as_bytes()).ok()?;
        drop(child.stdin.take());
        Some(child.wait().ok()?.success())
    }

    /// Drop every cached passphrase — the state a fresh boot leaves behind.
    fn flush_agent(&self) {
        let _ = Command::new("gpg-connect-agent")
            .env("GNUPGHOME", &self.home)
            .args(["reloadagent", "/bye"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    fn settings(&self) -> Value {
        json!({
            "stores": {
                "default": {
                    "id": "default",
                    "name": "Default",
                    "path": self.store.to_string_lossy(),
                }
            }
        })
    }

    fn fetch_req(&self) -> Value {
        json!({
            "action": "fetch",
            "storeId": "default",
            "file": "site.gpg",
            "settings": self.settings(),
        })
    }

    fn status_req(&self) -> Value {
        json!({
            "action": "pass.status",
            "storeId": "default",
            "settings": self.settings(),
        })
    }

    fn unlock_req(&self, passphrase: &str) -> Value {
        json!({
            "action": "pass.unlock",
            "storeId": "default",
            "passphrase": passphrase,
            "settings": self.settings(),
        })
    }

    /// One framed request through the real host binary, with GNUPGHOME
    /// pointed at the fixture keyring.
    fn run(&self, req: &Value) -> Value {
        let payload = serde_json::to_vec(req).unwrap();
        let mut framed = (payload.len() as u32).to_le_bytes().to_vec();
        framed.extend_from_slice(&payload);

        let mut child = Command::new(env!("CARGO_BIN_EXE_zpwrchrome-host"))
            .env("GNUPGHOME", &self.home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn host");
        child.stdin.as_mut().unwrap().write_all(&framed).unwrap();
        drop(child.stdin.take());
        let mut out = Vec::new();
        child.stdout.as_mut().unwrap().read_to_end(&mut out).unwrap();
        let _ = child.wait();

        assert!(out.len() >= 4, "host response too short: {out:?}");
        let n = u32::from_le_bytes([out[0], out[1], out[2], out[3]]) as usize;
        serde_json::from_slice(&out[4..4 + n]).expect("valid JSON response")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = Command::new("gpgconf")
            .env("GNUPGHOME", &self.home)
            .args(["--kill", "gpg-agent"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        std::fs::remove_dir_all(&self.home).ok();
    }
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("zpc-unlock-{name}-{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[cfg(unix)]
fn set_mode_700(p: &Path) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o700)).ok();
}

#[cfg(not(unix))]
fn set_mode_700(_p: &Path) {}
