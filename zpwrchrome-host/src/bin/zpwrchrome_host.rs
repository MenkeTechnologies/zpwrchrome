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

use serde_json::Value;
use std::io;
use zpwrchrome_host::diag;
use zpwrchrome_host::extensions::{dl, host, otp, run_command, search, zcite};
use zpwrchrome_host::frame;
use zpwrchrome_host::ported::errors::{self, field};
use zpwrchrome_host::ported::request::process::request;
use zpwrchrome_host::ported::response;
use zpwrchrome_host::ported::version;

fn main() {
    diag::install_panic_hook();

    let mut isVerbose: bool = false;
    let mut isVersion: bool = false;

    let args: Vec<String> = std::env::args().skip(1).collect();
    diag::log_start(&args);
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-v" => {
                isVerbose = true;
            }
            "-version" | "--version" | "-V" => {
                isVersion = true;
            }
            "-h" | "--help" => {
                print_help();
                return;
            }
            "--dl-worker" => {
                // Detached worker for one gid; takes the gid as the next arg.
                let gid: u64 = args
                    .get(i + 1)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or_else(|| {
                        eprintln!("--dl-worker requires numeric gid arg");
                        std::process::exit(2);
                    });
                let _ = dl::run_worker(gid);
                return;
            }
            "--install" => {
                // Register this binary as a native messaging host for every
                // detected Chromium-family browser on macOS/Linux. Takes the
                // extension ID(s) as the remaining args.
                //   zpwrchrome-host --install <ext-id> [<ext-id> ...]
                let ext_ids: Vec<&str> = args.iter().skip(i + 1).map(|s| s.as_str()).collect();
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
            other
                if other.starts_with("chrome-extension://")
                    || other.starts_with("moz-extension://")
                    || other.starts_with("--parent-window=") =>
            {
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
                    (
                        field::MESSAGE,
                        "Unable to parse the length of the browser request",
                    ),
                    (field::ERROR, &e.to_string()),
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
                    (field::ERROR, &e.to_string()),
                ])),
            );
        }
    };
    let action_str: String = value
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    diag::log(&format!("ACTION action={action_str}"));

    // 1. Extension actions — zpwrchrome additions that browserpass-extension
    //    never sends. Each handler SendOk/SendErrorAndExits on its own.
    if let Some(stripped) = action_str.strip_prefix("dl.") {
        let _ = stripped;
        diag::log(&format!(
            "DISPATCH category=extension target=dl action={action_str}"
        ));
        dl::dispatch_dl(&action_str, &value);
        diag::log("EXIT code=0 reason=dl_returned");
        return;
    }
    if action_str == "otp" || action_str == "search" {
        diag::log(&format!("DISPATCH category=extension target={action_str}"));
        // These reuse the BP request shape; safe to deserialize through it.
        let req: request = serde_json::from_value(value.clone()).unwrap_or_default();
        match action_str.as_str() {
            "otp" => otp::otp(&req),
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
                    (field::ERROR, &e.to_string()),
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
        "list" => list::listFiles(req),
        "tree" => tree::listDirectories(req),
        "fetch" => fetch::fetchDecryptedContents(req),
        "save" => save::saveEncryptedContents(req),
        "delete" => delete::deleteFile(req),
        "echo" => {
            response::SendRaw(&req.EchoResponse.clone().unwrap_or(serde_json::Value::Null));
        }
        other => {
            eprintln!("Received a browser request with an unknown action: {other}");
            response::SendErrorAndExit(
                errors::Code::InvalidRequestAction,
                Some(response::params_of(&[
                    (field::MESSAGE, "Invalid request action"),
                    (field::ACTION, other),
                ])),
            );
        }
    }
}

