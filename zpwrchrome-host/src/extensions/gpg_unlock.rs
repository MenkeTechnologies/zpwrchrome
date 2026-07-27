//! `pass.unlock` / `pass.lock` extension actions — enter the GPG passphrase
//! from the browser instead of from a terminal.
//!
//! Why this exists: every decrypt in the ported path runs
//! `gpg --decrypt --yes --quiet --batch -` (`ported/helpers/helpers.rs`).
//! `--batch` forbids gpg from prompting, so the decrypt only succeeds when
//! gpg-agent already holds the passphrase. When the host is spawned by the
//! browser it has no controlling TTY, so a curses/tty pinentry cannot run and
//! the agent answers `Inappropriate ioctl for device` — which is why the store
//! had to be unlocked from a terminal first.
//!
//! `pass.unlock` decrypts one probe entry with `--pinentry-mode loopback` and
//! the passphrase fed on stdin. gpg hands the passphrase to gpg-agent, which
//! caches it under the agent's `default-cache-ttl`; every later `--batch`
//! decrypt (the unmodified ported path, `pass show`, `pass otp`) then succeeds.
//! The decrypted probe plaintext is discarded — this action never returns a
//! secret.
//!
//! Wire shape:
//! ```text
//!   request:  {"action":"pass.unlock", "storeId":"<id>", "passphrase":"…",
//!              "file":"optional/entry.gpg", "settings":{"stores":{…}}}
//!   response: ok { "unlocked": true, "probe": "<entry used>" }
//!             error 24 (UnableToDecryptPasswordFile) on a bad passphrase or a
//!             gpg-agent that refuses loopback pinentry
//!
//!   request:  {"action":"pass.lock"}
//!   response: ok { "locked": true }
//! ```
//!
//! The passphrase is written to gpg's stdin — never to argv (argv is readable
//! by any process via `ps`) and never to a temp file. The host's own copy is
//! wiped with volatile writes before exit. The passphrase does still exist in
//! the request buffer serde_json parsed, which is freed but not scrubbed; the
//! process is one-shot and exits immediately after the response, so that copy
//! is short-lived.
#![allow(non_snake_case)]

use crate::ported::errors::{self, field};
use crate::ported::helpers;
use crate::ported::request::common::normalizePasswordStorePath;
use crate::ported::request::process::request;
use crate::ported::response;
use serde::Serialize;
use serde_json::Value;
use std::ffi::OsStr;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};

#[derive(Serialize, Debug, Default)]
pub struct UnlockResponse {
    #[serde(rename = "unlocked")]
    pub Unlocked: bool,
    /// Entry whose decryption primed the agent — surfaced so the UI can say
    /// which entry was touched, never its contents.
    #[serde(rename = "probe")]
    pub Probe: String,
}

#[derive(Serialize, Debug, Default)]
pub struct LockResponse {
    #[serde(rename = "locked")]
    pub Locked: bool,
}

