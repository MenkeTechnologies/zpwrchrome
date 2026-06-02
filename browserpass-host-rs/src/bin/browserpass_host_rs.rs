//! Port of `main.go` from upstream `browserpass-native`, **plus** the
//! zpwrchrome extension actions (otp, search, dl.*) layered on top.
//!
//! Wire-compatible with upstream `browserpass-extension`: every upstream
//! action ("configure", "list", "tree", "fetch", "save", "delete", "echo")
//! is handled by the ported strict-1:1 code path in `ported::request::*`.
//! The additive actions live under `extensions::*` and are dispatched
//! *before* falling back to the upstream dispatcher — upstream never sends
//! those action names, so this layering does not alter upstream behavior.
//!
//! Process model mirrors upstream: one request per process spawn,
//! exit code = error code on failure, 0 on success.
#![allow(non_snake_case)]

use browserpass_host_rs::extensions::{dl, otp, search};
use browserpass_host_rs::frame;
use browserpass_host_rs::ported::errors::{self, field};
use browserpass_host_rs::ported::request::process::request;
use browserpass_host_rs::ported::response;
use browserpass_host_rs::ported::version;
use serde_json::Value;
use std::io;

fn main() {
    let mut isVerbose: bool = false;
    let mut isVersion: bool = false;

    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-v"                            => { isVerbose = true; }
            "-version" | "--version" | "-V" => { isVersion = true; }
            "-h" | "--help"                 => { print_help(); return; }
            "--dl-worker"                   => {
                // Detached worker for one gid; takes the gid as the next arg.
                let gid: u64 = args.get(i + 1)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or_else(|| {
                        eprintln!("--dl-worker requires numeric gid arg");
                        std::process::exit(2);
                    });
                let _ = dl::run_worker(gid);
                return;
            }
            "--install"                     => {
                // Register this binary as a native messaging host for every
                // detected Chromium-family browser on macOS/Linux. Takes the
                // extension ID(s) as the remaining args.
                //   browserpass-host-rs --install <ext-id> [<ext-id> ...]
                let ext_ids: Vec<&str> = args.iter().skip(i + 1)
                    .map(|s| s.as_str())
                    .collect();
                if ext_ids.is_empty() {
                    eprintln!("--install requires at least one Chrome extension ID");
                    eprintln!("find IDs at chrome://extensions (Developer mode)");
                    std::process::exit(2);
                }
                match install_nm_manifest(&ext_ids) {
                    Ok(n) if n > 0 => {
                        println!("installed NM manifest into {n} browser config dir(s)");
                        println!("restart your browser if zpwrchrome is already loaded.");
                    }
                    Ok(_) => {
                        eprintln!("no Chromium-family browser config dirs found");
                        std::process::exit(2);
                    }
                    Err(e) => {
                        eprintln!("install failed: {e}");
                        std::process::exit(1);
                    }
                }
                return;
            }
            other => {
                eprintln!("browserpass-host-rs: unknown argument: {other}");
                std::process::exit(2);
            }
        }
        i += 1;
    }

    if isVersion {
        println!("Browserpass host app version: {}", version::string());
        std::process::exit(0);
    }

    if isVerbose {
        eprintln!("Starting browserpass host app v{}", version::string());
    }

    // Read one framed JSON message and parse it twice: once as a raw Value
    // (for extension actions that take their own shape) and once as the
    // ported BP `request` (for upstream actions). The double-parse keeps the
    // ported request struct free of extension fields.
    let stdin = io::stdin();
    let mut sin = stdin.lock();
    let raw = match frame::read_msg(&mut sin) {
        Ok(b) => b,
        Err(e) => {
            response::SendErrorAndExit(
                errors::Code::ParseRequestLength,
                Some(response::params_of(&[
                    (field::MESSAGE, "Unable to parse the length of the browser request"),
                    (field::ERROR,   &e.to_string()),
                ])),
            );
        }
    };

    let value: Value = match serde_json::from_slice(&raw) {
        Ok(v) => v,
        Err(e) => {
            response::SendErrorAndExit(
                errors::Code::ParseRequest,
                Some(response::params_of(&[
                    (field::MESSAGE, "Unable to parse the browser request"),
                    (field::ERROR,   &e.to_string()),
                ])),
            );
        }
    };
    let action_str: String = value.get("action")
        .and_then(|v| v.as_str()).unwrap_or("").to_string();

    // 1. Extension actions — zpwrchrome additions that browserpass-extension
    //    never sends. Each handler SendOk/SendErrorAndExits on its own.
    if let Some(stripped) = action_str.strip_prefix("dl.") {
        let _ = stripped;
        dl::dispatch_dl(&action_str, &value);
        return;
    }
    if action_str == "otp" || action_str == "search" {
        // These reuse the BP request shape; safe to deserialize through it.
        let req: request = serde_json::from_value(value.clone()).unwrap_or_default();
        match action_str.as_str() {
            "otp"    => otp::otp(&req),
            "search" => search::search(&req),
            _ => unreachable!(),
        }
        return;
    }

    // 2. Upstream BP actions — delegate to the ported switch.
    let req: request = match serde_json::from_value(value) {
        Ok(r) => r,
        Err(e) => {
            response::SendErrorAndExit(
                errors::Code::ParseRequest,
                Some(response::params_of(&[
                    (field::MESSAGE, "Unable to deserialize browser request"),
                    (field::ERROR,   &e.to_string()),
                ])),
            );
        }
    };
    process_dispatch(&req);
}