/// Crate version (0.10.x), distinct from the browserpass *protocol* version
/// (`version::string()` == 3.1.2) reported to the extension.
const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Cyberpunk `--help` wordmark (ANSI-Shadow "ZPWRCHROME"), cyan→magenta→red —
/// same house style as `zwire-host` (`zwire-host/src/lib.rs`) / `tp -h`.
const BANNER: &str = concat!(
    "\x1b[36m███████╗██████╗ ██╗    ██╗██████╗  ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗███████╗\x1b[0m\n",
    "\x1b[36m╚══███╔╝██╔══██╗██║    ██║██╔══██╗██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██╔════╝\x1b[0m\n",
    "\x1b[35m  ███╔╝ ██████╔╝██║ █╗ ██║██████╔╝██║     ███████║██████╔╝██║   ██║██╔████╔██║█████╗  \x1b[0m\n",
    "\x1b[35m ███╔╝  ██╔═══╝ ██║███╗██║██╔══██╗██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██╔══╝  \x1b[0m\n",
    "\x1b[31m███████╗██║     ╚███╔███╔╝██║  ██║╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║███████╗\x1b[0m\n",
    "\x1b[31m╚══════╝╚═╝      ╚══╝╚══╝ ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝\x1b[0m\n",
);

/// Static body of the `--help` screen (a plain string literal so the `dl.*`
/// dotted names and section rules stay verbatim).
const HELP_BODY: &str = "  \x1b[35m>> BROWSER NATIVE HOST // PASS · OTP · SEARCH · DOWNLOADS <<\x1b[0m\n\n  native-messaging host — browserpass PROTOCOL v3.1.2 + zpwrchrome actions\n\n\x1b[33m  USAGE:\x1b[0m zpwrchrome-host [MODE]\n\n\x1b[36m  ── MODES ─────────────────────────────────────────────────────\x1b[0m\n  zpwrchrome-host                    \x1b[32m//\x1b[0m native-messaging on stdio (Chrome default)\n  zpwrchrome-host --install <id>…    \x1b[32m//\x1b[0m register as NM host for every detected browser\n  zpwrchrome-host -version           \x1b[32m//\x1b[0m print protocol version and exit\n  zpwrchrome-host -v                 \x1b[32m//\x1b[0m verbose log to stderr\n  zpwrchrome-host -h | --help        \x1b[32m//\x1b[0m print this help\n\n\x1b[36m  ── PROTOCOL ACTIONS (browserpass) ────────────────────────────\x1b[0m\n  configure · list · tree · fetch · save · delete · echo\n\n\x1b[36m  ── EXTENSION ACTIONS (zpwrchrome) ────────────────────────────\x1b[0m\n  otp · search · run.spawn · host.crawl · host.exec · zcite.save\n\n\x1b[36m  ── DOWNLOAD MANAGER ──────────────────────────────────────────\x1b[0m\n  dl.add · dl.list · dl.pause · dl.resume · dl.cancel · dl.remove · dl.clear\n  dl.openDir · dl.openFile · dl.writeFile · dl.writeFileChunk\n";

/// Build the styled `--help` / `-h` screen in the MenkeTechnologies house
/// style (see `zwire-host` / `tp -h`): banner, a status box padded at runtime
/// so its right border never drifts as the version grows, cyan section rules,
/// green `//` comments.
fn usage() -> String {
    const BOX_W: usize = 72;
    let status = format!(" STATUS: ONLINE  // SIGNAL: ████████░░ // v{HOST_VERSION}");
    let space = " ".repeat(BOX_W.saturating_sub(status.chars().count()));
    let rule = "─".repeat(BOX_W);
    format!(
        "\n{BANNER} \x1b[36m┌{rule}┐\x1b[0m\n \x1b[36m│\x1b[0m{status}{space}\x1b[36m│\x1b[0m\n \x1b[36m└{rule}┘\x1b[0m\n{HELP_BODY}\n\x1b[36m  ── SYSTEM ────────────────────────────────────────────────────\x1b[0m\n  \x1b[35mv{HOST_VERSION} \x1b[0m// \x1b[33m(c) MenkeTechnologies\x1b[0m\n  \x1b[35mUNIX pass in the browser. One binary. Owns the default download.\x1b[0m\n \x1b[36m░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░\x1b[0m\n"
    )
}

