//! Port of `errors/errors.go` from upstream `browserpass-native`.
//!
//! 1:1 Rust port. The numeric error codes are wire-compatible with
//! browserpass-extension and MUST NOT be renumbered (per upstream comment
//! "DO NOT MODIFY THE VALUES, always append new error codes to the bottom").
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]

use std::process;

// Code exit code                                                            // go:8
#[repr(i32)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Code {
    // Error codes that are sent to the browser extension and used as exit  // go:11
    // codes in the app.                                                    // go:12
    // DO NOT MODIFY THE VALUES, always append new error codes to the bottom // go:13
    ParseRequestLength = 10,                                    // go:15
    ParseRequest = 11,                                          // go:16
    InvalidRequestAction = 12,                                  // go:17
    InaccessiblePasswordStore = 13,                             // go:18
    InaccessibleDefaultPasswordStore = 14,                      // go:19
    UnknownDefaultPasswordStoreLocation = 15,                   // go:20
    UnreadablePasswordStoreDefaultSettings = 16,                // go:21
    UnreadableDefaultPasswordStoreDefaultSettings = 17,         // go:22
    UnableToListFilesInPasswordStore = 18,                      // go:23
    UnableToDetermineRelativeFilePathInPasswordStore = 19,      // go:24
    InvalidPasswordStore = 20,                                  // go:25
    InvalidGpgPath = 21,                                        // go:26
    UnableToDetectGpgPath = 22,                                 // go:27
    InvalidPasswordFileExtension = 23,                          // go:28
    UnableToDecryptPasswordFile = 24,                           // go:29
    UnableToListDirectoriesInPasswordStore = 25,                // go:30
    UnableToDetermineRelativeDirectoryPathInPasswordStore = 26, // go:31
    EmptyContents = 27,                                         // go:32
    UnableToDetermineGpgRecipients = 28,                        // go:33
    UnableToEncryptPasswordFile = 29,                           // go:34
    UnableToDeletePasswordFile = 30,                            // go:35
    UnableToDetermineIsDirectoryEmpty = 31,                     // go:36
    UnableToDeleteEmptyDirectory = 32,                          // go:37
}

impl Code {
    pub fn as_i32(self) -> i32 {
        self as i32
    }
}

// Field extra field in the error response params                            // go:41
//
// Rust port: Go uses `type Field string` + named constants so the value is
// the JSON key on the wire (e.g. `"message"`, `"action"`). Mirror with
// `pub const … : &str = …;` so call sites use `field::MESSAGE` the way Go
// uses `errors.FieldMessage`.
pub mod field {
    // Extra fields that can be sent to the browser extension as part of an   // go:44
    // error response. FieldMessage is always present, others are optional.   // go:45
    pub const MESSAGE: &str = "message"; // go:47
    pub const ACTION: &str = "action"; // go:48
    pub const ERROR: &str = "error"; // go:49
    pub const STORE_ID: &str = "storeId"; // go:50
    pub const STORE_NAME: &str = "storeName"; // go:51
    pub const STORE_PATH: &str = "storePath"; // go:52
    pub const FILE: &str = "file"; // go:53
    pub const DIRECTORY: &str = "directory"; // go:54
    pub const GPG_PATH: &str = "gpgPath"; // go:55
}

/// Port of `ExitWithCode()` from `errors/errors.go:59`.
///
// ExitWithCode exit with error code                                         // go:58
pub fn exit_with_code(code: Code) {
    process::exit(code as i32); // go:60
}
