//! `otp` extension action — shells out to `pass otp <path>` and returns the
//! current TOTP code. Not part of upstream browserpass-native (v3 dropped
//! OTP); we add it because zpwrchrome's PASS popup needs it.
//!
//! Wire shape:
//! ```text
//!   request:  {"action":"otp", "storeId":"<id>", "file":"path/in/store"}
//!   response: ok { "code": "123456" }    on success
//!             error code 24 (UnableToDecryptPasswordFile) when `pass otp`
//!             fails — matches the semantic of decryption failure.
//! ```
#![allow(non_snake_case)]

use crate::ported::errors::{self, field};
use crate::ported::request::common::normalizePasswordStorePath;
use crate::ported::request::process::request;
use crate::ported::response;
use serde::Serialize;
use std::process::Command;

#[derive(Serialize, Debug, Default)]
pub struct OtpResponse {
    #[serde(rename = "code")]
    pub Code: String,
}

/// Run the `otp` action handler against `request`. Mirrors the dispatcher
/// shape of the ported action handlers — emits its own envelope via
/// `response::SendOk` / `SendErrorAndExit`, never returns on error path.
pub fn otp(request: &request) {
    // `file` is reused (as in `fetch`) to identify the entry.
    if !request.File.ends_with(".gpg") {
        response::SendErrorAndExit(
            errors::Code::InvalidPasswordFileExtension,
            Some(response::params_of(&[
                (
                    field::MESSAGE,
                    "The requested password file does not have the expected '.gpg' extension",
                ),
                (field::ACTION, "otp"),
                (field::FILE, &request.File),
            ])),
        );
    }

    let store = match request.Settings.Stores.get(&request.StoreID) {
        Some(s) => s.clone(),
        None => {
            response::SendErrorAndExit(
                errors::Code::InvalidPasswordStore,
                Some(response::params_of(&[
                    (
                        field::MESSAGE,
                        "The password store is not present in the list of stores",
                    ),
                    (field::ACTION, "otp"),
                    (field::STORE_ID, &request.StoreID),
                ])),
            );
        }
    };

    let normalized = match normalizePasswordStorePath(&store.Path) {
        Ok(p) => p,
        Err(e) => {
            response::SendErrorAndExit(
                errors::Code::InaccessiblePasswordStore,
                Some(response::params_of(&[
                    (field::MESSAGE, "The password store is not accessible"),
                    (field::ACTION, "otp"),
                    (field::ERROR, &e),
                    (field::STORE_ID, &store.ID),
                    (field::STORE_NAME, &store.Name),
                    (field::STORE_PATH, &store.Path),
                ])),
            );
        }
    };

    // The `pass` CLI walks PASSWORD_STORE_DIR itself, so set it for the
    // subprocess to match the requested store. Strip the `.gpg` suffix
    // because `pass otp` takes the entry path without it.
    let entry = request.File.trim_end_matches(".gpg");
    let output = Command::new("pass")
        .env("PASSWORD_STORE_DIR", &normalized)
        .args(["otp", entry])
        .output();
    let output = match output {
        Ok(o) => o,
        Err(e) => {
            response::SendErrorAndExit(
                errors::Code::UnableToDecryptPasswordFile,
                Some(response::params_of(&[
                    (field::MESSAGE, "Unable to spawn `pass otp`"),
                    (field::ACTION, "otp"),
                    (field::ERROR, &e.to_string()),
                    (field::FILE, &request.File),
                    (field::STORE_ID, &store.ID),
                    (field::STORE_NAME, &store.Name),
                    (field::STORE_PATH, &store.Path),
                ])),
            );
        }
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        response::SendErrorAndExit(
            errors::Code::UnableToDecryptPasswordFile,
            Some(response::params_of(&[
                (field::MESSAGE, "`pass otp` failed"),
                (field::ACTION, "otp"),
                (field::ERROR, stderr.trim()),
                (field::FILE, &request.File),
                (field::STORE_ID, &store.ID),
                (field::STORE_NAME, &store.Name),
                (field::STORE_PATH, &store.Path),
            ])),
        );
    }
    let code = String::from_utf8_lossy(&output.stdout).trim().to_string();
    response::SendOk(OtpResponse { Code: code });
}

/// Pure scorer used by tests + the `search` extension. Returns the OTP code
/// extracted from a raw entry body when it contains an `otpauth://` URL.
/// (Reserved for future client-side OTP generation; not used by the action
/// itself, which delegates to `pass otp`.)
pub fn extract_otpauth(body: &str) -> Option<String> {
    body.lines()
        .find(|l| l.starts_with("otpauth://"))
        .map(|s| s.to_string())
}

#[allow(non_snake_case)]
const _: () = ();
