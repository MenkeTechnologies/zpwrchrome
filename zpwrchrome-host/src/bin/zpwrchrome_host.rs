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

use zpwrchrome_host::diag;
use zpwrchrome_host::extensions::{dl, host, otp, run_command, search, zcite};
use zpwrchrome_host::frame;
use zpwrchrome_host::ported::errors::{self, field};
use zpwrchrome_host::ported::request::process::request;
use zpwrchrome_host::ported::response;
use zpwrchrome_host::ported::version;
use serde_json::Value;
use std::io;

fn main() {
    diag::install_panic_hook();

    let mut isVerbose: bool = false;
    let mut isVersion: bool = false;

    let args: Vec<String> = std::env::args().skip(1).collect();
    diag::log_start(&args);
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
                //   zpwrchrome-host --install <ext-id> [<ext-id> ...]
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
            // Chrome (and other Chromium-family browsers) launch native
            // messaging hosts with the calling extension's origin URL as a
            // positional argument — e.g. `chrome-extension://<id>/`. The
            // host must accept and ignore it; otherwise the parser dies
            // before reading stdin and the browser reports "Native host
            // has exited." Upstream browserpass-native does the same.
            other if other.starts_with("chrome-extension://")
                  || other.starts_with("moz-extension://")
                  || other.starts_with("--parent-window=") => {
                diag::log(&format!("ARG_IGNORED arg={other}"));
            }
            other => {
                diag::log(&format!("ARG_UNKNOWN arg={other}"));
                eprintln!("zpwrchrome-host: unknown argument: {other}");
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
            diag::log(&format!("RECV_ERR kind=length error={e}"));
            response::SendErrorAndExit(
                errors::Code::ParseRequestLength,
                Some(response::params_of(&[
                    (field::MESSAGE, "Unable to parse the length of the browser request"),
                    (field::ERROR,   &e.to_string()),
                ])),
            );
        }
    };
    diag::log(&format!("RECV bytes={}", raw.len()));

    let value: Value = match serde_json::from_slice(&raw) {
        Ok(v) => v,
        Err(e) => {
            diag::log(&format!("RECV_ERR kind=json error={e}"));
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
    diag::log(&format!("ACTION action={action_str}"));

    // 1. Extension actions — zpwrchrome additions that browserpass-extension
    //    never sends. Each handler SendOk/SendErrorAndExits on its own.
    if let Some(stripped) = action_str.strip_prefix("dl.") {
        let _ = stripped;
        diag::log(&format!("DISPATCH category=extension target=dl action={action_str}"));
        dl::dispatch_dl(&action_str, &value);
        diag::log("EXIT code=0 reason=dl_returned");
        return;
    }
    if action_str == "otp" || action_str == "search" {
        diag::log(&format!("DISPATCH category=extension target={action_str}"));
        // These reuse the BP request shape; safe to deserialize through it.
        let req: request = serde_json::from_value(value.clone()).unwrap_or_default();
        match action_str.as_str() {
            "otp"    => otp::otp(&req),
            "search" => search::search(&req),
            _ => unreachable!(),
        }
        diag::log("EXIT code=0 reason=ext_returned");
        return;
    }
    if action_str == "run.spawn" {
        diag::log("DISPATCH category=extension target=run.spawn");
        run_command::run_spawn(&value);
        diag::log("EXIT code=0 reason=ext_returned");
        return;
    }
    if action_str == "host.crawl" || action_str == "host.exec" {
        diag::log(&format!("DISPATCH category=extension target={action_str}"));
        match action_str.as_str() {
            "host.crawl" => host::crawl(&value),
            "host.exec" => host::exec(&value),
            _ => unreachable!(),
        }
        diag::log("EXIT code=0 reason=ext_returned");
        return;
    }
    if action_str == "zcite.save" {
        diag::log("DISPATCH category=extension target=zcite.save");
        zcite::zcite_save(&value);
        diag::log("EXIT code=0 reason=ext_returned");
        return;
    }

    // 2. Upstream BP actions — delegate to the ported switch.
    let req: request = match serde_json::from_value(value) {
        Ok(r) => r,
        Err(e) => {
            diag::log(&format!("RECV_ERR kind=request_deserialize error={e}"));
            response::SendErrorAndExit(
                errors::Code::ParseRequest,
                Some(response::params_of(&[
                    (field::MESSAGE, "Unable to deserialize browser request"),
                    (field::ERROR,   &e.to_string()),
                ])),
            );
        }
    };
    diag::log(&format!("DISPATCH category=ported action={}", req.Action));
    process_dispatch(&req);
    diag::log("EXIT code=0 reason=ported_returned");
}

// Mirrors the switch block from request/process.go:65. Kept here in `bin/`
// because it bridges the strict-port code path and the extension layer —
// it would belong in `ported/` only if upstream Go had an equivalent
// extension hook, which it doesn't.
fn process_dispatch(req: &request) {
    use zpwrchrome_host::ported::request::{configure, delete, fetch, list, save, tree};
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
        "zpwrchrome-host — Rust port of browserpass-native v{}\n\n\
         USAGE:\n  \
         zpwrchrome-host                       read framed JSON requests on stdin\n  \
         zpwrchrome-host --install <ext-id>    register as Chrome NM host for the given\n  \
                                                    extension ID(s); writes the manifest into\n  \
                                                    every detected Chromium-family browser dir\n  \
         zpwrchrome-host -version              print version and exit\n  \
         zpwrchrome-host -v                    verbose log to stderr\n\n\
         Upstream BP actions:   configure, list, tree, fetch, save, delete, echo\n\
         Extension actions:     otp, search\n\
         Download manager:      dl.add/list/pause/resume/cancel/remove/clear,\n\
                                dl.openDir, dl.openFile,\n\
                                dl.writeFile, dl.writeFileChunk\n",
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

    let mut dirs: Vec<std::path::PathBuf> = if cfg!(target_os = "macos") {
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

    // zwire is a Chromium fork launched against its own --user-data-dir, so it
    // reads native-messaging manifests from <profile>/NativeMessagingHosts/, not
    // the shared browser config dirs above. Register there too. The profile lives
    // under the zwire state dir, but that dir differs by how zwire was launched:
    // the packaged macOS .app uses base::DIR_APP_DATA keyed on the bundle id
    // (com.menketechnologies.zwire), while the shell launcher (bin/zwire, via
    // scripts/state-dir.sh) uses the bare "zwire"/$XDG_CONFIG_HOME name. Cover
    // both — the parent-exists gate below skips whichever isn't present, so we
    // never litter. $ZWIRE_STATE overrides everything, same as the launcher.
    let zwire_states: Vec<String> = match std::env::var("ZWIRE_STATE") {
        Ok(s) if !s.is_empty() => vec![s],
        _ => {
            if cfg!(target_os = "macos") {
                vec![
                    format!("{home}/Library/Application Support/com.menketechnologies.zwire"),
                    format!("{home}/Library/Application Support/zwire"),
                ]
            } else {
                let base = std::env::var("XDG_CONFIG_HOME")
                    .ok()
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| format!("{home}/.config"));
                vec![
                    format!("{base}/com.menketechnologies.zwire"),
                    format!("{base}/zwire"),
                ]
            }
        }
    };
    for state in &zwire_states {
        dirs.push(format!("{state}/profile/NativeMessagingHosts").into());
    }

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
