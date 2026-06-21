# zpwrchrome-host

[![crates.io](https://img.shields.io/crates/v/zpwrchrome-host.svg)](https://crates.io/crates/zpwrchrome-host)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Rust port of [browserpass-native](https://github.com/browserpass/browserpass-native)** — a drop-in replacement for the Go binary that the [browserpass-extension](https://github.com/browserpass/browserpass-extension) browser extension talks to via Chrome / Firefox native messaging — **plus** three additive actions (OTP, whole-store search, segmented download manager) that browserpass-extension does not call.

Single static binary. Pure-Rust dependency tree (`serde`, `serde_json`, `ureq` with rustls). No `aria2`, no system OpenSSL, no Go toolchain at runtime.

## Wire compatibility with upstream

`zpwrchrome-host` implements every action documented in [browserpass-native's PROTOCOL.md](https://github.com/browserpass/browserpass-native/blob/master/PROTOCOL.md) v3.1.2:

| Action      | Implementation               | Test pin                                          |
| ----------- | ---------------------------- | ------------------------------------------------- |
| `configure` | `ported/request/configure.rs` | `tests/ported_configure_helpers.rs` + integration |
| `list`      | `ported/request/list.rs`     | `tests/ported_integration.rs` (4 cases)           |
| `tree`      | `ported/request/tree.rs`     | `tests/ported_integration.rs`                     |
| `fetch`     | `ported/request/fetch.rs`    | `tests/ported_integration.rs`                     |
| `save`      | `ported/request/save.rs`     | `tests/ported_integration.rs`                     |
| `delete`    | `ported/request/delete.rs`   | `tests/ported_integration.rs` (incl. parent cleanup) |
| `echo`      | `bin/zpwrchrome_host.rs` | `tests/ported_integration.rs`                     |

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

### Pass extensions

| Action     | Behavior                                                                                                       | Wire shape                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `otp`      | Shells `pass otp <entry>` with `PASSWORD_STORE_DIR` set to the matching store. Returns the current TOTP code. | request `{action:"otp", storeId, file, settings}` → ok `{code:"123456"}`                                                                                            |
| `search`   | Host-side fuzzy + substring scoring across every configured store. Faster than client-side fzf for large stores. | request `{action:"search", settings, echoResponse:"<query>"}` → ok `{matches:[{store, path}, …]}`                                                                  |

### Download manager

| Action                | Behavior                                                                                                                                                                                                              | Wire shape                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dl.add`              | Spawns a detached worker (`zpwrchrome-host --dl-worker <gid>`) that performs a multi-segment download via ureq + Range requests. State lives at `$XDG_CACHE_HOME/zpwrchrome/dl/gid_NNNNNN.json`. `name` accepts a [naming-mask template](#naming-mask-tokens). | `{action:"dl.add", url, dir?, name?, mask?, segments?, cookies?, userAgent?}` → ok `{gid, dest}`                                                                    |
| `dl.list`             | Reads every state file under the cache dir and returns the job array. Each row carries a host-computed `dest_exists` bool so the UI can hide reveal actions for deleted files.                                        | `{action:"dl.list"}` → ok `{jobs:[JobView, …]}`                                                                                                                     |
| `dl.pause`            | Writes `paused=true` into the state file. Worker polls the flag between chunks.                                                                                                                                       | `{action:"dl.pause", gid}` → ok `{gid, status:"paused"}`                                                                                                            |
| `dl.resume`           | Clears `paused`/`cancelled` flags. Respawns the worker if the prior `worker_pid` is dead (SW-suspension self-heal).                                                                                                   | `{action:"dl.resume", gid}` → ok `{gid, status:"resumed"}`                                                                                                          |
| `dl.cancel`           | Writes `cancelled=true`. Worker removes partial dest file + state file on exit.                                                                                                                                       | `{action:"dl.cancel", gid}` → ok `{gid, status:"cancelled"}`                                                                                                        |
| `dl.remove`           | Cancels (if running) + deletes the state file. The dest file on disk is **left alone** so partial bytes survive. UI: 🗑 button on every row.                                                                          | `{action:"dl.remove", gid}` → ok `{gid, status:"removed"}`                                                                                                          |
| `dl.clear`            | Bulk variant of `dl.remove` scoped by status. Optional `deleteFromDisk` also unlinks the destination files.                                                                                                            | `{action:"dl.clear", scope:"done"\|"failed"\|"missing"\|"all", deleteFromDisk:bool}` → ok `{cleared:[gid,…], deletedOnDisk:[path,…]}`                                  |
| `dl.openDir`          | Spawn the platform file manager (`open` / `xdg-open` / `explorer`) for a directory. Empty `dir` opens the host's default download dir; a path opens that dir (refuses if the path doesn't exist — no fake folders).   | `{action:"dl.openDir", dir?}` → ok `{opened:"<path>"}`                                                                                                              |
| `dl.openFile`         | Same opener as above but for a single file (uses the platform's default-app association). Refuses missing files.                                                                                                       | `{action:"dl.openFile", dir}` (`dir` carries the file path) → ok `{opened:"<path>"}`                                                                                |
| `dl.writeFile`        | Single-shot: base64-decode bytes and write to `dir/name`. Used by short payloads where the whole message fits inside Chrome's 64 MiB NM cap.                                                                          | `{action:"dl.writeFile", dir?, name, base64}` → ok `{dest, bytes}`                                                                                                  |
| `dl.writeFileChunk`   | Streaming append protocol for payloads larger than the NM cap (full-page screenshots, archive captures). First chunk creates `upload-<sessionId>.part`; later chunks append; final chunk renames to `dir/name`.       | `{action:"dl.writeFileChunk", sessionId, chunkIndex, base64, final, dir?, name?}` → ok `{sessionId, chunkIndex, final, …, dest, bytes}` (only on final)             |

### Worker process model

The download worker (`zpwrchrome-host --dl-worker <gid>`) is the detached child process that performs the actual byte transfer:

- **Spawn isolation** — `setsid()` + `close(fd)` for every `fd >= 3` before `exec`. Without this the worker inherits Chrome's NM stdout pipe; Chrome never sees EOF on the parent host and reports `Native host has exited` even on a successful response.
- **Liveness check on resume** — `worker_pid` is written into the state file by `run_worker` at start. On `dl.resume` for a paused job, `worker_alive(prior_pid)` (via `kill(pid, 0)`) decides whether to flip the paused flag (live worker will notice) or spawn a fresh worker (dead worker means SW was suspended and the previous worker process was reaped).
- **Path probing** — `probe_headers(url, cookies, ua)` tries HEAD first; on failure or non-OK (common on pre-signed S3 URLs that bind the signature to the GET method — GitHub releases, Cloudflare R2, etc.) falls back to `GET` with `Range: bytes=0-0`. A 206 response gives Content-Range + confirms Range support; a 200 means Range is ignored and we record the full size.
- **Segmented mode (download accelerator)** — this is the acceleration path: total ≥ `MIN_SEGMENT_BYTES` + `accept_ranges` + `segments > 1` → N threads each fetch one byte range over its own connection, so throughput scales past what a single stream gives (IDM / aria2 / axel model). A shared `AtomicU64 done_total` accumulates bytes across threads; a `progress_pump` thread flushes it to disk every `STATE_FLUSH_INTERVAL` so the UI sees live progress. When the server lacks `Accept-Ranges` or the file is below the minimum, it falls back to a single-stream download.
- **Filename derivation** — at HEAD time, if the URL-derived name looks like query-string garbage (`looks_like_query_garbage` heuristic) the worker uses `download-{ts}.bin`. The HEAD response's `Content-Disposition` header is parsed (RFC 5987 `filename*=UTF-8''`, quoted `filename=""`, bare `filename=`) and renames before the file is opened.
- **Cookies + User-Agent** are forwarded from `chrome.cookies.getAll()` so logged-in downloads work the same way the browser would.

### Naming mask tokens

`dl.add` accepts a `mask` template. Tokens are substituted in `apply_naming_mask` before the filename is sanitized:

| Token        | Substitution                                                       |
| ------------ | ------------------------------------------------------------------ |
| `*name*`     | Basename without extension                                         |
| `*ext*`      | Extension without dot (empty if none)                              |
| `*host*`     | URL hostname                                                       |
| `*url*`      | URL path (slashes kept)                                            |
| `*flat*`     | URL path with `/` → `_`                                            |
| `*subdirs*`  | URL path's parent dirs (no trailing slash)                         |
| `*date*`     | `YYYY-MM-DD` (UTC)                                                 |
| `*time*`     | `HHMMSS` (UTC)                                                     |
| `*size*`     | `?` placeholder (size unknown at name time)                        |

Unknown tokens are left literal so the user can spot typos. Empty mask = filename verbatim.

## Install

```sh
cargo install zpwrchrome-host
```

That installs `zpwrchrome-host` into `$CARGO_HOME/bin`. Then register the NM manifest for the calling extension's ID:

```sh
# 1. Find your extension's ID at chrome://extensions (Developer mode)
# 2. Register the host for that ID:
zpwrchrome-host --install <ext-id>
```

The installer writes `com.menketechnologies.zpwrchrome.json` into every detected Chromium-family browser config dir on macOS / Linux (Chrome / Chromium / Brave / Edge / Arc / Vivaldi). `allowed_origins` is set to `chrome-extension://<ext-id>/` so only the calling extension can spawn the host. Reload the extension after running it.

### Use with upstream browserpass-extension

This binary also implements every action documented in browserpass-native's PROTOCOL.md v3.1.2 (see the table above), so it works as a drop-in replacement for the Go `browserpass-native` binary. Register it under the upstream NM name (`com.github.browserpass.native`) by passing the public browserpass-extension IDs to `--install`:

```sh
# Chrome Web Store + AMO + Edge Add-ons IDs for browserpass-extension:
zpwrchrome-host --install naepdomgkenhinolocfifgehidddafch klbgkfammgfekonebpdghoofedpomgjj
```

If the upstream `browserpass-native` package is already installed (apt / brew / nix etc.), uninstall it first — both binaries register under the same NM name and the last one to write the manifest wins.

### Upgrade

`cargo install zpwrchrome-host --force` — the NM manifest already points at `$CARGO_HOME/bin/zpwrchrome-host` so no re-install is needed.

## Architecture

```
zpwrchrome-host/src/
├── lib.rs                       # pub mod ported + extensions + frame + diag
├── frame.rs                     # NM length-prefixed JSON framing
│                                # Chrome cap: 64 MiB outbound (ext → host),
│                                # 1 MiB inbound (host → ext).
├── diag.rs                      # ~/.cache/zpwrchrome/host.log — START, RECV,
│                                # ACTION, DISPATCH, SEND, EXIT, panic hook.
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
│   ├── dl.rs                    # file-state segmented downloader, worker process,
│   │                            # dl.add/list/pause/resume/cancel/remove/clear,
│   │                            # dl.openDir/openFile, dl.writeFile/writeFileChunk,
│   │                            # apply_naming_mask, probe_headers,
│   │                            # parse_content_disposition_filename, expand_home,
│   │                            # looks_like_query_garbage, percent_decode.
│   ├── otp.rs                   # shells pass otp
│   └── search.rs                # host-side fuzzy + substring scoring
└── bin/
    └── zpwrchrome_host.rs   # port of main.go + extension dispatch hook
                                 # + --install <ext-id> NM manifest writer
                                 # + --dl-worker <gid> detached worker entry
```

## Testing

```sh
cargo test
```

**121 tests, 0 failures** across:

- Pure protocol pins (`tests/ported_version.rs`, `tests/ported_errors.rs`)
- Pure helpers (`tests/ported_helpers.rs`, `tests/ported_common.rs`, `tests/ported_configure_helpers.rs`)
- End-to-end with spawned binary (`tests/ported_integration.rs`) — echo round-trip, every error code path, configure/list/tree/delete against tempdir stores
- Frame round-trip (`tests/frame_roundtrip.rs`)
- Live pass store (`tests/live_password_store.rs`) — gated on `~/.password-store/.gpg-id` presence; verifies byte-equal `pass show` round-trip
- Extensions: `extensions_otp.rs`, `extensions_search.rs`, `extensions_run_command.rs`, `extensions_dl_state.rs`, `extensions_dl_integration.rs` (78 cases: 2 MiB segmented download against a local HTTP server with Range support, dl.clear scopes, dl.remove cancel-and-delete, dl.writeFile + writeFileChunk streaming protocol, naming-mask token substitution, probe_headers HEAD-then-Range-GET fallback, spawn_worker setsid + close-fd, dl.resume worker-pid liveness check, expand_home tilde resolution).

All green on push/PR via GitHub Actions on `ubuntu-latest` — the repo `.github/workflows/ci.yml` runs `cargo test --locked` for this crate on the Node 22 matrix leg, alongside the extension's `npm test`.

## License

MIT. See [LICENSE](LICENSE).

## Credits

- Upstream Go reference: [browserpass/browserpass-native](https://github.com/browserpass/browserpass-native) by Maxim Baz + contributors
- Protocol spec: [browserpass-native/PROTOCOL.md](https://github.com/browserpass/browserpass-native/blob/master/PROTOCOL.md)
- This Rust port + extensions: [MenkeTechnologies](https://github.com/MenkeTechnologies)
