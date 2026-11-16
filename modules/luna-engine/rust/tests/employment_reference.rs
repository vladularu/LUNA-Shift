use luna_engine::employment::{self, EmploymentError};
use serde_json::{Value, json};

fn evaluate(case: &Value) -> Value {
    let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
    let result: Result<Value, EmploymentError> = match case["operation"].as_str().unwrap() {
        "resolve" => employment::resolve_remuneration_profile(
            input["history"].as_array().unwrap(),
            input["date"].as_str().unwrap(),
        )
        .map(|r| serde_json::to_value(r).unwrap()),
        "profileAt" => {
            employment::employment_profile_at(&input["profile"], input["date"].as_str().unwrap())
        }
        "workPatternAt" => employment::employment_work_pattern_at(
            &input["profile"],
            &input["fallback"],
            input["date"].as_str().unwrap(),
        ),
        "monthPeriods" => employment::employment_month_periods(
            &input["profile"],
            input["month"].as_str().unwrap(),
            input["lastDay"].as_str().unwrap(),
        )
        .inspect(|periods| {
            let boundaries = employment::employment_month_boundaries(
                &input["profile"],
                input["month"].as_str().unwrap(),
                input["lastDay"].as_str().unwrap(),
            )
            .unwrap();
            let actual = boundaries
                .iter()
                .map(|p| json!({"from":p.from,"until":p.until}))
                .collect::<Vec<_>>();
            let expected = periods
                .as_array()
                .unwrap()
                .iter()
                .map(|p| json!({"from":p["from"],"until":p["until"]}))
                .collect::<Vec<_>>();
            assert_eq!(actual, expected);
        }),
        "timelineKey" => employment::employment_timeline_key(input["history"].as_array().unwrap())
            .map(Value::String),
        "capture" => employment::capture_employment_profile(&input["profile"]),
        "validateWorkPattern" => employment::validate_work_pattern(input.get("value")),
        "validateOverrides" => employment::validate_employment_overrides(&input["value"]),
        "overrideKey" => employment::validate_employment_overrides(&input["value"])
            .map(|value| Value::String(serde_json::to_string(&value).unwrap())),
        other => panic!("Unknown operation {other}"),
    };
    match result {
        Ok(value) => json!({"value":value}),
        Err(error) => {
            json!({"error":{"name":match error{EmploymentError::InvalidDate|EmploymentError::AmbiguousHistory=>"RemunerationProfileError",EmploymentError::InvalidInput|EmploymentError::InvalidWorkPattern|EmploymentError::InvalidOverrides=>"ValidationError"},"message":error.to_string()}})
        }
    }
}

#[test]
fn frozen_shared_employment_operations_match_exactly() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/employment-golden.json")).unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let mut failures = vec![];
    for case in fixture["cases"].as_array().unwrap() {
        let actual = evaluate(case);
        if actual != case["expected"] {
            failures.push(format!(
                "{}\nactual: {}\nexpected: {}",
                case["id"], actual, case["expected"]
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} failed fixtures\n{}",
        failures.len(),
        failures
            .iter()
            .take(8)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n\n")
    );
}

#[test]
fn explicit_empty_history_and_undated_baseline_are_distinct() {
    let missing = employment::resolve_remuneration_profile(&[], "2026-12-01").unwrap();
    assert_eq!(missing.status, employment::ResolutionStatus::Missing);
    assert!(missing.profile.is_none());
    let baseline = json!({"effectiveFrom":null,"employmentOverrides":{"weeklyMinutes":"2026-11-01"},"retained":{"any":"source"}});
    let resolved =
        employment::resolve_remuneration_profile(std::slice::from_ref(&baseline), "2026-12-01")
            .unwrap();
    assert_eq!(
        resolved.status,
        employment::ResolutionStatus::UnknownEffectiveDate
    );
    assert_eq!(resolved.profile, Some(baseline));
}

#[test]
fn conflict_guard_precedes_history_validation_and_errors_never_echo_data() {
    let profile = json!({"salaryBasisConflict":{"unresolved":true},"employmentTimeline":[{"effectiveFrom":"private@example.com","employment":{}}]});
    assert_eq!(
        employment::employment_profile_at(&profile, "bad").unwrap(),
        profile
    );
    let error = employment::resolve_remuneration_profile(
        &[json!({"effectiveFrom":"private@example.com"})],
        "2026-12-01",
    )
    .unwrap_err();
    assert!(!error.to_string().contains("private"));
}
