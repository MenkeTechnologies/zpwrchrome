//! Port of `request/fetch.go` from upstream `browserpass-native`.
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![allow(unused_assignments)] // Go declares `var gpgPath string` then assigns;
                              // the empty-string init is unused but kept for
                              // port fidelity per PORT.md Rule E.

use crate::ported::errors;
use crate::ported::helpers;
use crate::ported::request::common::normalizePasswordStorePath;
use crate::ported::request::process::request;
use crate::ported::response;

/// Port of `fetchDecryptedContents()` from `request/fetch.go:13`.
pub fn fetchDecryptedContents(request: &request) {
    let mut responseData = response::MakeFetchResponse(); // go:14

    if !request.File.ends_with(".gpg") {
        // go:16 strings.HasSuffix(request.File, ".gpg")
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
                (errors::field::ACTION, "fetch"),
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
                    (errors::field::ACTION, "fetch"),
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
                    (errors::field::ACTION, "fetch"),
                    (errors::field::ERROR, &e),
                    (errors::field::STORE_ID, &store.ID),
                    (errors::field::STORE_NAME, &store.Name),
                    (errors::field::STORE_PATH, &store.Path),
                ])),
            );
        }
    };
    let mut store = store; // go:62 (was immutable above)
    store.Path = normalizedStorePath.to_string_lossy().into_owned(); // go:62

    let mut gpgPath: String = String::new(); // go:64 var gpgPath string
    if !request.Settings.GpgPath.is_empty() || !store.Settings.GpgPath.is_empty() {
        // go:65
        if !request.Settings.GpgPath.is_empty() {
            // go:66
            gpgPath = request.Settings.GpgPath.clone(); // go:67
        } else {
            // go:68
            gpgPath = store.Settings.GpgPath.clone(); // go:69
        }
        if let Err(e) = helpers::ValidateGpgBinary(&gpgPath) {
            // go:71
            eprintln!("The provided gpg binary path '{gpgPath}' is invalid: {e}"); // go:72-75
            response::SendErrorAndExit(
                // go:76-84
                errors::Code::InvalidGpgPath,
                Some(response::params_of(&[
                    (
                        errors::field::MESSAGE,
                        "The provided gpg binary path is invalid",
                    ),
                    (errors::field::ACTION, "fetch"),
                    (errors::field::ERROR, &e),
                    (errors::field::GPG_PATH, &gpgPath),
                ])),
            );
        }
    } else {
        // go:87
        match helpers::DetectGpgBinary() {
            // go:88
            Ok(p) => gpgPath = p,
            Err(e) => {
                // go:89-97
                eprintln!("Unable to detect the location of the gpg binary: {e}"); // go:90
                response::SendErrorAndExit(
                    // go:91-97
                    errors::Code::UnableToDetectGpgPath,
                    Some(response::params_of(&[
                        (
                            errors::field::MESSAGE,
                            "Unable to detect the location of the gpg binary",
                        ),
                        (errors::field::ACTION, "fetch"),
                        (errors::field::ERROR, &e),
                    ])),
                );
            }
        }
    }

    let file_path = normalizedStorePath.join(&request.File); // go:101 filepath.Join(store.Path, request.File)
    match helpers::GpgDecryptFile(&file_path, &gpgPath) {
        // go:101
        Ok(contents) => {
            // go:102
            responseData.Contents = contents;
        }
        Err(e) => {
            // go:102-117
            eprintln!(
                "Unable to decrypt the password file '{}' in the password store '{:?}': {}",
                request.File, store, e
            );
            response::SendErrorAndExit(
                // go:107-117
                errors::Code::UnableToDecryptPasswordFile,
                Some(response::params_of(&[
                    (
                        errors::field::MESSAGE,
                        "Unable to decrypt the password file",
                    ),
                    (errors::field::ACTION, "fetch"),
                    (errors::field::ERROR, &e),
                    (errors::field::FILE, &request.File),
                    (errors::field::STORE_ID, &store.ID),
                    (errors::field::STORE_NAME, &store.Name),
                    (errors::field::STORE_PATH, &store.Path),
                ])),
            );
        }
    }

    response::SendOk(responseData); // go:121
}

#[allow(non_snake_case)]
const _: () = ();
