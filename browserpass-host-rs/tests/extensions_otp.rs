// Pure helper tests for the `otp` extension. The full action handler shells
// to `pass otp` which requires a real GPG keyring + agent, so it's not
// covered here — exercised end-to-end via manual install testing.

use browserpass_host_rs::extensions::otp::extract_otpauth;

#[test]
fn extracts_otpauth_url_from_entry_body() {
    let body = "hunter2\nusername: alice\notpauth://totp/Example:alice?secret=ABC&issuer=Example\n";
    assert_eq!(
        extract_otpauth(body),
        Some("otpauth://totp/Example:alice?secret=ABC&issuer=Example".to_string())
    );
}

#[test]
fn returns_none_when_no_otpauth_present() {
    let body = "hunter2\nusername: alice\nurl: https://example.com\n";
    assert_eq!(extract_otpauth(body), None);
}

#[test]
fn returns_first_otpauth_when_multiple_present() {
    let body = "pw\notpauth://totp/A?s=1\notpauth://totp/B?s=2\n";
    assert_eq!(
        extract_otpauth(body),
        Some("otpauth://totp/A?s=1".to_string())
    );
}
