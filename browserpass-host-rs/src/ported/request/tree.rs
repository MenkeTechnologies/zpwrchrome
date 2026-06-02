//! Port of `request/tree.go` from upstream `browserpass-native`.
//!
//! 1:1 Rust port. Go uses `fastwalk.FastWalk` + an inline callback to
//! collect every directory under each store (skipping `.git`). The Rust
//! port walks with `std::fs::read_dir` inline inside `listDirectories`
//! (no separate helper fn).
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]

use crate::ported::errors;
use crate::ported::request::common::normalizePasswordStorePath;
use crate::ported::request::process::request;
use crate::ported::response;
use std::ffi::OsStr;
use std::fs;

/// Port of `listDirectories()` from `request/tree.go:18`.
pub fn listDirectories(request: &request) {
    let mut responseData = response::MakeTreeResponse();                        // go:19

    for store in request.Settings.Stores.values() {                             // go:21
        let mut store = store.clone();
        let normalizedStorePath = match normalizePasswordStorePath(&store.Path) { // go:22
            Ok(p) => p,
            Err(e) => {                                                         // go:23-37
                eprintln!(
                    "The password store '{:?}' is not accessible at its location: {}",
                    store, e
                );
                response::SendErrorAndExit(                                     // go:28-37
                    errors::Code::InaccessiblePasswordStore,
                    Some(response::params_of(&[
                        (errors::field::MESSAGE,    "The password store is not accessible"),
                        (errors::field::ACTION,     "tree"),
                        (errors::field::ERROR,      &e),
                        (errors::field::STORE_ID,   &store.ID),
                        (errors::field::STORE_NAME, &store.Name),
                        (errors::field::STORE_PATH, &store.Path),
                    ])),
                );
            }
        };

        store.Path = normalizedStorePath.to_string_lossy().into_owned();        // go:40

        // var mu sync.Mutex                                                    // go:42
        // directories := []string{}                                            // go:43
        let mut directories: Vec<String> = Vec::new();                          // go:43
        if let Err(e) = collect_dirs(&normalizedStorePath, &normalizedStorePath, &mut directories) {
            // err = fastwalk.FastWalk(...) failure                             // go:60
            eprintln!(
                "Unable to list the directory tree in the password store '{:?}' at its location: {}",
                store, e
            );
            response::SendErrorAndExit(                                         // go:62-76
                errors::Code::UnableToListDirectoriesInPasswordStore,
                Some(response::params_of(&[
                    (errors::field::MESSAGE,    "Unable to list the directory tree in the password store"),
                    (errors::field::ACTION,     "tree"),
                    (errors::field::ERROR,      &e),
                    (errors::field::STORE_ID,   &store.ID),
                    (errors::field::STORE_NAME, &store.Name),
                    (errors::field::STORE_PATH, &store.Path),
                ])),
            );
        }

        for directory in directories.iter_mut() {                               // go:79 for i, directory := range directories
            *directory = directory.replace('\\', "/");                          // go:98 strings.Replace(..., "\\", "/", -1)
        }

        directories.sort();                                                      // go:102 sort.Strings(directories)
        responseData.Directories.insert(store.ID.clone(), directories);          // go:103
    }

    response::SendOk(responseData);                                             // go:106
}

// Inlined std::fs walker — analog of Go's `fastwalk.FastWalk` closure.        // (rust)
// Collects every subdirectory of `root`, skipping `.git` (mirrors Go).        // (rust)
fn collect_dirs(root: &std::path::Path, dir: &std::path::Path, out: &mut Vec<String>) -> Result<(), String> {
    let rd = fs::read_dir(dir).map_err(|e| format!("{e}"))?;
    for entry in rd {
        let entry = entry.map_err(|e| format!("{e}"))?;
        let path = entry.path();
        let ft = entry.file_type().map_err(|e| format!("{e}"))?;
        if !ft.is_dir() {
            continue;
        }
        if path.file_name() == Some(OsStr::new(".git")) {                       // go:51 filepath.Base(path) == ".git"
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .map_err(|e| format!("{e}"))?
            .to_string_lossy()
            .into_owned();
        if !rel.is_empty() {
            out.push(rel);
        }
        collect_dirs(root, &path, out)?;
    }
    Ok(())
}

#[allow(non_snake_case)]
const _: () = ();
