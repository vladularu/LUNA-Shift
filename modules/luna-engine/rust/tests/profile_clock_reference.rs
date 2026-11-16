mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::input::{
    self, employment::RawEmploymentHistory, personal_context::CheckedWorkPatternSettings,
    profile_clock::prepare_profile_clock, stored_profile::checked_stored_work_profile,
};
use serde_json::{Value, json};
use std::sync::Arc;
fn data() -> Value {
    value_pool::decode(include_str!("../../reference/profile-clock-golden.json"))
}
fn evaluate(i: &Value) -> Result<Value, input::InputError> {
    let stored = if i["profile"].is_null() {
        None
    } else {
        Some(checked_stored_work_profile(
            Arc::new(i["profile"]["profileRow"].clone()),
            Arc::new(i["profile"]["salaryRows"].as_array().unwrap().clone()),
        )?)
    };
    let history = if stored.is_none() {
        None
    } else {
        Some(RawEmploymentHistory::try_from_rows(Arc::new(
            i["historyRows"].as_array().unwrap().clone(),
        ))?)
    };
    let prepared = prepare_profile_clock(
        stored.as_ref(),
        history.as_ref(),
        i["observedEpochMilliseconds"].as_i64().unwrap(),
    )?;
    let pattern = CheckedWorkPatternSettings::try_from_raw_rows(&i["patternRows"]).unwrap();
    prepared.metadata(Some(&pattern))
}
#[test]
fn actual_original_profile_ports_and_providers_match_at_one_immutable_instant() {
    let b = data();
    assert_eq!(b["cases"].as_array().unwrap().len(), 253);
    for case in b["cases"].as_array().unwrap() {
        let actual = match evaluate(&case["input"]) {
            Ok(value) => json!({"value":value}),
            Err(e) => json!({"error":{"name":e.name(),"message":e.message()}}),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
#[test]
fn clock_validity_and_profile_metadata_have_independent_small_bounded_outputs() {
    let b = data();
    let mut missing_pattern = 0;
    let mut unused_pattern = 0;
    for case in b["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["expected"]["value"].is_object())
    {
        let i = &case["input"];
        let stored = if i["profile"].is_null() {
            None
        } else {
            Some(
                checked_stored_work_profile(
                    Arc::new(i["profile"]["profileRow"].clone()),
                    Arc::new(i["profile"]["salaryRows"].as_array().unwrap().clone()),
                )
                .unwrap(),
            )
        };
        let history = if stored.is_none() {
            None
        } else {
            Some(
                RawEmploymentHistory::try_from_rows(Arc::new(
                    i["historyRows"].as_array().unwrap().clone(),
                ))
                .unwrap(),
            )
        };
        let from = i["observedEpochMilliseconds"].as_i64().unwrap();
        let p = prepare_profile_clock(stored.as_ref(), history.as_ref(), from).unwrap();
        let until = p.clock_metadata()["validUntilEpochMilliseconds"]
            .as_i64()
            .unwrap();
        assert!(until > from);
        assert!(p.is_valid_at(from));
        assert!(p.is_valid_at(until - 1));
        assert!(!p.is_valid_at(from - 1));
        assert!(!p.is_valid_at(until));
        let clock = p.clock_metadata().clone();
        if p.requires_work_pattern() {
            assert!(p.profile_metadata(None).is_err());
            missing_pattern += 1;
        } else {
            assert!(p.profile_metadata(None).is_ok());
            unused_pattern += 1;
        }
        assert_eq!(
            *p.clock_metadata(),
            clock,
            "missing pattern must never change a prepared clock"
        );
        let pattern = CheckedWorkPatternSettings::try_from_raw_rows(&i["patternRows"]).unwrap();
        let m = p.metadata(Some(&pattern)).unwrap();
        assert!(serde_json::to_vec(&m).unwrap().len() < 32 * 1024);
        for key in [
            "savedProfile",
            "projectedBaseProfile",
            "providerProfile",
            "calculationBaseProfile",
        ] {
            assert!(m[key].get("workingTimeTarget").is_none());
            assert!(m[key].get("employmentTimeline").is_none());
        }
    }
    assert!(missing_pattern > 0 && unused_pattern > 0);
}
