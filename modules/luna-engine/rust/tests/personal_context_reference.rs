use luna_engine::{
    contract::{self, SourceKind},
    input::personal_context::{self as personal, CheckedWorkPatternSettings, CheckedYouthContext},
};
use serde_json::{Value, json};
use std::sync::Arc;

#[test]
fn all_frozen_personal_context_and_preference_projections_match() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/personal-context-golden.json")).unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 209);
    for case in fixture["cases"].as_array().unwrap() {
        let input = &case["input"];
        let result = match case["operation"].as_str().unwrap() {
            "youthContext" => personal::validate_youth_context(input),
            "youthPreference" => personal::load_youth_protection_preference(input).map(Value::Bool),
            "workPattern" => personal::load_work_pattern_settings(input),
            _ => panic!("unknown operation"),
        };
        let actual = match result {
            Ok(value) => json!({"value":value}),
            Err(e) => json!({"error":{"name":e.name(),"message":e.message()}}),
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}
#[test]
fn opaque_contexts_retain_confirmed_zero_and_reject_assessed_fields() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/personal-context-golden.json")).unwrap();
    let mut input = fixture["cases"][0]["input"].clone();
    input["holidayLostMinutes"] = json!({"2026-12-25":0});
    let context = CheckedYouthContext::try_from_raw(&input).unwrap();
    assert_eq!(context.value()["holidayLostMinutes"]["2026-12-25"], 0);
    assert!(context.value()["careInstitution"].is_null());
    let shared = context.shared().clone();
    assert!(Arc::ptr_eq(context.shared(), &shared));
    input["ready"] = json!(true);
    assert!(CheckedYouthContext::try_from_raw(&input).is_err());
    assert!(contract::ALL_SOURCE_KINDS.contains(&SourceKind::YouthPreference));
    assert!(contract::ALL_SOURCE_KINDS.contains(&SourceKind::YouthContext));
}
#[test]
fn native_preference_rows_reject_injected_values_and_duplicate_keys() {
    let empty = CheckedWorkPatternSettings::try_from_raw_rows(&json!([])).unwrap();
    assert_eq!(
        serde_json::to_value(empty.settings()).unwrap(),
        json!({"workplaceCoverage":"UNKNOWN","assignment":"UNKNOWN","updatedAt":null})
    );
    let row = json!({"key":"tvoed_workplace_coverage","value":"AROUND_THE_CLOCK","updated_at":"2026-11-01T12:00:00Z"});
    let settings = CheckedWorkPatternSettings::try_from_raw_rows(&json!([row])).unwrap();
    assert_eq!(
        serde_json::to_value(settings.settings()).unwrap()["workplaceCoverage"],
        "AROUND_THE_CLOCK"
    );
    for value in [
        json!([row, row]),
        json!([{"key":"other","value":"UNKNOWN","updated_at":"2026-11-01T00:00:00Z"}]),
        json!([{"key":"tvoed_assignment","value":"PERMANENT","updated_at":"private-not-a-timestamp"}]),
        json!({"workplaceCoverage":"AROUND_THE_CLOCK","assessment":"PASSED"}),
    ] {
        assert!(CheckedWorkPatternSettings::try_from_raw_rows(&value).is_err());
    }
}