/// Run the `pass.unlock` action. `value` is the raw request (the passphrase
/// lives outside the ported request struct), `req` the same message parsed
/// through the ported shape for `settings` / `storeId` / `file`.
pub fn unlock(value: &Value, req: &request) {
    let mut passphrase: Vec<u8> = value
        .get("passphrase")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .as_bytes()
        .to_vec();

    if passphrase.is_empty() {
        response::SendErrorAndExit(
            errors::Code::UnableToDecryptPasswordFile,
            Some(response::params_of(&[
                (field::MESSAGE, "No passphrase was provided"),
                (field::ACTION, "pass.unlock"),
            ])),
        );
    }

    let store = match req.Settings.Stores.get(&req.StoreID) {
        Some(s) => s.clone(),
        None => {
            zeroize(&mut passphrase);
            response::SendErrorAndExit(
                errors::Code::InvalidPasswordStore,
                Some(response::params_of(&[
                    (
                        field::MESSAGE,
                        "The password store is not present in the list of stores",
                    ),
                    (field::ACTION, "pass.unlock"),
                    (field::STORE_ID, &req.StoreID),
                ])),
            );
        }
    };

    let normalized = match normalizePasswordStorePath(&store.Path) {
        Ok(p) => p,
        Err(e) => {
            zeroize(&mut passphrase);
            response::SendErrorAndExit(
                errors::Code::InaccessiblePasswordStore,
                Some(response::params_of(&[
                    (field::MESSAGE, "The password store is not accessible"),
                    (field::ACTION, "pass.unlock"),
                    (field::ERROR, &e),
                    (field::STORE_ID, &store.ID),
                    (field::STORE_NAME, &store.Name),
                    (field::STORE_PATH, &store.Path),
                ])),
            );
        }
    };

    // Probe entry: the caller's `file` when it named one (unlocking on the
    // entry it is about to fetch avoids a second key), otherwise the first
    // entry in the store by sorted relative path so the choice is stable.
    let probe_rel: String = if req.File.is_empty() {
        match first_entry(&normalized) {
            Some(p) => p,
            None => {
                zeroize(&mut passphrase);
                response::SendErrorAndExit(
                    errors::Code::UnableToDecryptPasswordFile,
                    Some(response::params_of(&[
                        (
                            field::MESSAGE,
                            "The password store has no .gpg entry to unlock against",
                        ),
                        (field::ACTION, "pass.unlock"),
                        (field::STORE_ID, &store.ID),
                        (field::STORE_PATH, &store.Path),
                    ])),
                );
            }
        }
    } else {
        req.File.clone()
    };

    let gpgPath = match resolve_gpg_path(req, &store.Settings.GpgPath) {
        Ok(p) => p,
        Err((code, msg, err)) => {
            zeroize(&mut passphrase);
            response::SendErrorAndExit(
                code,
                Some(response::params_of(&[
                    (field::MESSAGE, msg),
                    (field::ACTION, "pass.unlock"),
                    (field::ERROR, &err),
                ])),
            );
        }
    };

    let file_path = normalized.join(&probe_rel);
    let result = prime_agent(&file_path, &gpgPath, &passphrase);
    zeroize(&mut passphrase);

    match result {
        Ok(()) => response::SendOk(UnlockResponse {
            Unlocked: true,
            Probe: probe_rel,
        }),
        Err(e) => {
            eprintln!("Unable to unlock the password store: {e}");
            response::SendErrorAndExit(
                errors::Code::UnableToDecryptPasswordFile,
                Some(response::params_of(&[
                    (field::MESSAGE, &classify(&e)),
                    (field::ACTION, "pass.unlock"),
                    (field::ERROR, &e),
                    (field::FILE, &probe_rel),
                    (field::STORE_ID, &store.ID),
                    (field::STORE_NAME, &store.Name),
                    (field::STORE_PATH, &store.Path),
                ])),
            );
        }
    }
}

