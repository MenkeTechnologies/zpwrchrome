// Pure-scorer tests for the `search` extension. The full action handler
// shells out to the store dir; the integration test under
// `ported_integration.rs` covers the dispatch path. Here we pin the
// scoring algorithm so refactors can't silently change ranking.

use browserpass_host_rs::extensions::search::search_in;

#[test]
fn empty_query_returns_all_entries_sorted() {
    let entries = vec![
        "google.com/work".to_string(),
        "amazon.com/wiz".to_string(),
        "boa".to_string(),
    ];
    let got = search_in(&entries, "");
    assert_eq!(got, vec![
        "amazon.com/wiz".to_string(),
        "boa".to_string(),
        "google.com/work".to_string(),
    ]);
}

#[test]
fn substring_match_outranks_subsequence() {
    let entries = vec![
        "aaazznbcd".to_string(),       // subseq for "azn"
        "amazon.com/wiz".to_string(),  // substring for "amazon"
    ];
    let got = search_in(&entries, "amazon");
    assert_eq!(got[0], "amazon.com/wiz");
}

#[test]
fn case_insensitive_matching() {
    let entries = vec!["Amazon.com/Wiz".to_string()];
    let got = search_in(&entries, "AMAZON");
    assert_eq!(got, vec!["Amazon.com/Wiz".to_string()]);
}

#[test]
fn no_match_returns_empty() {
    let entries = vec![
        "amazon.com/wiz".to_string(),
        "google.com/work".to_string(),
    ];
    let got = search_in(&entries, "xyzqq");
    assert!(got.is_empty());
}

#[test]
fn subseq_picks_up_when_substring_absent() {
    let entries = vec!["abc-def-ghi".to_string()];
    let got = search_in(&entries, "adg");
    assert_eq!(got.len(), 1);
}

#[test]
fn within_substring_matches_earlier_position_ranks_higher() {
    let entries = vec![
        "xxxamazon".to_string(),    // substring at pos 3
        "amazonxxx".to_string(),    // substring at pos 0
    ];
    let got = search_in(&entries, "amazon");
    assert_eq!(got[0], "amazonxxx", "earlier pos should win, got {got:?}");
}
