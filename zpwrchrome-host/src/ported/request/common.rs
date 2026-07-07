//! Port of `request/common.go` from upstream `browserpass-native`.
//!
//! 1:1 Rust port. Go uses `os.ExpandEnv` (stdlib) — Rust stdlib has no
//! equivalent, so the expansion is **inlined** at the call site below
//! (no separate helper fn) per maintainer-approved option (a).
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]

use std::fs;
use std::path::PathBuf;

/// Port of `normalizePasswordStorePath()` from `request/common.go:11`.
pub fn normalizePasswordStorePath(storePath: &str) -> Result<PathBuf, String> {
    let mut storePath = storePath.to_string(); // go:11 storePath string (mutable)

    if storePath.is_empty() {
        // go:12
        return Err("The store path cannot be empty".to_string()); // go:13
    }

    if storePath.starts_with("~/") {
        // go:16 strings.HasPrefix(storePath, "~/")
        storePath = format!("$HOME/{}", &storePath[2..]); // go:17 filepath.Join("$HOME", storePath[2:])
    }
    // storePath = os.ExpandEnv(storePath)                                      // go:19
    // Inlined env expansion (Rust stdlib has no os.ExpandEnv). Handles         // (rust)
    // both `$VAR` and `${VAR}` the way Go's expander does.                     // (rust)
    {
        let s = storePath;
        let mut out = String::with_capacity(s.len());
        let mut chars = s.chars().peekable();
        while let Some(c) = chars.next() {
            if c != '$' {
                out.push(c);
                continue;
            }
            match chars.peek() {
                Some(&'{') => {
                    chars.next();
                    let mut name = String::new();
                    for ch in chars.by_ref() {
                        if ch == '}' {
                            break;
                        }
                        name.push(ch);
                    }
                    out.push_str(&std::env::var(&name).unwrap_or_default());
                }
                Some(&ch) if ch.is_ascii_alphabetic() || ch == '_' => {
                    let mut name = String::new();
                    while let Some(&next) = chars.peek() {
                        if next.is_ascii_alphanumeric() || next == '_' {
                            name.push(next);
                            chars.next();
                        } else {
                            break;
                        }
                    }
                    out.push_str(&std::env::var(&name).unwrap_or_default());
                }
                _ => out.push('$'),
            }
        }
        storePath = out;
    }

    let directStorePath = fs::canonicalize(&storePath) // go:21 filepath.EvalSymlinks(storePath)
        .map_err(|e| format!("{e}"))?; // go:22-24
    let storePath = directStorePath; // go:25 storePath = directStorePath

    let stat = fs::metadata(&storePath) // go:27 os.Stat(storePath)
        .map_err(|e| format!("{e}"))?; // go:28-30
    if !stat.is_dir() {
        // go:31 !stat.IsDir()
        return Err("The specified path exists, but is not a directory".to_string());
        // go:32
    }
    Ok(storePath) // go:34
}

#[allow(non_snake_case)]
const _: () = ();
