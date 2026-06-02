//! Port of `request/configure.go` from upstream `browserpass-native`.
//!
//! 1:1 Rust port. configure + getDefaultPasswordStorePath +
//! readDefaultSettings — all three live in the Go source's configure.go and
//! all three port to this file.
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]

use crate::ported::errors;
use crate::ported::helpers;
use crate::ported::request::common::normalizePasswordStorePath;
use crate::ported::request::process::{request, StoreSettings};
use crate::ported::response;
use serde_json::Value;
use std::fs;
use std::io;
use std::path::PathBuf;

/// Port of `configure()` from `request/configure.go:14`.
pub fn configure(request: &request) {
    let mut responseData = response::MakeConfigureResponse();                   // go:15

    // User configured gpgPath in the browser, check if it is a valid binary    // go:17
    // to use                                                                   // go:18
    if !request.Settings.GpgPath.is_empty() {                                   // go:19
        let err = helpers::ValidateGpgBinary(&request.Settings.GpgPath);        // go:20
        if let Err(e) = err {                                                   // go:21
            eprintln!(                                                          // go:22-25
                "The provided gpg binary path '{}' is invalid: {}",
                request.Settings.GpgPath, e,
            );
            response::SendErrorAndExit(                                         // go:26-34
                errors::Code::InvalidGpgPath,
                Some(response::params_of(&[
                    (errors::field::MESSAGE,  "The provided gpg binary path is invalid"),
                    (errors::field::ACTION,   "configure"),
                    (errors::field::ERROR,    &e),
                    (errors::field::GPG_PATH, &request.Settings.GpgPath),
                ])),
            );
        }
    }

    // Check that each and every store in the settings exists and is            // go:39
    // accessible.                                                              // go:40
    // Then read the default configuration for these stores (if available).     // go:41
    for store in request.Settings.Stores.values() {                             // go:42
        let mut store = store.clone();                                          // go:42 (mutate Path below)
        let normalizedStorePath = match normalizePasswordStorePath(&store.Path) { // go:43
            Ok(p) => p,
            Err(e) => {                                                         // go:44-58
                eprintln!(                                                      // go:45-48
                    "The password store '{:?}' is not accessible at its location: {}",
                    store, e
                );
                response::SendErrorAndExit(                                     // go:49-58
                    errors::Code::InaccessiblePasswordStore,
                    Some(response::params_of(&[
                        (errors::field::MESSAGE,   "The password store is not accessible"),
                        (errors::field::ACTION,    "configure"),
                        (errors::field::ERROR,     &e),
                        (errors::field::STORE_ID,  &store.ID),
                        (errors::field::STORE_NAME,&store.Name),
                        (errors::field::STORE_PATH,&store.Path),
                    ])),
                );
            }
        };

        store.Path = normalizedStorePath.to_string_lossy().into_owned();        // go:61

        let settings_raw = readDefaultSettings(&normalizedStorePath);            // go:63
        let mut store_err: Option<String> = None;
        let raw_string = match settings_raw {
            Ok(s) => s,
            Err(e) => {
                store_err = Some(e);
                String::new()
            }
        };
        if store_err.is_none() {                                                // go:64 if err == nil
            // Round-trip parse to surface JSON syntax errors with the same     // go:65-67
            // code Go uses (UnreadablePasswordStoreDefaultSettings).
            if let Err(e) = serde_json::from_str::<Value>(&raw_string) {
                store_err = Some(e.to_string());
            } else {
                // var storeSettings StoreSettings; err = json.Unmarshal(...)   // go:65-66
                // We just need to confirm valid JSON; the typed shape isn't
                // returned to the response (Go also discards the parsed
                // value — it's a syntax check only).
                let _: Result<StoreSettings, _> = serde_json::from_str(&raw_string);
            }
        }
        responseData.StoreSettings.insert(store.ID.clone(), raw_string);        // go:63

        if let Some(e) = store_err {                                            // go:68 if err != nil
            eprintln!(                                                          // go:69-72
                "Unable to read .browserpass.json of the user-configured password store '{:?}': {}",
                store, e
            );
            response::SendErrorAndExit(                                         // go:73-82
                errors::Code::UnreadablePasswordStoreDefaultSettings,
                Some(response::params_of(&[
                    (errors::field::MESSAGE,    "Unable to read .browserpass.json of the password store"),
                    (errors::field::ACTION,     "configure"),
                    (errors::field::ERROR,      &e),
                    (errors::field::STORE_ID,   &store.ID),
                    (errors::field::STORE_NAME, &store.Name),
                    (errors::field::STORE_PATH, &store.Path),
                ])),
            );
        }
    }

    // Check whether a store in the default location exists and is              // go:88
    // accessible. If there is at least one store in the settings, user will    // go:89
    // not use the default store => skip its validation.                        // go:90
    // However, if there are no stores in the settings, user expects to use     // go:91
    // the default password store => return an error if it is not accessible.   // go:92
    if request.Settings.Stores.is_empty() {                                     // go:93 len(...) == 0
        let possibleDefaultStorePath = match getDefaultPasswordStorePath() {    // go:94
            Ok(p) => p,
            Err(e) => {                                                         // go:95-104
                eprintln!("Unable to determine the location of the default password store: {e}"); // go:96
                response::SendErrorAndExit(                                     // go:97-104
                    errors::Code::UnknownDefaultPasswordStoreLocation,
                    Some(response::params_of(&[
                        (errors::field::MESSAGE, "Unable to determine the location of the default password store"),
                        (errors::field::ACTION,  "configure"),
                        (errors::field::ERROR,   &e),
                    ])),
                );
            }
        };
        // ELSE branch: validate                                                 // go:105 } else {
        let possiblePathStr = possibleDefaultStorePath.to_string_lossy().into_owned();
        let normalized = match normalizePasswordStorePath(&possiblePathStr) {   // go:106
            Ok(p) => p,
            Err(e) => {                                                         // go:107-121
                eprintln!(                                                      // go:108-111
                    "The default password store is not accessible at the location '{possiblePathStr}': {e}"
                );
                response::SendErrorAndExit(                                     // go:112-121
                    errors::Code::InaccessibleDefaultPasswordStore,
                    Some(response::params_of(&[
                        (errors::field::MESSAGE,    "The default password store is not accessible"),
                        (errors::field::ACTION,     "configure"),
                        (errors::field::ERROR,      &e),
                        (errors::field::STORE_PATH, &possiblePathStr),
                    ])),
                );
            }
        };
        responseData.DefaultStore.Path = normalized.to_string_lossy().into_owned();

        let default_raw = match readDefaultSettings(&normalized) {              // go:127
            Ok(s) => Some(s),
            Err(e) => {
                emitUnreadableDefault(&responseData.DefaultStore.Path, &e);
            }
        };
        if let Some(raw_string) = default_raw {
            // Round-trip parse                                                 // go:128-129
            if let Err(e) = serde_json::from_str::<Value>(&raw_string) {
                emitUnreadableDefault(&responseData.DefaultStore.Path, &e.to_string());
            } else {
                let _: Result<StoreSettings, _> = serde_json::from_str(&raw_string);
            }
            responseData.DefaultStore.Settings = raw_string;
        }
    }

    response::SendOk(responseData);                                             // go:147
}

