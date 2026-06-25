//! `zcite.save` extension action — receive a CSL-JSON reference extracted from the active
//! web page and drop it into zcite's inbox directory. zcite's `inbox.import` command later
//! drains `<data_dir>/zcite/inbox/*.json` into the user's library.
//!
//! This is the host half of zpwrchrome's "Save to zcite" web connector (the Zotero-Connector
//! role). It deliberately does NOT link the proprietary zcite-core engine: the handoff is a
//! plain CSL-JSON file written to a shared directory, so this MIT host stays fully decoupled
//! from the paid zcite app — the two only share a file format and a well-known path.
//!
//! Wire shape:
//! ```text
//!   request:  { "action": "zcite.save", "item": <CSL-JSON object or array> }
//!   response: ok { "status": "ok", "path": "<inbox>/zpwrchrome-<nanos>.json", "bytes": 123 }
//! ```
#![allow(non_snake_case)]

use crate::ported::errors::{self, field};
use crate::ported::response;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// zcite's inbox directory: `<data_dir>/zcite/inbox`. Computed with the same `dirs` crate
/// zcite-core uses for its profile path, so the two agree on the location without any
/// hand-rolled per-OS path logic.
pub fn inbox_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("zcite").join("inbox")
}

/// Public dispatch entry — mirrors `otp::otp` / `run_command::run_spawn`. SendOk /
/// SendErrorAndExit on its own (both diverge).
pub fn zcite_save(value: &Value) {
    let item = match value.get("item") {
        Some(v) if v.is_object() || v.is_array() => v.clone(),
        _ => response::SendErrorAndExit(
            errors::Code::InvalidRequestAction,
            Some(response::params_of(&[
                (field::MESSAGE, "zcite.save: missing or invalid `item` (expected a CSL-JSON object or array)"),
                (field::ACTION, "zcite.save"),
            ])),
        ),
    };
    match write_inbox(&item, &inbox_dir()) {
        Ok((path, bytes)) => response::SendOk(serde_json::json!({
            "status": "ok",
            "path":   path.to_string_lossy(),
            "bytes":  bytes,
        })),
        Err(e) => response::SendErrorAndExit(
            errors::Code::InvalidRequestAction,
            Some(response::params_of(&[
                (field::MESSAGE, "zcite.save: failed to write inbox file"),
                (field::ACTION, "zcite.save"),
                (field::ERROR, &e),
            ])),
        ),
    }
}

/// Testable core: write `item` as pretty CSL-JSON into `dir`, returning the path + byte
/// count. Creates `dir` if missing; filenames are unique by nanosecond timestamp so two
/// rapid saves never collide.
pub fn write_inbox(item: &Value, dir: &Path) -> Result<(PathBuf, usize), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = dir.join(format!("zpwrchrome-{stamp}.json"));
    let body = serde_json::to_vec_pretty(item).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&path, &body).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok((path, body.len()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn writes_csl_json_to_inbox() {
        let dir = std::env::temp_dir().join(format!("zcite-inbox-ok-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let item = json!([{ "type": "article-journal", "title": "From the Web", "DOI": "10.1/x" }]);
        let (path, bytes) = write_inbox(&item, &dir).unwrap();
        assert!(path.exists());
        assert!(bytes > 0);
        let back: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(back[0]["title"], "From the Web");
        assert_eq!(back[0]["DOI"], "10.1/x");
    }

    #[test]
    fn errors_when_dir_path_is_a_file() {
        // a path whose parent is a regular file → create_dir_all must fail
        let file = std::env::temp_dir().join(format!("zcite-not-a-dir-{}", std::process::id()));
        let _ = std::fs::remove_file(&file);
        std::fs::write(&file, b"x").unwrap();
        let dir = file.join("inbox");
        assert!(write_inbox(&json!({}), &dir).is_err());
    }
}
