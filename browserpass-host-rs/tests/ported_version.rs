// Pins for `ported::version` — values must track upstream
// `browserpass-native/version/version.go` exactly. Drift here breaks wire
// compatibility with browserpass-extension's version-detection logic.

use browserpass_host_rs::ported::version;

#[test]
fn version_constants_pin_to_upstream_3_1_2() {
    assert_eq!(version::MAJOR, 3);
    assert_eq!(version::MINOR, 1);
    assert_eq!(version::PATCH, 2);
}

#[test]
fn version_code_is_packed_int_per_protocol_md() {
    assert_eq!(version::CODE, 3 * 1_000_000 + 1 * 1_000 + 2);
    assert_eq!(version::CODE, 3_001_002);
}

#[test]
fn version_string_renders_dotted_triple() {
    assert_eq!(version::string(), "3.1.2");
}
