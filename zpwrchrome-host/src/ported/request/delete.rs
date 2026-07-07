//! Port of `request/delete.go` from upstream `browserpass-native`.
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]

use crate::ported::errors;
use crate::ported::helpers;
use crate::ported::request::common::normalizePasswordStorePath;
use crate::ported::request::process::request;
use crate::ported::response;
use std::fs;

/// Port of `deleteFile()` from `request/delete.go:13`.
pub fn deleteFile(request: &request) {
    let responseData = response::MakeDeleteResponse(); // go:14

    if !request.File.ends_with(".gpg") {
        // go:16
        eprintln!(
            "The requested password file '{}' does not have the expected '.gpg' extension",
            request.File
        );
        response::SendErrorAndExit(
            // go:18-25
            errors::Code::InvalidPasswordFileExtension,
            Some(response::params_of(&[
                (
                    errors::field::MESSAGE,
                    "The requested password file does not have the expected '.gpg' extension",
                ),
                (errors::field::ACTION, "delete"),
                (errors::field::FILE, &request.File),
            ])),
        );
    }

    let store = match request.Settings.Stores.get(&request.StoreID) {
        // go:28
        Some(s) => s.clone(),
        None => {
            // go:29-41
            eprintln!(
                "The password store with ID '{}' is not present in the list of stores '{:?}'",
                request.StoreID, request.Settings.Stores
            );
            response::SendErrorAndExit(
                // go:34-41
                errors::Code::InvalidPasswordStore,
                Some(response::params_of(&[
                    (
                        errors::field::MESSAGE,
                        "The password store is not present in the list of stores",
                    ),
                    (errors::field::ACTION, "delete"),
                    (errors::field::STORE_ID, &request.StoreID),
                ])),
            );
        }
    };

    let normalizedStorePath = match normalizePasswordStorePath(&store.Path) {
        // go:44
        Ok(p) => p,
        Err(e) => {
            // go:45-59
            eprintln!(
                "The password store '{:?}' is not accessible at its location: {}",
                store, e
            );
            response::SendErrorAndExit(
                // go:50-59
                errors::Code::InaccessiblePasswordStore,
                Some(response::params_of(&[
                    (
                        errors::field::MESSAGE,
                        "The password store is not accessible",
                    ),
                    (errors::field::ACTION, "delete"),
                    (errors::field::ERROR, &e),
                    (errors::field::STORE_ID, &store.ID),
                    (errors::field::STORE_NAME, &store.Name),
                    (errors::field::STORE_PATH, &store.Path),
                ])),
            );
        }
    };
    let mut store = store;
    store.Path = normalizedStorePath.to_string_lossy().into_owned(); // go:62

    let filePath = normalizedStorePath.join(&request.File); // go:64 filepath.Join(store.Path, request.File)

    if let Err(e) = fs::remove_file(&filePath) {
        // go:66 os.Remove(filePath)
        eprintln!("Unable to delete the password file: {e}"); // go:68
        response::SendErrorAndExit(
            // go:69-81
            errors::Code::UnableToDeletePasswordFile,
            Some(response::params_of(&[
                (errors::field::MESSAGE, "Unable to delete the password file"),
                (errors::field::ACTION, "delete"),
                (errors::field::ERROR, &e.to_string()),
                (errors::field::FILE, &request.File),
                (errors::field::STORE_ID, &store.ID),
                (errors::field::STORE_NAME, &store.Name),
                (errors::field::STORE_PATH, &store.Path),
            ])),
        );
    }

    let mut parentDir = filePath.parent().map(|p| p.to_path_buf()); // go:85 filepath.Dir(filePath)
    loop {
        // go:86 for { ... }
        let dir = match parentDir.clone() {
            Some(d) => d,
            None => break,
        };
        if dir == normalizedStorePath {
            // go:87 if parentDir == store.Path
            break; // go:88
        }

        let isEmpty = match helpers::IsDirectoryEmpty(&dir) {
            // go:91 helpers.IsDirectoryEmpty(parentDir)
            Ok(b) => b,
            Err(e) => {
                // go:92-107
                eprintln!("Unable to determine if directory is empty and can be deleted: {e}"); // go:93
                response::SendErrorAndExit(
                    // go:94-107
                    errors::Code::UnableToDetermineIsDirectoryEmpty,
                    Some(response::params_of(&[
                        (
                            errors::field::MESSAGE,
                            "Unable to determine if directory is empty and can be deleted",
                        ),
                        (errors::field::ACTION, "delete"),
                        (errors::field::ERROR, &e.to_string()),
                        (errors::field::DIRECTORY, &dir.to_string_lossy()),
                        (errors::field::STORE_ID, &store.ID),
                        (errors::field::STORE_NAME, &store.Name),
                        (errors::field::STORE_PATH, &store.Path),
                    ])),
                );
            }
        };

        if !isEmpty {
            // go:111
            break; // go:112
        }

        if let Err(e) = fs::remove_dir(&dir) {
            // go:115 os.Remove(parentDir)
            eprintln!("Unable to delete the empty directory: {e}"); // go:117
            response::SendErrorAndExit(
                // go:118-131
                errors::Code::UnableToDeleteEmptyDirectory,
                Some(response::params_of(&[
                    (
                        errors::field::MESSAGE,
                        "Unable to delete the empty directory",
                    ),
                    (errors::field::ACTION, "delete"),
                    (errors::field::ERROR, &e.to_string()),
                    (errors::field::DIRECTORY, &dir.to_string_lossy()),
                    (errors::field::STORE_ID, &store.ID),
                    (errors::field::STORE_NAME, &store.Name),
                    (errors::field::STORE_PATH, &store.Path),
                ])),
            );
        }

        parentDir = dir.parent().map(|p| p.to_path_buf()); // go:135 filepath.Dir(parentDir)
    }

    response::SendOk(responseData); // go:138
}

#[allow(non_snake_case)]
const _: () = ();