fn print_help() {
    print!("{}", usage());
}

// Maps a versioned Homebrew keg path back onto the version-independent `opt`
// symlink: `<prefix>/Cellar/<formula>/<version>/bin/x` -> `<prefix>/opt/<formula>/bin/x`.
// current_exe().canonicalize() resolves `<prefix>/bin/x` down into the keg, and
// `brew upgrade` deletes the old keg — baking that path into the NM manifest
// leaves the browser unable to spawn the host after the next upgrade. Paths
// outside a Cellar, or whose `opt` link is missing, are returned unchanged.
fn stable_exe_path(exe: &std::path::Path) -> std::path::PathBuf {
    let parts: Vec<_> = exe.components().collect();
    let Some(i) = parts.iter().position(|c| c.as_os_str() == "Cellar") else {
        return exe.to_path_buf();
    };
    // Need <formula>/<version>/<...at least one more...> after "Cellar".
    if parts.len() < i + 4 {
        return exe.to_path_buf();
    }
    let mut stable: std::path::PathBuf = parts[..i].iter().collect();
    stable.push("opt");
    stable.push(parts[i + 1]); // formula
    stable.extend(parts[i + 3..].iter()); // skip <version>, keep bin/x
    if stable.exists() { stable } else { exe.to_path_buf() }
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
    let exe = stable_exe_path(&exe);
    let exe_str = exe.to_string_lossy();
    let home = std::env::var("HOME")
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::NotFound, "HOME not set"))?;

    // (dir, force). force=false: only write when the dir's parent (the browser's
    // profile/config root) already exists, so we never litter a manifest for a
    // browser the user doesn't have. force=true: create + write unconditionally.
    let mut dirs: Vec<(std::path::PathBuf, bool)> = if cfg!(target_os = "macos") {
        vec![
            (format!("{home}/Library/Application Support/Google/Chrome/NativeMessagingHosts").into(), false),
            (format!("{home}/Library/Application Support/Chromium/NativeMessagingHosts").into(), false),
            (format!("{home}/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts").into(), false),
            (format!("{home}/Library/Application Support/Microsoft Edge/NativeMessagingHosts").into(), false),
        ]
    } else {
        vec![
            (
                format!("{home}/.config/google-chrome/NativeMessagingHosts").into(),
                false,
            ),
            (
                format!("{home}/.config/chromium/NativeMessagingHosts").into(),
                false,
            ),
            (
                format!("{home}/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts").into(),
                false,
            ),
            (
                format!("{home}/.config/microsoft-edge/NativeMessagingHosts").into(),
                false,
            ),
        ]
    };

    // zwire is a Chromium fork launched against its own --user-data-dir, so it
    // reads native-messaging manifests from <profile>/NativeMessagingHosts/, not
    // the shared browser config dirs above. The canonical state dir mirrors
    // scripts/state-dir.sh exactly:
    //   macOS  ~/Library/Application Support/com.menketechnologies.zwire (bundle id)
    //   other  ${XDG_CONFIG_HOME:-~/.config}/zwire
    // $ZWIRE_STATE overrides everything, same as the launcher. The host is
    // registered BEFORE the browser's first launch, so <state>/profile does not
    // exist yet — the canonical dir is therefore created unconditionally
    // (force=true), never gated on the profile already existing. The legacy dir
    // (the OTHER naming a prior zwire build used) is written only when its profile
    // already exists (force=false), so a still-installed older app keeps working
    // without littering a manifest for a dir the user never had.
    let (zwire_canonical, zwire_legacy): (String, Option<String>) =
        match std::env::var("ZWIRE_STATE") {
            Ok(s) if !s.is_empty() => (s, None),
            _ => {
                if cfg!(target_os = "macos") {
                    (
                        format!("{home}/Library/Application Support/com.menketechnologies.zwire"),
                        Some(format!("{home}/Library/Application Support/zwire")),
                    )
                } else {
                    let base = std::env::var("XDG_CONFIG_HOME")
                        .ok()
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| format!("{home}/.config"));
                    (
                        format!("{base}/zwire"),
                        Some(format!("{base}/com.menketechnologies.zwire")),
                    )
                }
            }
        };
    dirs.push((
        format!("{zwire_canonical}/profile/NativeMessagingHosts").into(),
        true,
    ));
    if let Some(legacy) = zwire_legacy {
        dirs.push((
            format!("{legacy}/profile/NativeMessagingHosts").into(),
            false,
        ));
    }

    let origins: Vec<String> = ext_ids
        .iter()
        .map(|id| format!("    \"chrome-extension://{id}/\""))
        .collect();
    let manifest = format!(
        "{{\n  \"name\": \"{HOST_NAME}\",\n  \"description\": \"zpwrchrome native host (BP protocol)\",\n  \"path\": \"{exe_str}\",\n  \"type\": \"stdio\",\n  \"allowed_origins\": [\n{}\n  ]\n}}\n",
        origins.join(",\n")
    );

    let mut installed = 0usize;
    for (dir, force) in &dirs {
        // Gated dirs (force=false): only write if the parent (browser profile /
        // config root) already exists, so we don't litter manifests for browsers
        // the user doesn't have. Forced dirs (the canonical zwire state dir) are
        // created outright — the host is registered before zwire's first launch.
        if !force {
            let parent = match dir.parent() {
                Some(p) => p,
                None => continue,
            };
            if !parent.exists() {
                continue;
            }
        }
        std::fs::create_dir_all(dir)?;
        let target = dir.join(format!("{HOST_NAME}.json"));
        std::fs::write(&target, &manifest)?;
        println!("installed: {}", target.display());
        installed += 1;
    }
    Ok(installed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // <prefix>/Cellar/zpwrchrome-host/<ver>/bin/zpwrchrome-host + the opt link.
    fn keg(prefix: &std::path::Path, ver: &str, with_opt_link: bool) -> PathBuf {
        let cellar = prefix.join("Cellar/zpwrchrome-host").join(ver).join("bin");
        std::fs::create_dir_all(&cellar).unwrap();
        std::fs::write(cellar.join("zpwrchrome-host"), b"x").unwrap();
        if with_opt_link {
            let opt = prefix.join("opt/zpwrchrome-host/bin");
            std::fs::create_dir_all(&opt).unwrap();
            std::fs::write(opt.join("zpwrchrome-host"), b"x").unwrap();
        }
        cellar.join("zpwrchrome-host")
    }

    // The regression: a keg path baked into the NM manifest dies on the next
    // `brew upgrade`, the browser can't spawn the host, and every download
    // silently falls back to the browser's own downloader.
    #[test]
    fn cellar_path_maps_to_version_independent_opt_link() {
        let prefix =
            std::env::temp_dir().join(format!("zpwrchrome-keg-ok-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&prefix);
        let exe = keg(&prefix, "0.10.1", true);
        assert_eq!(
            stable_exe_path(&exe),
            prefix.join("opt/zpwrchrome-host/bin/zpwrchrome-host")
        );
        let _ = std::fs::remove_dir_all(&prefix);
    }

    #[test]
    fn keeps_keg_path_when_opt_link_is_absent() {
        let prefix =
            std::env::temp_dir().join(format!("zpwrchrome-keg-noopt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&prefix);
        let exe = keg(&prefix, "0.10.1", false);
        assert_eq!(stable_exe_path(&exe), exe);
        let _ = std::fs::remove_dir_all(&prefix);
    }

    #[test]
    fn leaves_non_homebrew_paths_alone() {
        let exe = PathBuf::from("/usr/local/bin/zpwrchrome-host");
        assert_eq!(stable_exe_path(&exe), exe);
    }
}
