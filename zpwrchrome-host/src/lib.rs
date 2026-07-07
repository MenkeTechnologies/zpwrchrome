//! zpwrchrome-host — Rust port of [browserpass-native](https://github.com/browserpass/browserpass-native)
//! plus zpwrchrome extensions (otp, search, segmented download manager).
//!
//! The `ported/` tree is a strict 1:1 port of the upstream Go source — every
//! file mirrors a single upstream Go file by stem and relative subpath, every
//! fn cites `// go:NN` line origins, every Go comment carries over verbatim.
//!
//! The `extensions/` tree is additive Rust-only code: features upstream
//! browserpass-native does not have. Extension actions are dispatched by
//! `bin/zpwrchrome_host.rs` *before* falling through to the ported
//! dispatcher, so the upstream protocol is unchanged.

pub mod diag;
pub mod extensions;
pub mod frame;
pub mod ported;
