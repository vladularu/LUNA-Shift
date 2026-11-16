mod common;
use luna_engine::input::{
    employment::RawEmploymentHistory, profile_composition::financial_work_profile,
    stored_profile::checked_stored_work_profile,
};
use serde_json::{Value, json};
use std::sync::Arc;
#[test]
fn financial_profile_matches_original_full_projection_without_target_dependency() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/input-profile-composition-golden.json"
    ))
    .unwrap();
    assert_eq!(data["cases"].as_array().unwrap().len(), 963);
    let profiles = data["profiles"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            checked_stored_work_profile(
                Arc::new(p["profileRow"].clone()),
                Arc::new(p["salaryRows"].as_array().unwrap().clone()),
            )
            .unwrap()
        })
        .collect::<Vec<_>>();
    let histories = data["histories"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| {
            RawEmploymentHistory::try_from_rows(Arc::new(h.as_array().unwrap().clone())).unwrap()
        })
        .collect::<Vec<_>>();
    for case in data["cases"].as_array().unwrap() {
        let profile = &profiles[case["profileIndex"].as_u64().unwrap() as usize];
        let history = &histories[case["historyIndex"].as_u64().unwrap() as usize];
        let actual = match financial_work_profile(profile, history, case["date"].as_str().unwrap())
        {
            Ok(value) => {
                assert!(value.get("workingTimeTarget").is_none());
                assert!(
                    value["employmentTimeline"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .all(|row| row["employment"].get("workingTimeTarget").is_none())
                );
                json!({"value":value.as_ref()})
            }
            Err(e) => json!({"$error":e.message(),"name":e.name()}),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
#[test]
fn raw_history_cannot_inject_a_large_calculation_context_into_financial_profile() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/input-profile-composition-golden.json"
    ))
    .unwrap();
    let mut row = data["histories"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|h| h.as_array().and_then(|h| h.first()))
        .find(|row| {
            serde_json::from_str::<Value>(row["data_json"].as_str().unwrap())
                .unwrap()
                .get("employment")
                .is_some()
        })
        .unwrap()
        .clone();
    let mut payload: Value = serde_json::from_str(row["data_json"].as_str().unwrap()).unwrap();
    payload["employment"]["workingTimeTarget"] =
        json!({"context":{"days":vec![json!({"date":"2026-07-01","lostMinutes":0});50000]}});
    row["data_json"] = json!(serde_json::to_string(&payload).unwrap());
    assert!(
        RawEmploymentHistory::try_from_rows(Arc::new(vec![row])).is_err(),
        "calculation-only history fields cannot become checked raw facts"
    );
}
#[test]
fn financial_seam_has_no_calendar_youth_saved_target_or_target_projection_read() {
    let source = include_str!("../src/input/profile_composition.rs");
    for forbidden in [
        "RawCalendarEntries",
        "RawSavedWorkingTimeTarget",
        "Youth",
        "target::",
        "workingTimeTarget",
        "create_working_time_calculation_profile",
    ] {
        assert!(
            !source.contains(forbidden),
            "financial profile must not depend on {forbidden}"
        );
    }
}
