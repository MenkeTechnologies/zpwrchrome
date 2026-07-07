//! Port of `version/version.go` from upstream `browserpass-native`.
//!
//! 1:1 Rust port. Names, values, and ordering match upstream verbatim.
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]

// go:4 const major = 3
// go:5 const minor = 1
// go:6 const patch = 2
pub const MAJOR: u64 = 3;
pub const MINOR: u64 = 1;
pub const PATCH: u64 = 2;

// Code version as integer                                                   // go:8
pub const CODE: u64 = MAJOR * 1_000_000 + MINOR * 1_000 + PATCH; // go:9

/// Port of `String()` from `version/version.go:12`.
///
// String version as string                                                  // go:11
pub fn string() -> String {
    format!("{}.{}.{}", MAJOR, MINOR, PATCH) // go:13
}
