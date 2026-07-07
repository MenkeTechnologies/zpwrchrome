// Pins for `ported::errors` — code discriminants and field names must match
// upstream `browserpass-native/errors/errors.go` byte-for-byte. The codes
// are wire constants; the field names are JSON object keys in the error
// response `params` map.

use zpwrchrome_host::ported::errors::{field, Code};

#[test]
fn every_error_code_pins_to_protocol_md_value() {
    assert_eq!(Code::ParseRequestLength.as_i32(), 10);
    assert_eq!(Code::ParseRequest.as_i32(), 11);
    assert_eq!(Code::InvalidRequestAction.as_i32(), 12);
    assert_eq!(Code::InaccessiblePasswordStore.as_i32(), 13);
    assert_eq!(Code::InaccessibleDefaultPasswordStore.as_i32(), 14);
    assert_eq!(Code::UnknownDefaultPasswordStoreLocation.as_i32(), 15);
    assert_eq!(Code::UnreadablePasswordStoreDefaultSettings.as_i32(), 16);
    assert_eq!(
        Code::UnreadableDefaultPasswordStoreDefaultSettings.as_i32(),
        17
    );
    assert_eq!(Code::UnableToListFilesInPasswordStore.as_i32(), 18);
    assert_eq!(
        Code::UnableToDetermineRelativeFilePathInPasswordStore.as_i32(),
        19
    );
    assert_eq!(Code::InvalidPasswordStore.as_i32(), 20);
    assert_eq!(Code::InvalidGpgPath.as_i32(), 21);
    assert_eq!(Code::UnableToDetectGpgPath.as_i32(), 22);
    assert_eq!(Code::InvalidPasswordFileExtension.as_i32(), 23);
    assert_eq!(Code::UnableToDecryptPasswordFile.as_i32(), 24);
    assert_eq!(Code::UnableToListDirectoriesInPasswordStore.as_i32(), 25);
    assert_eq!(
        Code::UnableToDetermineRelativeDirectoryPathInPasswordStore.as_i32(),
        26
    );
    assert_eq!(Code::EmptyContents.as_i32(), 27);
    assert_eq!(Code::UnableToDetermineGpgRecipients.as_i32(), 28);
    assert_eq!(Code::UnableToEncryptPasswordFile.as_i32(), 29);
    assert_eq!(Code::UnableToDeletePasswordFile.as_i32(), 30);
    assert_eq!(Code::UnableToDetermineIsDirectoryEmpty.as_i32(), 31);
    assert_eq!(Code::UnableToDeleteEmptyDirectory.as_i32(), 32);
}

#[test]
fn field_name_constants_match_go_string_values() {
    assert_eq!(field::MESSAGE, "message");
    assert_eq!(field::ACTION, "action");
    assert_eq!(field::ERROR, "error");
    assert_eq!(field::STORE_ID, "storeId");
    assert_eq!(field::STORE_NAME, "storeName");
    assert_eq!(field::STORE_PATH, "storePath");
    assert_eq!(field::FILE, "file");
    assert_eq!(field::DIRECTORY, "directory");
    assert_eq!(field::GPG_PATH, "gpgPath");
}
