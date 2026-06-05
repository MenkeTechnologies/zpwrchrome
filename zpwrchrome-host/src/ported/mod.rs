//! 1:1 Rust port of upstream [`browserpass-native`](https://github.com/browserpass/browserpass-native).
//!
//! Every file under `ported/` mirrors a single upstream Go file by stem and
//! relative subpath. No invented helpers, no merged files. Discipline borrowed
//! from `zshrs/docs/PORT.md` and adapted to a Go→Rust port.

pub mod errors;
pub mod helpers;
pub mod request;
pub mod response;
pub mod version;
