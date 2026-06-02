//! Port of `request/process.go` from upstream `browserpass-native`.
//!
//! 1:1 Rust port. Includes the StoreSettings/store/settings/request types
//! Go declares here, the Process entrypoint, and the two parsers
//! parseRequestLength + parseRequest.
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]

use crate::ported::errors;
use crate::ported::request::configure;
use crate::ported::request::delete as delete_mod;
use crate::ported::request::fetch;
use crate::ported::request::list;
use crate::ported::request::save;
use crate::ported::request::tree;
use crate::ported::response;
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::io::{self, Read};

#[derive(Deserialize, Debug, Default, Clone)]
#[serde(default)]
pub struct StoreSettings {                                                      // go:12
    #[serde(rename = "gpgPath")]
    pub GpgPath: String,                                                        // go:13
}

#[derive(Deserialize, Debug, Default, Clone)]
#[serde(default)]
pub struct store {                                                              // go:16
    #[serde(rename = "id")]
    pub ID:       String,                                                       // go:17
    #[serde(rename = "name")]
    pub Name:     String,                                                       // go:18
    #[serde(rename = "path")]
    pub Path:     String,                                                       // go:19
    #[serde(rename = "settings")]
    #[serde(default)]
    pub Settings: StoreSettings,                                                // go:20
}

#[derive(Deserialize, Debug, Default, Clone)]
#[serde(default)]
pub struct settings {                                                           // go:23
    #[serde(rename = "gpgPath")]
    pub GpgPath: String,                                                        // go:24
    #[serde(rename = "stores")]
    pub Stores:  BTreeMap<String, store>,                                       // go:25
}

#[derive(Deserialize, Debug, Default)]
#[serde(default)]
pub struct request {                                                            // go:28
    #[serde(rename = "action")]
    pub Action:       String,                                                   // go:29
    #[serde(rename = "settings")]
    pub Settings:     settings,                                                 // go:30
    #[serde(rename = "file")]
    pub File:         String,                                                   // go:31
    #[serde(rename = "contents")]
    pub Contents:     String,                                                   // go:32
    #[serde(rename = "storeId")]
    pub StoreID:      String,                                                   // go:33
    #[serde(rename = "echoResponse")]
    pub EchoResponse: Option<Value>,                                            // go:34
}

/// Port of `Process()` from `request/process.go:38`.
///
// Process handles browser request                                              // go:37
pub fn Process() {
    let requestLength = match parseRequestLength(io::stdin().lock()) {           // go:39 parseRequestLength(os.Stdin)
        Ok(n) => n,
        Err(e) => {                                                              // go:40-49
            eprintln!("Unable to parse the length of the browser request: {e}"); // go:41
            response::SendErrorAndExit(                                          // go:42-49
                errors::Code::ParseRequestLength,
                Some(response::params_of(&[
                    (errors::field::MESSAGE, "Unable to parse the length of the browser request"),
                    (errors::field::ERROR,   &e.to_string()),
                ])),
            );
        }
    };

    let request = match parseRequest(requestLength, io::stdin().lock()) {        // go:52 parseRequest(requestLength, os.Stdin)
        Ok(r) => r,
        Err(e) => {                                                              // go:53-62
            eprintln!("Unable to parse the browser request: {e}");               // go:54
            response::SendErrorAndExit(                                          // go:55-62
                errors::Code::ParseRequest,
                Some(response::params_of(&[
                    (errors::field::MESSAGE, "Unable to parse the browser request"),
                    (errors::field::ERROR,   &e.to_string()),
                ])),
            );
        }
    };

    // Construct a long-lived borrow for the common-path validators.            // (rust)
    let req = &request;
    match req.Action.as_str() {                                                  // go:65 switch request.Action
        "configure" => configure::configure(req),                                // go:67
        "list"      => list::listFiles(req),                                     // go:69
        "tree"      => tree::listDirectories(req),                               // go:71
        "fetch"     => fetch::fetchDecryptedContents(req),                       // go:73
        "save"      => save::saveEncryptedContents(req),                         // go:75
        "delete"    => delete_mod::deleteFile(req),                              // go:77
        "echo"      => {                                                          // go:79
            response::SendRaw(&req.EchoResponse.clone().unwrap_or(Value::Null)); // go:80
        }
        other => {                                                                // go:81-89
            eprintln!("Received a browser request with an unknown action: {other}"); // go:82
            response::SendErrorAndExit(                                          // go:83-89
                errors::Code::InvalidRequestAction,
                Some(response::params_of(&[
                    (errors::field::MESSAGE, "Invalid request action"),
                    (errors::field::ACTION,  other),
                ])),
            );
        }
    }
}

/// Port of `parseRequestLength()` from `request/process.go:94`.
///
// Request length is the first 4 bytes in LittleEndian encoding                // go:93
pub fn parseRequestLength<R: Read>(mut input: R) -> Result<u32, io::Error> {
    let mut length = [0u8; 4];                                                  // go:95 var length uint32
    input.read_exact(&mut length)?;                                              // go:96 binary.Read(input, binary.LittleEndian, &length)
    Ok(u32::from_le_bytes(length))                                               // go:99
}

/// Port of `parseRequest()` from `request/process.go:103`.
///
// Request is a json with a predefined structure                                // go:102
pub fn parseRequest<R: Read>(messageLength: u32, input: R) -> Result<request, String> {
    let reader = input.take(messageLength as u64);                              // go:105 io.LimitedReader{R: input, N: int64(messageLength)}
    serde_json::from_reader(reader)                                              // go:106 json.NewDecoder(reader).Decode(&parsed)
        .map_err(|e| format!("{e}"))
}

#[allow(non_snake_case)]
#[allow(non_camel_case_types)]
const _: () = ();
