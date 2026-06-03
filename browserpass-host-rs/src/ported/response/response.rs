//! Port of `response/response.go` from upstream `browserpass-native`.
//!
//! 1:1 Rust port. Envelope shape (status/version/code/data/params) is the
//! wire contract documented in PROTOCOL.md and must round-trip identically
//! to the Go reference.
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]

use crate::ported::errors;
use crate::ported::version;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::io::{self, Write};

// `params` block sent inside an error response. Go's signature is             // go:n/a
// `*map[errors.Field]string`. BTreeMap keeps key order stable for tests       // (rust)
// and matches Go's nil-map → null behavior via `Option`.
pub type Params = BTreeMap<&'static str, String>;

#[derive(Serialize, Debug)]
pub struct okResponse {                                                       // go:12
    #[serde(rename = "status")]
    pub Status:  &'static str,                                                // go:13
    #[serde(rename = "version")]
    pub Version: u64,                                                         // go:14
    #[serde(rename = "data")]
    pub Data:    Value,                                                       // go:15  Data interface{}
}

#[derive(Serialize, Debug)]
pub struct errorResponse {                                                    // go:18
    #[serde(rename = "status")]
    pub Status:  &'static str,                                                // go:19
    #[serde(rename = "code")]
    pub Code:    i32,                                                         // go:20  errors.Code
    #[serde(rename = "version")]
    pub Version: u64,                                                         // go:21
    #[serde(rename = "params")]
    pub Params:  Option<Params>,                                              // go:22  interface{} — nil-able map
}

// ConfigureResponse a response format for the "configure" request            // go:25
#[derive(Serialize, Debug, Default)]
pub struct ConfigureResponse {
    #[serde(rename = "defaultStore")]
    pub DefaultStore: DefaultStoreField,                                      // go:27-30
    #[serde(rename = "storeSettings")]
    pub StoreSettings: BTreeMap<String, String>,                              // go:31
}

#[derive(Serialize, Debug, Default)]
pub struct DefaultStoreField {                                                // go:27 (anonymous in Go)
    #[serde(rename = "path")]
    pub Path:     String,                                                     // go:28
    #[serde(rename = "settings")]
    pub Settings: String,                                                     // go:29
}

/// Port of `MakeConfigureResponse()` from `response/response.go:35`.
///
// MakeConfigureResponse initializes an empty configure response              // go:34
pub fn MakeConfigureResponse() -> ConfigureResponse {
    ConfigureResponse {                                                       // go:36
        DefaultStore: DefaultStoreField::default(),
        StoreSettings: BTreeMap::new(),                                       // go:37  make(map[string]string)
    }
}

// ListResponse a response format for the "list" request                      // go:42
#[derive(Serialize, Debug, Default)]
pub struct ListResponse {
    #[serde(rename = "files")]
    pub Files: BTreeMap<String, Vec<String>>,                                 // go:44
}

/// Port of `MakeListResponse()` from `response/response.go:48`.
///
// MakeListResponse initializes an empty list response                        // go:47
pub fn MakeListResponse() -> ListResponse {
    ListResponse {                                                            // go:49
        Files: BTreeMap::new(),                                               // go:50  make(map[string][]string)
    }
}

// TreeResponse a response format for the "tree" request                      // go:55
#[derive(Serialize, Debug, Default)]
pub struct TreeResponse {
    #[serde(rename = "directories")]
    pub Directories: BTreeMap<String, Vec<String>>,                           // go:57
}

/// Port of `MakeTreeResponse()` from `response/response.go:61`.
///
// MakeTreeResponse initializes an empty tree response                        // go:60
pub fn MakeTreeResponse() -> TreeResponse {
    TreeResponse {                                                            // go:62
        Directories: BTreeMap::new(),                                         // go:63
    }
}

// FetchResponse a response format for the "fetch" request                    // go:68
#[derive(Serialize, Debug, Default)]
pub struct FetchResponse {
    #[serde(rename = "contents")]
    pub Contents: String,                                                     // go:70
}

/// Port of `MakeFetchResponse()` from `response/response.go:74`.
///
// MakeFetchResponse initializes an empty fetch response                      // go:73
pub fn MakeFetchResponse() -> FetchResponse {
    FetchResponse::default()                                                  // go:75 &FetchResponse{}
}

// SaveResponse a response format for the "save" request                      // go:80
#[derive(Serialize, Debug, Default)]
pub struct SaveResponse {}                                                    // go:81

/// Port of `MakeSaveResponse()` from `response/response.go:85`.
///
// MakeSaveResponse initializes an empty save response                        // go:84
pub fn MakeSaveResponse() -> SaveResponse {
    SaveResponse::default()                                                   // go:86
}