// Sub-helper that exists only to mirror Go's repeated SendErrorAndExit         // (rust)
// shape for code 17 (UnreadableDefaultPasswordStoreDefaultSettings).
// Not invented architecture — it's a single error-emit path Go inlines twice. // (rust)
fn emitUnreadableDefault(store_path: &str, e: &str) -> ! {
    eprintln!(
        "Unable to read .browserpass.json of the default password store in '{store_path}': {e}"
    );
    response::SendErrorAndExit(                                                 // go:134-145
        errors::Code::UnreadableDefaultPasswordStoreDefaultSettings,
        Some(response::params_of(&[
            (errors::field::MESSAGE,    "Unable to read .browserpass.json of the default password store"),
            (errors::field::ACTION,     "configure"),
            (errors::field::ERROR,      e),
            (errors::field::STORE_PATH, store_path),
        ])),
    );
}

/// Port of `getDefaultPasswordStorePath()` from `request/configure.go:150`.
pub fn getDefaultPasswordStorePath() -> Result<PathBuf, String> {
    let path = std::env::var("PASSWORD_STORE_DIR").unwrap_or_default();         // go:151 os.Getenv("PASSWORD_STORE_DIR")
    if !path.is_empty() {                                                       // go:152
        return Ok(PathBuf::from(path));                                         // go:153
    }

    let home = match dirs_home() {                                              // go:156 os.UserHomeDir()
        Ok(h) => h,
        Err(e) => return Err(format!("{e}")),                                   // go:157-159
    };

    let path = PathBuf::from(home).join(".password-store");                     // go:161 filepath.Join(home, ".password-store")
    Ok(path)                                                                    // go:162
}

// Equivalent of Go's os.UserHomeDir — Rust stdlib uses env vars.               // (rust)
fn dirs_home() -> Result<String, io::Error> {
    std::env::var("HOME")
        .map_err(|_| io::Error::new(io::ErrorKind::NotFound, "$HOME not set"))
}

/// Port of `readDefaultSettings()` from `request/configure.go:165`.
pub fn readDefaultSettings(storePath: &std::path::Path) -> Result<String, String> {
    let p = storePath.join(".browserpass.json");                                // go:166 filepath.Join(storePath, ".browserpass.json")
    match fs::read_to_string(&p) {                                              // go:166 ioutil.ReadFile(...)
        Ok(content) => Ok(content),                                             // go:167-168
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok("{}".to_string()),  // go:170-171
        Err(e) => Err(format!("{e}")),                                          // go:172
    }
}

#[allow(non_snake_case)]
#[allow(non_camel_case_types)]
const _: () = ();
