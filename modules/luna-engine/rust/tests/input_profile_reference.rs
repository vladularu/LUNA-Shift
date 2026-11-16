mod common;
use luna_engine::input::{
    InputError,
    profile::{
        RawUserProfile, require_profile_text, require_time_zone, require_weekly_minutes,
        validate_profile,
    },
    require_instant,
};
use serde_json::{Value, json};
fn result(value: Result<Value, InputError>) -> Value {
    match value {
        Ok(value) => json!({"value":value}),
        Err(error) => json!({"$error":error.message(),"name":error.name()}),
    }
}
#[test]
fn normalized_profile_and_helpers_match_frozen_source() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/input-profile-golden.json")).unwrap();
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 3903);
    for case in cases {
        let input = &case["input"];
        let actual = match case["operation"].as_str().unwrap() {
            "validateProfile" => validate_profile(input),
            "requireTimeZone" => require_time_zone(input).map(|value| json!(value)),
            "requireProfileText" => require_profile_text(
                &input["value"],
                input["label"].as_str().unwrap(),
                input["maxLength"].as_u64().unwrap() as usize,
            )
            .map(|value| json!(value)),
            "requireWeeklyMinutes" => require_weekly_minutes(input).map(|value| json!(value)),
            "requireInstant" => require_instant(&input["value"], input["label"].as_str().unwrap())
                .map(|value| json!(value)),
            operation => panic!("unknown {operation}"),
        };
        if case["malformedType"] == true {
            assert!(
                actual.is_err(),
                "out-of-type JSON must fail safely: {}",
                case["id"]
            );
            continue;
        }
        common::assert_json_eq(
            &result(actual),
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
}
fn stored() -> Value {
    json!({"federalState":"NW","holidayRegion":"NONE","weeklyMinutes":2310,"timeZone":"Europe/Berlin","industry":null,"tariff":null,"regularRotatingNightWork":null,"sundayHolidayWorkEligible":true,"allEmploymentWorkRecorded":false,"createdAt":"2026-01-01T00:00:00.123456789Z","updatedAt":"2026-07-01T10:00:00+01:00"})
}
#[test]
fn checked_raw_profile_preserves_metadata_and_rejects_external_computed_fields() {
    let input = stored();
    let profile = RawUserProfile::try_from_raw(input.clone()).unwrap();
    assert_eq!(profile.stored(), &input);
    assert_eq!(profile.core_profile()["createdAt"], input["createdAt"]);
    assert_eq!(profile.core_profile()["updatedAt"], input["updatedAt"]);
    assert!(profile.salary_choices().is_empty());
    assert!(profile.salary_issues().is_empty());
    for field in [
        "workingTimeTarget",
        "employmentTimeline",
        "salaryBasisConflict",
        "workPattern",
        "ready",
        "status",
        "complete",
        "id",
        "validity",
    ] {
        let mut bad = stored();
        bad[field] = Value::Null;
        assert!(
            RawUserProfile::try_from_raw(bad).is_err(),
            "forbidden {field}"
        );
    }
    for (field, value) in [
        ("weeklyMinutes", json!(59)),
        ("weeklyMinutes", json!("2310")),
        ("federalState", json!("BAD")),
        ("holidayRegion", json!("BY_AUGSBURG")),
        ("timeZone", json!("not a zone")),
        ("createdAt", Value::Null),
        ("updatedAt", json!("2026-02-30T00:00:00Z")),
    ] {
        let mut bad = stored();
        bad[field] = value;
        assert!(
            RawUserProfile::try_from_raw(bad).is_err(),
            "bad core {field}"
        );
    }
}
#[test]
fn bad_or_conflicting_salary_drafts_do_not_select_a_winner_or_hide_core_calendar_facts() {
    let mut raw = stored();
    raw["manualMonthlyGrossCents"] = json!(0);
    raw["tariff"] = json!({"payGroup":"P8","payLevel":3,"sector":"BT_K","tariffRegion":"OTHER","fullTimeWeeklyMinutes":2310});
    raw["vkaETariff"] = json!({"payGroup":"INVALID"});
    assert!(validate_profile(&raw).is_err());
    let profile = RawUserProfile::try_from_raw(raw.clone()).unwrap();
    assert_eq!(profile.stored(), &raw);
    assert_eq!(profile.stored()["manualMonthlyGrossCents"], 0);
    assert_eq!(profile.core_profile()["weeklyMinutes"], 2310);
    assert_eq!(profile.core_profile()["timeZone"], "Europe/Berlin");
    assert_eq!(profile.core_profile()["tariff"], Value::Null);
    assert_eq!(
        profile.core_profile()["manualMonthlyGrossCents"],
        Value::Null
    );
    assert_eq!(profile.salary_choices().len(), 3);
    assert_eq!(profile.salary_issues().len(), 3);
    assert!(
        profile
            .salary_issues()
            .iter()
            .any(|issue| issue.code() == "CONFLICTING_SALARY_CHOICES")
    );
    let mut malformed_region = stored();
    malformed_region["tariff"] = json!({"payGroup":"P8","payLevel":3,"sector":"BT_K","tariffRegion":"BAD","fullTimeWeeklyMinutes":2340});
    assert!(
        validate_profile(&malformed_region).is_ok(),
        "preserve source form-validator behavior"
    );
    let checked = RawUserProfile::try_from_raw(malformed_region).unwrap();
    assert_eq!(checked.salary_issues().len(), 1);
    assert_eq!(
        checked.salary_choices()[0].normalized(),
        None,
        "raw engine boundary enforces enum facts without losing the draft"
    );
}

#[test]
fn intl_only_identifiers_are_not_silently_reinterpreted_for_native_calculation() {
    let mut lower_case = stored();
    lower_case["timeZone"] = json!("europe/berlin");
    let checked = RawUserProfile::try_from_raw(lower_case).unwrap();
    assert_eq!(checked.stored()["timeZone"], "europe/berlin");
    assert_eq!(checked.core_profile()["timeZone"], "europe/berlin");
    for zone in ["−01:00", "ACT", "PST", "JST"] {
        let mut input = stored();
        input["timeZone"] = json!(zone);
        assert!(
            validate_profile(&input).is_ok(),
            "preserve Intl form-domain acceptance for {zone}"
        );
        let error = RawUserProfile::try_from_raw(input)
            .err()
            .expect("source Temporal arithmetic rejects this Intl-only identifier");
        assert_eq!(
            error.message(),
            "Die gespeicherte Zeitzone wird für Berechnungen nicht unterstützt."
        );
    }
}