// Mirrors the switch block from request/process.go:65. Kept here in `bin/`
// because it bridges the strict-port code path and the extension layer —
// it would belong in `ported/` only if upstream Go had an equivalent
// extension hook, which it doesn't.
fn process_dispatch(req: &request) {
    use browserpass_host_rs::ported::request::{configure, delete, fetch, list, save, tree};
    match req.Action.as_str() {
        "configure" => configure::configure(req),
        "list"      => list::listFiles(req),
        "tree"      => tree::listDirectories(req),
        "fetch"     => fetch::fetchDecryptedContents(req),
        "save"      => save::saveEncryptedContents(req),
        "delete"    => delete::deleteFile(req),
        "echo"      => {
            response::SendRaw(
                &req.EchoResponse
                    .clone()
                    .unwrap_or(serde_json::Value::Null),
            );
        }
        other => {
            eprintln!("Received a browser request with an unknown action: {other}");
            response::SendErrorAndExit(
                errors::Code::InvalidRequestAction,
                Some(response::params_of(&[
                    (field::MESSAGE, "Invalid request action"),
                    (field::ACTION,  other),
                ])),
            );
        }
    }
}

fn print_help() {
    println!(
        "browserpass-host-rs — Rust port of browserpass-native v{}\n\n\
         USAGE:\n  \
         browserpass-host-rs                       read framed JSON requests on stdin\n  \
         browserpass-host-rs --install <ext-id>    register as Chrome NM host for the given\n  \
                                                    extension ID(s); writes the manifest into\n  \
                                                    every detected Chromium-family browser dir\n  \
         browserpass-host-rs -version              print version and exit\n  \
         browserpass-host-rs -v                    verbose log to stderr\n\n\
         Upstream BP actions:   configure, list, tree, fetch, save, delete, echo\n\
         Extension actions:     otp, search, dl.add/list/pause/resume/cancel\n",
        version::string()
    );
}

// Writes the NM manifest registering this binary as
// `com.menketechnologies.zpwrchrome` for every Chromium-family browser
// config directory the current user has on disk. Returns the number of
// directories the manifest was written into.
fn install_nm_manifest(ext_ids: &[&str]) -> std::io::Result<usize> {
    const HOST_NAME: &str = "com.menketechnologies.zpwrchrome";
    let exe = std::env::current_exe()?
        .canonicalize()
        .unwrap_or_else(|_| std::env::current_exe().unwrap());
    let exe_str = exe.to_string_lossy();
    let home = std::env::var("HOME")
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::NotFound, "HOME not set"))?;

    let dirs: Vec<std::path::PathBuf> = if cfg!(target_os = "macos") {
        vec![
            format!("{home}/Library/Application Support/Google/Chrome/NativeMessagingHosts").into(),
            format!("{home}/Library/Application Support/Chromium/NativeMessagingHosts").into(),
            format!("{home}/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts").into(),
            format!("{home}/Library/Application Support/Microsoft Edge/NativeMessagingHosts").into(),
        ]
    } else {
        vec![
            format!("{home}/.config/google-chrome/NativeMessagingHosts").into(),
            format!("{home}/.config/chromium/NativeMessagingHosts").into(),
            format!("{home}/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts").into(),
            format!("{home}/.config/microsoft-edge/NativeMessagingHosts").into(),
        ]
    };

    let origins: Vec<String> = ext_ids.iter()
        .map(|id| format!("    \"chrome-extension://{id}/\""))
        .collect();
    let manifest = format!(
        "{{\n  \"name\": \"{HOST_NAME}\",\n  \"description\": \"zpwrchrome native host (BP protocol)\",\n  \"path\": \"{exe_str}\",\n  \"type\": \"stdio\",\n  \"allowed_origins\": [\n{}\n  ]\n}}\n",
        origins.join(",\n")
    );

    let mut installed = 0usize;
    for dir in &dirs {
        // Only write if the browser's profile parent dir exists — otherwise
        // we'd litter manifests for browsers the user doesn't have.
        let parent = match dir.parent() {
            Some(p) => p,
            None => continue,
        };
        if !parent.exists() {
            continue;
        }
        std::fs::create_dir_all(dir)?;
        let target = dir.join(format!("{HOST_NAME}.json"));
        std::fs::write(&target, &manifest)?;
        println!("installed: {}", target.display());
        installed += 1;
    }
    Ok(installed)
}
