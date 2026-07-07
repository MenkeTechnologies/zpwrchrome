//! `search` extension action — whole-store fuzzy search across every
//! configured store's `.gpg` entries. Not in upstream browserpass-native
//! (which does search client-side after a `list` round-trip). We add a host
//! action so large stores don't pay the cost of round-tripping every entry
//! path on each keystroke.
//!
//! Wire shape:
//! ```text
//!   request:  {"action":"search", "settings":{...}, "echoResponse":"<query>"}
//!             (We piggyback on `echoResponse` to carry the query string so
//!             the ported request struct stays unmodified.)
//!   response: ok { "matches": [ {"store":"<id>","path":"<rel>"}, ... ] }
//! ```
//!
//! Scoring: substring matches outrank subsequence matches. Pure function so
//! tests can exercise it without spawning the binary.
#![allow(non_snake_case)]

use crate::ported::errors::{self, field};
use crate::ported::request::common::normalizePasswordStorePath;
use crate::ported::request::process::request;
use crate::ported::response;
use serde::Serialize;
use serde_json::Value;
use std::ffi::OsStr;
use std::fs;
use std::path::Path;

#[derive(Serialize, Debug, Default)]
pub struct SearchMatch {
    #[serde(rename = "store")]
    pub Store: String,
    #[serde(rename = "path")]
    pub Path: String,
}

#[derive(Serialize, Debug, Default)]
pub struct SearchResponse {
    #[serde(rename = "matches")]
    pub Matches: Vec<SearchMatch>,
}

/// Run the `search` action handler against `request`.
pub fn search(request: &request) {
    let query: String = match &request.EchoResponse {
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => String::new(),
    };

    let mut results: Vec<SearchMatch> = Vec::new();
    for (_id, store) in request.Settings.Stores.iter() {
        let normalized = match normalizePasswordStorePath(&store.Path) {
            Ok(p) => p,
            Err(e) => {
                response::SendErrorAndExit(
                    errors::Code::InaccessiblePasswordStore,
                    Some(response::params_of(&[
                        (field::MESSAGE, "The password store is not accessible"),
                        (field::ACTION, "search"),
                        (field::ERROR, &e),
                        (field::STORE_ID, &store.ID),
                        (field::STORE_NAME, &store.Name),
                        (field::STORE_PATH, &store.Path),
                    ])),
                );
            }
        };

        let mut entries: Vec<String> = Vec::new();
        if let Err(e) = collect_gpg(&normalized, &normalized, &mut entries) {
            response::SendErrorAndExit(
                errors::Code::UnableToListFilesInPasswordStore,
                Some(response::params_of(&[
                    (
                        field::MESSAGE,
                        "Unable to list the files in the password store",
                    ),
                    (field::ACTION, "search"),
                    (field::ERROR, &e),
                    (field::STORE_ID, &store.ID),
                    (field::STORE_NAME, &store.Name),
                    (field::STORE_PATH, &store.Path),
                ])),
            );
        }

        for path in search_in(&entries, &query) {
            results.push(SearchMatch {
                Store: store.ID.clone(),
                Path: path,
            });
        }
    }

    response::SendOk(SearchResponse { Matches: results });
}

/// Pure scorer — exposed for unit tests.
pub fn search_in(entries: &[String], query: &str) -> Vec<String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        let mut out = entries.to_vec();
        out.sort();
        return out;
    }
    let mut scored: Vec<(i64, &String)> = Vec::new();
    for entry in entries {
        let lower = entry.to_lowercase();
        if let Some(pos) = lower.find(&q) {
            scored.push((-(1_000_000 - pos as i64), entry));
            continue;
        }
        if let Some(score) = subseq_score(&lower, &q) {
            scored.push((-score, entry));
        }
    }
    scored.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(b.1)));
    scored.into_iter().map(|(_, s)| s.clone()).collect()
}

fn subseq_score(haystack: &str, needle: &str) -> Option<i64> {
    let mut hi = haystack.chars();
    let mut last_pos: i64 = -1;
    let mut score: i64 = 0;
    for nc in needle.chars() {
        let nlc = nc.to_ascii_lowercase();
        let mut pos = -1i64;
        for (i, hc) in hi.by_ref().enumerate() {
            if hc.to_ascii_lowercase() == nlc {
                pos = last_pos + 1 + i as i64;
                break;
            }
        }
        if pos < 0 {
            return None;
        }
        let gap = if last_pos < 0 { 0 } else { pos - last_pos - 1 };
        score -= gap * 2;
        score += 10;
        last_pos = pos;
    }
    Some(score)
}

fn collect_gpg(root: &Path, dir: &Path, out: &mut Vec<String>) -> Result<(), String> {
    let rd = fs::read_dir(dir).map_err(|e| format!("{e}"))?;
    for entry in rd {
        let entry = entry.map_err(|e| format!("{e}"))?;
        let path = entry.path();
        let ft = entry.file_type().map_err(|e| format!("{e}"))?;
        if ft.is_dir() {
            if path.file_name() == Some(OsStr::new(".git")) {
                continue;
            }
            collect_gpg(root, &path, out)?;
        } else if ft.is_file() && path.extension().and_then(|s| s.to_str()) == Some("gpg") {
            let rel = path
                .strip_prefix(root)
                .map_err(|e| format!("{e}"))?
                .with_extension("")
                .to_string_lossy()
                .into_owned();
            out.push(rel);
        }
    }
    Ok(())
}

#[allow(non_snake_case)]
const _: () = ();
