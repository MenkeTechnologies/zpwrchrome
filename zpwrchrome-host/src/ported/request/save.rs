//! Port of `request/save.go` from upstream `browserpass-native`.
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![allow(unused_assignments)] // See fetch.rs — same `var gpgPath string` shape.

use crate::ported::errors;
use crate::ported::helpers;
use crate::ported::request::common::normalizePasswordStorePath;
use crate::ported::request::process::request;
use crate::ported::response;

/// Port of `saveEncryptedContents()` from `request/save.go:13`.
pub fn saveEncryptedContents(request: &request) {
    let responseData = response::MakeSaveResponse(); // go:14

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
                (errors::field::ACTION, "save"),
                (errors::field::FILE, &request.File),
            ])),
        );
    }

    if request.Contents.is_empty() {
        // go:28
        eprintln!("The entry contents is missing"); // go:29
        response::SendErrorAndExit(
            // go:30-36
            errors::Code::EmptyContents,
            Some(response::params_of(&[
                (errors::field::MESSAGE, "The entry contents is missing"),
                (errors::field::ACTION, "save"),
            ])),
        );
    }

    let store = match request.Settings.Stores.get(&request.StoreID) {
        // go:39
        Some(s) => s.clone(),
        None => {
            // go:40-52
            eprintln!(
                "The password store with ID '{}' is not present in the list of stores '{:?}'",
                request.StoreID, request.Settings.Stores
            );
            response::SendErrorAndExit(
                // go:45-52
                errors::Code::InvalidPasswordStore,
                Some(response::params_of(&[
                    (
                        errors::field::MESSAGE,
                        "The password store is not present in the list of stores",
                    ),
                    (errors::field::ACTION, "save"),
                    (errors::field::STORE_ID, &request.StoreID),
                ])),
            );
        }
    };

    let normalizedStorePath = match normalizePasswordStorePath(&store.Path) {
        // go:55
        Ok(p) => p,
        Err(e) => {
            // go:56-70
            eprintln!(
                "The password store '{:?}' is not accessible at its location: {}",
                store, e
            );
            response::SendErrorAndExit(
                // go:61-70
                errors::Code::InaccessiblePasswordStore,
                Some(response::params_of(&[
                    (
                        errors::field::MESSAGE,
                        "The password store is not accessible",
                    ),
                    (errors::field::ACTION, "save"),
                    (errors::field::ERROR, &e),
                    (errors::field::STORE_ID, &store.ID),
                    (errors::field::STORE_NAME, &store.Name),
                    (errors::field::STORE_PATH, &store.Path),
                ])),
            );
        }
    };
    let mut store = store;
    store.Path = normalizedStorePath.to_string_lossy().into_owned(); // go:73

    let mut gpgPath: String = String::new(); // go:75 var gpgPath string
    if !request.Settings.GpgPath.is_empty() || !store.Settings.GpgPath.is_empty() {
        // go:76
        if !request.Settings.GpgPath.is_empty() {
            // go:77
            gpgPath = request.Settings.GpgPath.clone(); // go:78
        } else {
            // go:79
            gpgPath = store.Settings.GpgPath.clone(); // go:80
        }
        if let Err(e) = helpers::ValidateGpgBinary(&gpgPath) {
            // go:82
            eprintln!("The provided gpg binary path '{gpgPath}' is invalid: {e}"); // go:83-86
            response::SendErrorAndExit(
                // go:87-95
                errors::Code::InvalidGpgPath,
                Some(response::params_of(&[
                    (
                        errors::field::MESSAGE,
                        "The provided gpg binary path is invalid",
                    ),
                    (errors::field::ACTION, "save"),
                    (errors::field::ERROR, &e),
                    (errors::field::GPG_PATH, &gpgPath),
                ])),
            );
        }
    } else {
        // go:98
        match helpers::DetectGpgBinary() {
            // go:99
            Ok(p) => gpgPath = p,
            Err(e) => {
                // go:100-108
                eprintln!("Unable to detect the location of the gpg binary: {e}"); // go:101
                response::SendErrorAndExit(
                    // go:102-108
                    errors::Code::UnableToDetectGpgPath,
                    Some(response::params_of(&[
                        (
                            errors::field::MESSAGE,
                            "Unable to detect the location of the gpg binary",
                        ),
                        (errors::field::ACTION, "save"),
                        (errors::field::ERROR, &e),
                    ])),
                );
            }
        }
    }

    let filePath = normalizedStorePath.join(&request.File); // go:112 filepath.Join(store.Path, request.File)

    let recipients = match helpers::DetectGpgRecipients(&filePath) {
        // go:114
        Ok(r) => r,
        Err(e) => {
            // go:115-129
            eprintln!("Unable to determine recipients for the gpg encryption: {e}"); // go:116
            response::SendErrorAndExit(
                // go:117-129
                errors::Code::UnableToDetermineGpgRecipients,
                Some(response::params_of(&[
                    (
                        errors::field::MESSAGE,
                        "Unable to determine recipients for the gpg encryption",
                    ),
                    (errors::field::ACTION, "save"),
                    (errors::field::ERROR, &e),
                    (errors::field::FILE, &request.File),
                    (errors::field::STORE_ID, &store.ID),
                    (errors::field::STORE_NAME, &store.Name),
                    (errors::field::STORE_PATH, &store.Path),
                ])),
            );
        }
    };

    if let Err(e) = helpers::GpgEncryptFile(&filePath, &request.Contents, &recipients, &gpgPath) {
        // go:132
        eprintln!(
            "Unable to encrypt the password file '{}' in the password store '{:?}': {}",
            request.File, store, e
        );
        response::SendErrorAndExit(
            // go:137-149
            errors::Code::UnableToEncryptPasswordFile,
            Some(response::params_of(&[
                (
                    errors::field::MESSAGE,
                    "Unable to encrypt the password file",
                ),
                (errors::field::ACTION, "save"),
                (errors::field::ERROR, &e),
                (errors::field::FILE, &request.File),
                (errors::field::STORE_ID, &store.ID),
                (errors::field::STORE_NAME, &store.Name),
                (errors::field::STORE_PATH, &store.Path),
            ])),
        );
    }

    response::SendOk(responseData); // go:153
}

#[allow(non_snake_case)]
const _: () = ();
