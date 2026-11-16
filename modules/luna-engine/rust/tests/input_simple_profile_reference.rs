mod common;
use luna_engine::input::simple_profile::project_stored_simple_profile;
use serde_json::{Value, json};
use std::sync::Arc;
#[test]
fn original_stored_profile_compatibility_matches_without_database_or_clock() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/input-simple-profile-golden.json"
    ))
    .unwrap();
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 3300);
    for case in cases {
        let input = &case["input"];
        let profile = (!input["profile"].is_null()).then(|| Arc::new(input["profile"].clone()));
        let actual = match project_stored_simple_profile(
            profile.as_ref(),
            input["history"].as_array().unwrap(),
            input["date"].as_str().unwrap(),
        ) {
            Ok(value) => json!({"value":value.as_deref()}),
            Err(error) => json!({"$error":error.message(),"name":error.name()}),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
#[test]
fn unchanged_or_conflicting_profile_keeps_original_arc_and_never_picks_a_salary_winner() {
    let profile = Arc::new(
        json!({"tariff":null,"manualMonthlyGrossCents":0,"salaryBasisConflict":{"drafts":[{"kind":"manual","value":0},{"kind":"tariff","value":"bad"}]},"updatedAt":"2026-01-01T00:00:00Z"}),
    );
    let returned = project_stored_simple_profile(Some(&profile), &[], "invalid")
        .unwrap()
        .unwrap();
    assert!(Arc::ptr_eq(&profile, &returned));
    assert_eq!(returned["manualMonthlyGrossCents"], 0);
    let profile = Arc::new(
        json!({"tariff":null,"vkaETariff":{"payGroup":"E9a","payLevel":3},"updatedAt":"2026-01-01T00:00:00Z"}),
    );
    let returned = project_stored_simple_profile(Some(&profile), &[], "invalid")
        .unwrap()
        .unwrap();
    assert!(Arc::ptr_eq(&profile, &returned));
}
