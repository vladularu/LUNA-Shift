mod common;
use luna_engine::pay::month::calculate_regular_month_with_evidence;
use luna_engine::{
    pay::{
        month::{MonthPayError, MonthPayInput, calculate_regular_month},
        pattern::WorkPatternSettings,
    },
    rules::RuleResolver,
};
use serde_json::{Value, json};

#[test]
fn full_regular_month_route_including_dated_profiles_matches_source() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/month-pay-golden.json")).unwrap();
    assert_eq!(
        data["baselineDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let resolver = RuleResolver::bundled().unwrap();
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 1351);
    for case in cases {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let settings: WorkPatternSettings =
            serde_json::from_value(input["settings"].clone()).unwrap();
        let shifts = input["shifts"].as_array().unwrap();
        let assessment = input
            .get("assessmentShifts")
            .and_then(Value::as_array)
            .unwrap_or(shifts);
        let request = MonthPayInput {
            month: input["month"].as_str().unwrap(),
            shifts,
            profile: &input["profile"],
            decision: input.get("decision").filter(|v| !v.is_null()),
            assessment_shifts: assessment,
            settings: &settings,
        };
        let actual = match calculate_regular_month(&request, &resolver) {
            Ok(value) => value,
            Err(error) => {
                let name = match &error {
                    MonthPayError::Periods(_) | MonthPayError::Employment(_) => {
                        "RemunerationProfileError"
                    }
                    MonthPayError::Family(e) if e.rule_failure().is_some() => "RuleResolutionError",
                    _ => "Error",
                };
                json!({"$error":{"name":name,"message":error.to_string()}})
            }
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}

#[test]
fn captured_month_estimates_keep_source_values_and_account_for_every_trace() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/month-pay-golden.json")).unwrap();
    let resolver = RuleResolver::bundled().unwrap();
    let mut captured_count = 0;
    for case in data["cases"].as_array().unwrap() {
        if case["expected"].get("$error").is_some() {
            continue;
        }
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let settings: WorkPatternSettings =
            serde_json::from_value(input["settings"].clone()).unwrap();
        let shifts = input["shifts"].as_array().unwrap();
        let request = MonthPayInput {
            month: input["month"].as_str().unwrap(),
            shifts,
            profile: &input["profile"],
            decision: input.get("decision").filter(|v| !v.is_null()),
            assessment_shifts: input
                .get("assessmentShifts")
                .and_then(Value::as_array)
                .unwrap_or(shifts),
            settings: &settings,
        };
        let evidence = calculate_regular_month_with_evidence(&request, &resolver)
            .unwrap_or_else(|e| panic!("{}: {e}", case["id"]));
        common::assert_json_eq(
            &evidence.estimate,
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
        for id in &evidence.expected_shift_ids {
            let captured = evidence.premium_evidence.iter().any(|e| &e.shift_id == id);
            let missing = evidence.missing_trace_shift_ids.contains(id);
            assert_ne!(
                captured, missing,
                "{}: trace {id} must be captured or explicitly missing",
                case["id"]
            );
        }
        for trace in &evidence.premium_evidence {
            assert!(evidence.expected_shift_ids.contains(&trace.shift_id));
            assert_eq!(trace.trace["id"], trace.shift_id);
            assert!(trace.trace["payments"].is_array());
        }
        captured_count += evidence.premium_evidence.len();
    }
    assert!(captured_count > 100);
}

#[test]
fn unavailable_tariff_rows_cannot_claim_complete_tax_evidence() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/month-pay-golden.json")).unwrap();
    let mut input: Value =
        serde_json::from_str(data["cases"][0]["inputJson"].as_str().unwrap()).unwrap();
    input["profile"]["tariff"]["payGroup"] = json!("P99");
    let settings: WorkPatternSettings = serde_json::from_value(input["settings"].clone()).unwrap();
    let shifts = input["shifts"].as_array().unwrap();
    let request = MonthPayInput {
        month: input["month"].as_str().unwrap(),
        shifts,
        profile: &input["profile"],
        decision: None,
        assessment_shifts: shifts,
        settings: &settings,
    };
    let evidence =
        calculate_regular_month_with_evidence(&request, &RuleResolver::bundled().unwrap()).unwrap();
    assert_eq!(evidence.estimate["available"], false);
    assert!(evidence.estimate["estimatedGrossAmount"].is_null());
    assert!(evidence.premium_evidence.is_empty());
    assert_eq!(evidence.expected_shift_ids.len(), 6);
    assert_eq!(
        evidence.expected_shift_ids,
        evidence.missing_trace_shift_ids
    );
}
