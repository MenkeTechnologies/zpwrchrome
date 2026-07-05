//! `host.crawl` / `host.exec` — filesystem crawl and command execution backed
//! by the shared `zwire-host` capability library (crate `zwire_host`).
//!
//! Rather than re-implement a recursive walk or a capture-stdout exec here, we
//! reuse `zwire_host::api`, which is the same code path the `zwire-host` daemon
//! runs. We depend on it with `default-features = false`, so only the light
//! filesystem/exec half is pulled in — no `portable-pty` / `sysinfo`.
//!
//! Wire shapes:
//! ```text
//!   {"action":"host.crawl","path":"~/src","ext":"rs"}
//!     -> ok { "count": N, "entries": [ {path,name,dir,size}, … ] }
//!   {"action":"host.exec","program":"git","args":["status","--porcelain"]}
//!     -> ok { "code": 0, "stdout": "…", "stderr": "…" }
//! ```
#![allow(non_snake_case)]

use crate::ported::errors::{self, field};
use crate::ported::response;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize, Default)]
struct CrawlRequest {
    #[serde(default)]
    path: String,
    #[serde(default)]
    ext: Option<String>,
}

#[derive(Serialize)]
struct CrawlEntry {
    path: String,
    name: String,
    dir: bool,
    size: u64,
}

#[derive(Serialize)]
struct CrawlResponse {
    count: usize,
    entries: Vec<CrawlEntry>,
}

/// `host.crawl` — recursively list a directory tree via `zwire_host::api::walk`.
pub fn crawl(value: &Value) {
    let req: CrawlRequest = serde_json::from_value(value.clone()).unwrap_or_default();
    if req.path.is_empty() {
        response::SendErrorAndExit(
            errors::Code::InvalidRequestAction,
            Some(response::params_of(&[
                (field::MESSAGE, "host.crawl: path is empty"),
                (field::ACTION, "host.crawl"),
            ])),
        );
    }
    let entries: Vec<CrawlEntry> = zwire_host::api::walk(&req.path, req.ext.as_deref())
        .into_iter()
        .map(|e| CrawlEntry {
            path: e.path.to_string_lossy().into_owned(),
            name: e.name,
            dir: e.dir,
            size: e.size,
        })
        .collect();
    response::SendOk(CrawlResponse {
        count: entries.len(),
        entries,
    });
}

#[derive(Deserialize, Default)]
struct ExecRequest {
    #[serde(default)]
    program: String,
    #[serde(default)]
    args: Vec<String>,
}

#[derive(Serialize)]
struct ExecResponse {
    code: Option<i64>,
    stdout: String,
    stderr: String,
}

/// `host.exec` — run a program to completion via `zwire_host::api::exec`.
pub fn exec(value: &Value) {
    let req: ExecRequest = serde_json::from_value(value.clone()).unwrap_or_default();
    if req.program.is_empty() {
        response::SendErrorAndExit(
            errors::Code::InvalidRequestAction,
            Some(response::params_of(&[
                (field::MESSAGE, "host.exec: program is empty"),
                (field::ACTION, "host.exec"),
            ])),
        );
    }
    match zwire_host::api::exec(&req.program, &req.args) {
        Ok(out) => response::SendOk(ExecResponse {
            code: out.code,
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        }),
        Err(e) => response::SendErrorAndExit(
            errors::Code::InvalidRequestAction,
            Some(response::params_of(&[
                (field::MESSAGE, "host.exec: failed"),
                (field::ACTION, "host.exec"),
                (field::ERROR, &e),
            ])),
        ),
    }
}
