mod common;
use luna_engine::{input::profile_form::*, rules::RuleResolver};
use serde_json::{Value, json};
fn run(op: &str, i: &Value, resolver: &RuleResolver) -> Result<Value, ProfileFormError> {
    let clock = FormClock::from_instant(i["instant"].as_str().unwrap_or("2026-07-15T12:00:00Z"))?;
    let sel = || OnboardingSelection::try_from_raw(&i["selection"]);
    let profile = || ProfileFormSource::try_from_raw(&i["profile"]);
    let mode = i["mode"].as_str();
    let date = i["referenceDate"].as_str();
    Ok(match op {
        "groups" => json!(groups(mode)),
        "levels" => json!(levels(mode, i["group"].as_str())),
        "training" => json!(is_training(mode)),
        "fullTime" => json!(full_time(&sel()?, &clock, resolver)?),
        "errors" => errors(
            &sel()?,
            i["weeklyMinutes"].as_f64().unwrap(),
            &clock,
            resolver,
        )?,
        "draft" => json!(salary_draft(
            &sel()?,
            i["weeklyMinutes"].as_f64().unwrap(),
            &clock,
            resolver
        )?),
        "regionMismatch" => json!(region_mismatch(mode, i["federalState"].as_str())),
        "settings" => json!(settings_values(&profile()?, date, &clock, resolver)?),
        "settingsMode" => json!(settings_values_for_mode(
            &profile()?,
            mode.unwrap(),
            date,
            &clock,
            resolver
        )?),
        "tvalChoice" => json!(tval_workplace_choice(&profile()?, date, &clock)?),
        "tvalFields" => tval_workplace_fields(
            i["choice"].as_str().unwrap(),
            i.get("previous").filter(|v| !v.is_null()),
            i["changed"].as_bool().unwrap(),
        ),
        "manualGross" => json!(parse_manual_monthly_gross(i["text"].as_str().unwrap())),
        "manualError" => json!(manual_monthly_gross_error(i["text"].as_str().unwrap())),
        "evidence" => json!(evidence_value(i.get("value"))),
        "clock" => json!(clock.date_in(i["timeZone"].as_str().unwrap())?),
        _ => panic!("unknown op"),
    })
}
fn corpus() -> Value {
    serde_json::from_str(include_str!("../../reference/profile-form-golden.json")).unwrap()
}
#[test]
fn all_raw_profile_form_outputs_and_first_errors_match_original() {
    let b = corpus();
    let resolver = RuleResolver::bundled().unwrap();
    assert_eq!(b["cases"].as_array().unwrap().len(), 3600);
    for c in b["cases"].as_array().unwrap() {
        let actual = match run(c["operation"].as_str().unwrap(), &c["input"], &resolver) {
            Ok(v) => v,
            Err(e) => json!({"$error":{"name":e.name(),"message":e.to_string()}}),
        };
        common::assert_json_eq(&actual, &c["expected"], c["id"].as_str().unwrap());
    }
}
#[test]
fn malformed_selection_and_zone_records_stay_outside_typed_policy() {
    let b = corpus();
    let resolver = RuleResolver::bundled().unwrap();
    assert_eq!(b["boundaries"].as_array().unwrap().len(), 10);
    for c in b["boundaries"].as_array().unwrap() {
        assert!(
            run(c["operation"].as_str().unwrap(), &c["input"], &resolver).is_err(),
            "{}",
            c["id"]
        );
    }
}
