# browserpass-host-rs

[![crates.io](https://img.shields.io/crates/v/browserpass-host-rs.svg)](https://crates.io/crates/browserpass-host-rs)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Rust port of [browserpass-native](https://github.com/browserpass/browserpass-native)** — a drop-in replacement for the Go binary that the [browserpass-extension](https://github.com/browserpass/browserpass-extension) browser extension talks to via Chrome / Firefox native messaging — **plus** three additive actions (OTP, whole-store search, segmented download manager) that browserpass-extension does not call.

Single static binary. Pure-Rust dependency tree (`serde`, `serde_json`, `ureq` with rustls). No `aria2`, no system OpenSSL, no Go toolchain at runtime.

## Wire compatibility with upstream

`browserpass-host-rs` implements every action documented in [browserpass-native's PROTOCOL.md](https://github.com/browserpass/browserpass-native/blob/master/PROTOCOL.md) v3.1.2:

| Action      | Implementation               | Test pin                                          |
| ----------- | ---------------------------- | ------------------------------------------------- |
| `configure` | `ported/request/configure.rs` | `tests/ported_configure_helpers.rs` + integration |
| `list`      | `ported/request/list.rs`     | `tests/ported_integration.rs` (4 cases)           |
| `tree`      | `ported/request/tree.rs`     | `tests/ported_integration.rs`                     |
| `fetch`     | `ported/request/fetch.rs`    | `tests/ported_integration.rs`                     |
| `save`      | `ported/request/save.rs`     | `tests/ported_integration.rs`                     |
| `delete`    | `ported/request/delete.rs`   | `tests/ported_integration.rs` (incl. parent cleanup) |
| `echo`      | `bin/browserpass_host_rs.rs` | `tests/ported_integration.rs`                     |

Error codes 10–32 from `errors/errors.go` pin to the same integers; exit code equals the error code (matches upstream `errors.ExitWithCode`); version is reported as `3.1.2` (packed int `3_001_002`).

## Strict port discipline

The `src/ported/` tree is a **1:1 Rust mirror** of the upstream Go source:

- Every file under `src/ported/` mirrors a single upstream Go file by stem and relative subpath. `errors/errors.go` → `src/ported/errors/errors.rs`, `request/configure.go` → `src/ported/request/configure.rs`, etc.
- Every Rust fn carries a `/// Port of <name>() from <go_file>:<line>` doc comment.
- Go's PascalCase / camelCase identifiers are preserved verbatim (`DetectGpgBinary`, `MakeConfigureResponse`, `parseRequestLength`). File-level `#![allow(non_snake_case)]` makes this an explicit, audit-friendly decision rather than a style accident.
- Every Go inline comment carries over to the Rust port with a `// go:NN` line-number citation on the corresponding Rust statement.
- Local variable names match Go's (`gpgPath`, `normalizedStorePath`, `parentDir`, `responseData`).
- No invented helpers — the two recursive store walkers inside `list.rs` and `tree.rs` are inlined private fns at the call site because they replace external Go deps (`mattn/go-zglob`, `mattn/go-zglob/fastwalk`), not Go-source fns.
- Drift is caught by `tests/ported_errors.rs` (every error code pinned to its PROTOCOL.md value) + `tests/ported_version.rs` (version triple + packed int) + `tests/ported_integration.rs` (every action exercised end-to-end against the compiled binary).

This discipline is borrowed from the [`zshrs` PORT.md](https://github.com/MenkeTechnologies/zshrs/blob/main/docs/PORT.md) rules and adapted to a Go→Rust port.

## Extension actions

These are additive — `browserpass-extension` never sends them, so wire compatibility with upstream is preserved. They live under `src/extensions/`:

| Action     | Behavior                                                                                                       | Wire shape                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `otp`      | Shells `pass otp <entry>` with `PASSWORD_STORE_DIR` set to the matching store. Returns the current TOTP code. | request `{action:"otp", storeId, file, settings}` → ok `{code:"123456"}`                                                                                            |
| `search`   | Host-side fuzzy + substring scoring across every configured store. Faster than client-side fzf for large stores. | request `{action:"search", settings, echoResponse:"<query>"}` → ok `{matches:[{store, path}, …]}`                                                                  |
| `dl.add`   | Spawns a detached worker (`browserpass-host-rs --dl-worker <gid>`) that performs a multi-segment download via ureq + Range requests. State lives at `$XDG_CACHE_HOME/zpwrchrome/dl/gid_NNNNNN.json`. | request `{action:"dl.add", url, dir?, name?, segments?, cookies?, userAgent?}` → ok `{gid, dest}`                                                                   |
| `dl.list`  | Reads every state file under the cache dir and returns the job array.                                          | request `{action:"dl.list"}` → ok `{jobs:[JobState, …]}`                                                                                                            |
| `dl.pause` | Writes `paused=true` into the state file. Worker polls the flag between chunks.                                | request `{action:"dl.pause", gid}` → ok `{gid, status:"paused"}`                                                                                                    |
| `dl.resume`| Clears `paused`/`cancelled` flags. Respawns the worker if it had previously terminated.                        | request `{action:"dl.resume", gid}` → ok `{gid, status:"resumed"}`                                                                                                  |
| `dl.cancel`| Writes `cancelled=true`. Worker removes partial dest file + state file on exit.                                | request `{action:"dl.cancel", gid}` → ok `{gid, status:"cancelled"}`                                                                                                |

The downloader is built around HTTP Range requests:

- HEAD probe for `Content-Length` + `Accept-Ranges`
- Pre-allocates the destination file via `set_len`
- Spawns N segment threads (default 4, clamp 1–16) — each writes its byte range at its file offset
- Retries transient failures (5xx + transport errors) with `200ms × 3ⁿ` backoff, up to 4 attempts; segments resume from their local `downloaded` offset via Range header on retry
- Filename collisions auto-rename `foo.zip` → `foo (1).zip` (dotfile-aware: `.bashrc` → `.bashrc (1)`, not ` (1).bashrc`)
- Cookies + `User-Agent` are forwarded from `chrome.cookies.getAll()` so logged-in downloads work the same way the browser would

## Install

### As a Cargo binary

```sh
cargo install browserpass-host-rs
```

That installs `browserpass-host-rs` into `$CARGO_HOME/bin`. Then register the native-messaging manifest so a browser will spawn the binary:

```sh
# From the source repo (clone https://github.com/MenkeTechnologies/zpwrchrome)
cd host
./install-browserpass.sh
```

The installer writes `com.github.browserpass.native.json` to every detected Chromium-family browser config dir on macOS and Linux, plus Firefox's native-messaging directory. `allowed_origins` / `allowed_extensions` are populated with the public browserpass-extension IDs from the Chrome Web Store, AMO, and Edge Add-ons.

### As a drop-in for the Go binary

If the upstream `browserpass-native` package is already installed via a package manager (apt, brew, etc.), uninstall it first — both binaries register under the same NM name (`com.github.browserpass.native`) and the last one to write the manifest wins. browserpass-extension will then talk to `browserpass-host-rs` transparently.

## Architecture

```
host/src/
├── lib.rs                       # pub mod ported + extensions + frame
├── frame.rs                     # NM length-prefixed JSON framing (≤1 MiB)
├── ported/                      # 1:1 Rust port of browserpass-native
│   ├── errors/errors.rs
│   ├── helpers/helpers.rs
│   ├── request/
│   │   ├── common.rs            # normalizePasswordStorePath (env expansion inlined)
│   │   ├── configure.rs         # configure + getDefaultPasswordStorePath + readDefaultSettings
│   │   ├── delete.rs            # deleteFile + parent-dir cleanup loop
│   │   ├── fetch.rs             # fetchDecryptedContents + gpg dispatch chain
│   │   ├── list.rs              # listFiles (inline std::fs walker replaces zglob)
│   │   ├── process.rs           # Process + parseRequestLength + parseRequest + request types
│   │   ├── save.rs              # saveEncryptedContents + .gpg-id recipient walk
│   │   └── tree.rs              # listDirectories (inline std::fs walker replaces fastwalk)
│   ├── response/response.rs     # ok/error envelopes, send_ok/send_err/send_raw
│   └── version/version.rs       # 3.1.2 / 3_001_002
├── extensions/                  # additive — not in upstream
│   ├── dl.rs                    # file-state segmented downloader + worker process
│   ├── otp.rs                   # shells pass otp
│   └── search.rs                # host-side fuzzy + substring scoring
└── bin/
    └── browserpass_host_rs.rs   # port of main.go + extension dispatch hook
```

## Testing

```sh
cargo test
```

Currently **69 tests** across:

- Pure protocol pins (`tests/ported_version.rs`, `tests/ported_errors.rs`) — 5
- Pure helpers (`tests/ported_helpers.rs`, `tests/ported_common.rs`, `tests/ported_configure_helpers.rs`) — 15
- End-to-end with spawned binary (`tests/ported_integration.rs`) — 12 cases including echo round-trip, every error code path, and configure/list/tree/delete against tempdir stores
- Frame round-trip (`tests/frame_roundtrip.rs`) — 6
- Extensions: `extensions_otp.rs` (3), `extensions_search.rs` (6), `extensions_dl_state.rs` (16), `extensions_dl_integration.rs` (6 including a 2 MiB segmented download against a local HTTP server with Range support, verified byte-for-byte)

Total: **69 tests, 0 failures**.

## License

MIT. See [LICENSE](LICENSE).

## Credits

- Upstream Go reference: [browserpass/browserpass-native](https://github.com/browserpass/browserpass-native) by Maxim Baz + contributors
- Protocol spec: [browserpass-native/PROTOCOL.md](https://github.com/browserpass/browserpass-native/blob/master/PROTOCOL.md)
- This Rust port + extensions: [MenkeTechnologies](https://github.com/MenkeTechnologies)
