//! Port of `request/list.go` from upstream `browserpass-native`.
//!
//! 1:1 Rust port. Go uses `zglob.GlobFollowSymlinks` to enumerate `.gpg`
//! files; the Rust port walks the store with `std::fs::read_dir` inline
//! inside `listFiles` (no separate helper fn).
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]

use crate::ported::errors;
use crate::ported::request::common::normalizePasswordStorePath;
use crate::ported::request::process::request;
use crate::ported::response;
use std::ffi::OsStr;
use std::fs;
use std::path::PathBuf;

/// Port of `listFiles()` from `request/list.go:14`.
pub fn listFiles(request: &request) {
    let mut responseData = response::MakeListResponse();                        // go:15

    for store in request.Settings.Stores.values() {                             // go:17
        let mut store = store.clone();
        let normalizedStorePath = match normalizePasswordStorePath(&store.Path) { // go:18
            Ok(p) => p,
            Err(e) => {                                                         // go:19-33
                eprintln!(
                    "The password store '{:?}' is not accessible at its location: {}",
                    store, e
                );
                response::SendErrorAndExit(                                     // go:24-33
                    errors::Code::InaccessiblePasswordStore,
                    Some(response::params_of(&[
                        (errors::field::MESSAGE,    "The password store is not accessible"),
                        (errors::field::ACTION,     "list"),
                        (errors::field::ERROR,      &e),
                        (errors::field::STORE_ID,   &store.ID),
                        (errors::field::STORE_NAME, &store.Name),
                        (errors::field::STORE_PATH, &store.Path),
                    ])),
                );
            }
        };

        store.Path = normalizedStorePath.to_string_lossy().into_owned();        // go:36

        // files, err := zglob.GlobFollowSymlinks(                              // go:38
        //     filepath.Join(store.Path, "/**/*.gpg"))                          // go:38
        //
        // Inlined: walk store recursively and collect every `.gpg` path.       // (rust)
        let mut files: Vec<String> = Vec::new();
        if let Err(e) = collect_gpg(&normalizedStorePath, &normalizedStorePath, &mut files) {
            eprintln!(
                "Unable to list the files in the password store '{:?}' at its location: {}",
                store, e
            );
            response::SendErrorAndExit(                                         // go:40-54
                errors::Code::UnableToListFilesInPasswordStore,
                Some(response::params_of(&[
                    (errors::field::MESSAGE,    "Unable to list the files in the password store"),
                    (errors::field::ACTION,     "list"),
                    (errors::field::ERROR,      &e),
                    (errors::field::STORE_ID,   &store.ID),
                    (errors::field::STORE_NAME, &store.Name),
                    (errors::field::STORE_PATH, &store.Path),
                ])),
            );
        }

        for file in files.iter_mut() {                                          // go:56 for i, file := range files
            // Normalize Windows paths (already forward-slash on Unix; the      // go:73 strings.Replace(relativePath, "\\", "/", -1)
            // inline walker emits forward slashes via path.display).
            *file = file.replace('\\', "/");
        }

        files.sort();                                                            // go:77 sort.Strings(files)
        responseData.Files.insert(store.ID.clone(), files);                      // go:78
    }

    response::SendOk(responseData);                                             // go:81
}

// Inlined std::fs walker — analog of Go's `zglob.GlobFollowSymlinks`.          // (rust)
// Yields entry paths relative to `root`, with forward slashes.                 // (rust)
fn collect_gpg(root: &std::path::Path, dir: &std::path::Path, out: &mut Vec<String>) -> Result<(), String> {
    let rd = fs::read_dir(dir).map_err(|e| format!("{e}"))?;
    for entry in rd {
        let entry = entry.map_err(|e| format!("{e}"))?;
        let path: PathBuf = entry.path();
        let ft = entry.file_type().map_err(|e| format!("{e}"))?;
        if ft.is_dir() {
            // Skip .git — keeps list behavior consistent with tree (Go's       // (rust)
            // zglob would walk into it; our inline walker doesn't).
            if path.file_name() == Some(OsStr::new(".git")) {
                continue;
            }
            collect_gpg(root, &path, out)?;
        } else if ft.is_file() && path.extension().and_then(|s| s.to_str()) == Some("gpg") {
            let rel = path
                .strip_prefix(root)
                .map_err(|e| format!("{e}"))?
                .to_string_lossy()
                .into_owned();
            out.push(rel);
        }
    }
    Ok(())
}

#[allow(non_snake_case)]
const _: () = ();
