mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{input::saved_critical, rules::RuleResolver};
use serde_json::json;
#[test]
fn full_original_post_save_critical_selection_matches_all_clock_and_profile_roles() {
    let fixture = value_pool::decode(include_str!("../../reference/saved-critical-golden.json"));
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 188);
    let resolver = RuleResolver::bundled().unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let input = &case["input"];
        let result = saved_critical::critical_issue(
            &input["saved"],
            input["entries"].as_array().unwrap(),
            &input["profile"],
            input["clockDate"].as_str().unwrap(),
            serde_json::from_value(input["collationRanks"].clone()).unwrap(),
            &resolver,
        );
        let actual = match result {
            Ok(value) => json!({"ok":true,"value":value}),
            Err(error) => {
                json!({"ok":false,"error":{"name":error.source_error_name(),"message":error.to_string()}})
            }
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}

#[test]
fn notice_selection_borrows_large_profile_metadata_and_rejects_missing_source_identifiers() {
    let fixture = value_pool::decode(include_str!("../../reference/saved-critical-golden.json"));
    let input = &fixture["cases"][1]["input"];
    let mut profile = input["profile"].clone();
    profile["unrelatedSourceRows"] = json!(vec![json!({"ignored":true}); 50_000]);
    let resolver = RuleResolver::bundled().unwrap();
    let actual = saved_critical::critical_issue(
        &input["saved"],
        input["entries"].as_array().unwrap(),
        &profile,
        input["clockDate"].as_str().unwrap(),
        serde_json::from_value(input["collationRanks"].clone()).unwrap(),
        &resolver,
    )
    .unwrap();
    common::assert_json_eq(
        &actual,
        &fixture["cases"][1]["expected"]["value"],
        "borrowed-profile",
    );
    assert!(serde_json::to_vec(&actual).unwrap().len() < 8192);
    assert!(
        saved_critical::critical_issue(
            &json!({}),
            &[],
            &profile,
            "2026-07-15",
            Default::default(),
            &resolver
        )
        .is_err()
    );
    assert!(
        saved_critical::critical_issue(
            &input["saved"],
            &[],
            &json!({}),
            "2026-07-15",
            Default::default(),
            &resolver
        )
        .is_err()
    );
}
