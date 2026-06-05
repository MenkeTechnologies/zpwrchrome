//! Additive features NOT present in upstream browserpass-native.
//!
//! Code here is genuinely new functionality (download manager, OTP shell-out,
//! subseq search). It does not port any Go source and is not constrained by
//! the strict-port discipline that governs `ported/`.
//!
//! Modules here are invoked by the host binary as extra actions outside the
//! upstream PROTOCOL.md action set (`dl.add`, `dl.list`, `otp`, `search`).
//! Upstream browserpass-extension never sends these actions so wire
//! compatibility with the upstream is preserved.

pub mod dl;
pub mod otp;
pub mod search;