// DeleteResponse a response format for the "delete" request                  // go:91
#[derive(Serialize, Debug, Default)]
pub struct DeleteResponse {}                                                  // go:92

/// Port of `MakeDeleteResponse()` from `response/response.go:96`.
///
// MakeDeleteResponse initializes an empty delete response                    // go:95
pub fn MakeDeleteResponse() -> DeleteResponse {
    DeleteResponse::default()                                                 // go:97
}

/// Port of `SendOk()` from `response/response.go:101`.
///
// SendOk sends a success response to the browser extension in the predefined // go:100
// json format                                                                // (cont)
pub fn SendOk<T: Serialize>(data: T) {
    let data_value = serde_json::to_value(&data).unwrap_or(Value::Null);
    let envelope = serde_json::to_value(&okResponse {                         // go:102
        Status:  "ok",                                                        // go:103
        Version: version::CODE,                                               // go:104
        Data:    data_value,                                                  // go:105
    }).unwrap();
    let est = serde_json::to_vec(&envelope).map(|v| v.len()).unwrap_or(0);
    crate::diag::log(&format!("SEND status=ok bytes={est}"));
    SendRaw_value(&envelope);
}

/// Port of `SendErrorAndExit()` from `response/response.go:110`.
///
// SendErrorAndExit sends an error response to the browser extension in the   // go:109
// predefined json format and exits with the specified exit code              // (cont)
pub fn SendErrorAndExit(error_code: errors::Code, params: Option<Params>) -> ! {
    let envelope = serde_json::to_value(&errorResponse {                      // go:111
        Status:  "error",                                                     // go:112
        Code:    error_code.as_i32(),                                         // go:113
        Version: version::CODE,                                               // go:114
        Params:  params,                                                      // go:115
    }).unwrap();
    let summary = serde_json::to_string(&envelope).unwrap_or_default();
    let summary = if summary.len() > 300 { format!("{}…", &summary[..300]) } else { summary };
    crate::diag::log(&format!("SEND status=error code={} envelope={}", error_code.as_i32(), summary));
    SendRaw_value(&envelope);

    crate::diag::log(&format!("EXIT code={} reason=send_error", error_code.as_i32()));
    errors::exit_with_code(error_code);                                       // go:118
    unreachable!()
}

/// Port of `SendRaw()` from `response/response.go:122`.
///
// SendRaw sends a raw data to the browser extension                          // go:121
pub fn SendRaw<T: Serialize>(response: &T) {
    SendRaw_value(&serde_json::to_value(response).unwrap_or(Value::Null));
}

// Internal: factored out so the three Send* fns share one stdout write.      // (rust)
// Go re-encodes the JSON inside each Send* — Rust port keeps the same        // (rust)
// behavior conceptually (single encode + framed write per call).             // (rust)
fn SendRaw_value(value: &Value) {
    let mut bytes_buffer: Vec<u8> = Vec::new();                               // go:123  var bytesBuffer bytes.Buffer
    if let Err(e) = serde_json::to_writer(&mut bytes_buffer, value) {          // go:124  json.NewEncoder(...).Encode(response)
        eprintln!("Unable to encode response for sending: {e}");              // go:125  log.Fatal
        std::process::exit(1);
    }

    let mut stdout = io::stdout().lock();                                     // go:127  os.Stdout
    let len = bytes_buffer.len() as u32;
    if let Err(e) = stdout.write_all(&len.to_le_bytes()) {                    // go:128  binary.Write(..., binary.LittleEndian, uint32(bytesBuffer.Len()))
        eprintln!("Unable to send the length of the response: {e}");          // go:129  log.Fatal
        std::process::exit(1);
    }
    if let Err(e) = stdout.write_all(&bytes_buffer) {                         // go:131  bytesBuffer.WriteTo(os.Stdout)
        eprintln!("Unable to send the response: {e}");                        // go:132  log.Fatal
        std::process::exit(1);
    }
    let _ = stdout.flush();
}

// Helper for building Params at error sites — Go uses                        // (rust)
// `&map[errors.Field]string{ ... }` inline, Rust needs a few lines.          // (rust)
pub fn params_of(pairs: &[(&'static str, &str)]) -> Params {
    let mut p = Params::new();
    for (k, v) in pairs {
        p.insert(*k, v.to_string());
    }
    p
}

// Silence the snake_case linter — every name in this file matches its Go     // (rust)
// counterpart exactly, which is camelCase or PascalCase. The discipline      // (rust)
// rule "names must match upstream" overrides Rust style.                     // (rust)
#[allow(non_snake_case)]
#[allow(non_camel_case_types)]
const _: () = ();