/// Run the `pass.lock` action — drop every cached passphrase from gpg-agent so
/// the next decrypt needs the passphrase again. `reloadagent` is the same
/// command `gpg-connect-agent` documents for flushing the cache; a missing
/// agent is not an error (nothing is cached in that case).
pub fn lock(_value: &Value) {
    let _ = Command::new("gpg-connect-agent")
        .args(["reloadagent", "/bye"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    response::SendOk(LockResponse { Locked: true });
}

/// Decrypt `file_path` with the passphrase supplied on gpg's stdin. The
/// plaintext is read and dropped — the point is the side effect of gpg-agent
/// caching the passphrase, not the contents.
///
/// Flags mirror the ported `GpgDecryptFile` (`--decrypt --yes --quiet
/// --batch`) so the probe exercises the same path a later fetch takes, plus
/// the two that make an unattended passphrase possible:
///   `--pinentry-mode loopback`  gpg prompts on its own instead of spawning
///                               a pinentry that needs a TTY the browser-
///                               spawned host does not have
///   `--passphrase-fd 0`         read the passphrase from stdin; the encrypted
///                               input comes from the path argument instead
fn prime_agent(file_path: &Path, gpgPath: &str, passphrase: &[u8]) -> Result<(), String> {
    let mut cmd = Command::new(gpgPath)
        .args([
            "--decrypt",
            "--yes",
            "--quiet",
            "--batch",
            "--pinentry-mode",
            "loopback",
            "--passphrase-fd",
            "0",
            "--output",
            "-",
        ])
        .arg(file_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn gpg: {e}"))?;

    // gpg reads the passphrase as the first line of fd 0, so it must be
    // newline-terminated and the pipe closed before gpg will proceed.
    if let Some(mut sin) = cmd.stdin.take() {
        sin.write_all(passphrase)
            .and_then(|_| sin.write_all(b"\n"))
            .map_err(|e| format!("write passphrase: {e}"))?;
    }

    let mut plaintext = Vec::new();
    if let Some(mut s) = cmd.stdout.take() {
        s.read_to_end(&mut plaintext).ok();
    }
    zeroize(&mut plaintext);

    let mut stderr = String::new();
    if let Some(mut s) = cmd.stderr.take() {
        s.read_to_string(&mut stderr).ok();
    }
    let status = cmd.wait().map_err(|e| format!("wait: {e}"))?;
    if !status.success() {
        return Err(format!("gpg exited {status}: {}", stderr.trim()));
    }
    Ok(())
}

/// Map gpg's stderr onto a message the popup can show verbatim. A wrong
/// passphrase and an agent built without loopback support both surface as a
/// non-zero exit, and the user's next move differs, so they are separated.
pub fn classify(stderr: &str) -> String {
    let lower = stderr.to_lowercase();
    if lower.contains("bad passphrase") {
        return "Bad passphrase".to_string();
    }
    if lower.contains("loopback") || lower.contains("inappropriate ioctl") {
        return "gpg-agent refused the loopback passphrase — add `allow-loopback-pinentry` to ~/.gnupg/gpg-agent.conf and run `gpgconf --reload gpg-agent`".to_string();
    }
    if lower.contains("no secret key") || lower.contains("decryption failed") {
        return "No secret key for this store's recipients".to_string();
    }
    "Unable to unlock the password store".to_string()
}

/// First `.gpg` entry under `root` by sorted store-relative path, `.git`
/// skipped. Returned with the `.gpg` suffix so it joins onto the store path
/// directly.
pub fn first_entry(root: &Path) -> Option<String> {
    let mut found: Vec<String> = Vec::new();
    collect(root, root, &mut found);
    found.sort();
    found.into_iter().next()
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            if path.file_name() == Some(OsStr::new(".git")) {
                continue;
            }
            collect(root, &path, out);
        } else if ft.is_file() && path.extension().and_then(|s| s.to_str()) == Some("gpg") {
            if let Ok(rel) = path.strip_prefix(root) {
                out.push(rel.to_string_lossy().into_owned());
            }
        }
    }
}

/// Same gpg-binary resolution the ported `fetch` does: an explicit request- or
/// store-level `gpgPath` wins and is validated, otherwise autodetect.
fn resolve_gpg_path(
    req: &request,
    storeGpgPath: &str,
) -> Result<String, (errors::Code, &'static str, String)> {
    let configured = if !req.Settings.GpgPath.is_empty() {
        req.Settings.GpgPath.clone()
    } else {
        storeGpgPath.to_string()
    };
    if !configured.is_empty() {
        return match helpers::ValidateGpgBinary(&configured) {
            Ok(()) => Ok(configured),
            Err(e) => Err((
                errors::Code::InvalidGpgPath,
                "The provided gpg binary path is invalid",
                e,
            )),
        };
    }
    helpers::DetectGpgBinary().map_err(|e| {
        (
            errors::Code::UnableToDetectGpgPath,
            "Unable to detect the location of the gpg binary",
            e,
        )
    })
}

/// Overwrite a secret buffer with volatile writes so the compiler cannot
/// elide the clear as a dead store, then drop its length.
fn zeroize(buf: &mut Vec<u8>) {
    for b in buf.iter_mut() {
        unsafe { std::ptr::write_volatile(b, 0) };
    }
    buf.clear();
}

#[allow(non_snake_case)]
const _: () = ();
