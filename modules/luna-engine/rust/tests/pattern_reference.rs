mod common;
use jiff::Timestamp;
use luna_engine::pay::pattern::{self, CalendarNightEvidence, PatternError, WorkPatternSettings};
use luna_engine::rules::{PackageIds, RulePackage, RuleResolver};
use serde_json::{Value, json};

#[test]
fn work_pattern_and_night_sequence_outputs_match_frozen_source() {
    let reference: Value =
        serde_json::from_str(include_str!("../../reference/pattern-golden.json")).unwrap();
    assert_eq!(
        reference["baselineDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let ids: PackageIds = serde_json::from_value(reference["packageIds"].clone()).unwrap();
    let resolver =
        RuleResolver::from_catalog_json(reference["catalog"].clone(), ids, None).unwrap();
    let cases = reference["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 573);
    let mut compared = 0;
    let mut bounded_rejections = 0;
    for case in cases {
        let input = &case["input"];
        let settings: Option<WorkPatternSettings> = input
            .get("settings")
            .map(|v| serde_json::from_value(v.clone()).unwrap());
        let override_package: Option<RulePackage> = input
            .get("tariffOverride")
            .map(|v| serde_json::from_value(v.clone()).unwrap());
        let outcome = match case["operation"].as_str().unwrap() {
            "pattern.assess" => {
                let evidence = input
                    .get("calendarEvidence")
                    .map(|v| CalendarNightEvidence {
                        met: v["met"].as_bool().unwrap(),
                        count: v["count"].as_u64().unwrap() as usize,
                    });
                pattern::assess_tvoed_pattern(
                    input["shifts"].as_array().unwrap(),
                    settings.as_ref().unwrap(),
                    &resolver,
                    input["effectiveDate"].as_str(),
                    evidence,
                    override_package.as_ref(),
                )
            }
            "pattern.month" => pattern::assess_tvoed_k_calendar_month(
                input["month"].as_str().unwrap(),
                input["shifts"].as_array().unwrap(),
                settings.as_ref().unwrap(),
                &resolver,
                input["timeZone"].as_str().unwrap(),
                input["effectiveDate"].as_str(),
                override_package.as_ref(),
            ),
            "pattern.nights" => pattern::calendar_nights::explain_night_sequence(
                input["entries"].as_array().unwrap(),
                input["month"].as_str().unwrap(),
                input["timeZone"].as_str().unwrap(),
            )
            .map(|v| json!(v)),
            "pattern.deadline" => {
                let end: Timestamp = input["end"].as_str().unwrap().parse().unwrap();
                let zone =
                    luna_engine::time_zone::zone(input["timeZone"].as_str().unwrap()).unwrap();
                pattern::calendar_nights::night_deadline(end.as_millisecond(),&zone).map(|(date,exclusive)|json!({"deadlineDate":date,"deadlineExclusive":Timestamp::from_millisecond(exclusive).unwrap().to_string()}))
            }
            op => panic!("Unknown operation {op}"),
        };
        if input.get("effectiveDate").and_then(Value::as_str) == Some("2026-07-32") {
            // Explicit malformed-input hardening: no reflection of arbitrary
            // supplied date strings through a Temporal RangeError message.
            assert_eq!(outcome, Err(PatternError::InvalidRuleDate));
            assert_eq!(case["expected"]["$error"]["name"], "RangeError");
            bounded_rejections += 1;
            continue;
        }
        let actual = match outcome {
            Ok(v) => v,
            Err(error) => json!({"$error":{"name":"Error","message":error.to_string()}}),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        compared += 1;
    }
    assert_eq!((compared, bounded_rejections), (572, 1));
}
