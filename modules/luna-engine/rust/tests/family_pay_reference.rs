use luna_engine::{
    pay::families::{self, Family, FamilyError},
    rules::RuleResolver,
};
use serde_json::{Value, json};

fn evaluate(input: &Value, resolver: &RuleResolver) -> Result<Value, FamilyError> {
    let shifts = input["shifts"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let profile = &input["profile"];
    let family: Family = serde_json::from_value(input["family"].clone()).unwrap();
    if input["operation"] == "selection" {
        let selected = families::select_assessment_shifts(
            family,
            input["entries"].as_array().unwrap(),
            input["month"].as_str().unwrap(),
        )?;
        return Ok(json!(selected));
    }
    if matches!(family, Family::VkaE | Family::Training) {
        let settings = input
            .get("settings")
            .map(|s| serde_json::from_value(s.clone()).unwrap())
            .unwrap_or_default();
        let month = input["month"].as_str().unwrap_or("");
        return match input["operation"].as_str().unwrap() {
            "month" => families::vka_training::calculate_month(
                family,
                &families::FamilyMonthInput {
                    month,
                    shifts,
                    profile,
                    decision: input.get("decision").filter(|d| !d.is_null()),
                    assessment_shifts: input["assessmentShifts"]
                        .as_array()
                        .map(Vec::as_slice)
                        .unwrap_or(shifts),
                    settings: &settings,
                },
                resolver,
            ),
            "shift" => families::vka_training::calculate_shift(
                family,
                &input["shift"],
                profile,
                resolver,
                input["trace"].as_bool().unwrap_or(false),
            ),
            "assessment" => families::vka_training::calculate_assessment(
                family, month, shifts, &settings, resolver, profile,
            ),
            "hourly" => families::vka_training::duty_hourly(
                family,
                input["date"].as_str().unwrap(),
                profile,
                resolver,
            ),
            "rates" => families::vka_training::duty_overtime_rates(
                family,
                input["date"].as_str().unwrap(),
                profile,
                resolver,
            ),
            other => panic!("Unknown operation {other}"),
        };
    }
    if family == Family::Tvh {
        let settings = input
            .get("settings")
            .map(|s| serde_json::from_value(s.clone()).unwrap())
            .unwrap_or_default();
        let month = input["month"].as_str().unwrap_or("");
        return match input["operation"].as_str().unwrap() {
            "month" => families::tvh::calculate_month(
                month,
                shifts,
                profile,
                input.get("decision").filter(|d| !d.is_null()),
                input["assessmentShifts"]
                    .as_array()
                    .map(Vec::as_slice)
                    .unwrap_or(shifts),
                &settings,
                resolver,
            ),
            "shift" => families::tvh::calculate_shift(
                &input["shift"],
                profile,
                input["saturdayShiftWork"].as_bool().unwrap_or(false),
                input["allowanceStatus"].as_str().unwrap_or("NONE"),
                resolver,
                input["trace"].as_bool().unwrap_or(false),
            ),
            "assessment" => families::tvh::calculate_assessment(
                month,
                shifts,
                &settings,
                profile["timeZone"].as_str().unwrap(),
            ),
            "hourly" => {
                families::tvh::duty_hourly(input["date"].as_str().unwrap(), profile, resolver)
            }
            "rates" => families::tvh::duty_overtime_rates(
                input["date"].as_str().unwrap(),
                profile,
                resolver,
            ),
            other => panic!("Unknown operation {other}"),
        };
    }
    if matches!(family, Family::Tvl | Family::Tval) {
        let settings = input
            .get("settings")
            .map(|s| serde_json::from_value(s.clone()).unwrap())
            .unwrap_or_default();
        let month = input["month"].as_str().unwrap_or("");
        return match input["operation"].as_str().unwrap() {
            "month" => families::tvl_tval::calculate_month(
                family,
                &families::FamilyMonthInput {
                    month,
                    shifts,
                    profile,
                    decision: input.get("decision").filter(|d| !d.is_null()),
                    assessment_shifts: input["assessmentShifts"]
                        .as_array()
                        .map(Vec::as_slice)
                        .unwrap_or(shifts),
                    settings: &settings,
                },
                resolver,
            ),
            "shift" => families::tvl_tval::calculate_shift(
                family,
                &input["shift"],
                profile,
                input["saturdayShiftWork"].as_bool().unwrap_or(false),
                resolver,
                input["trace"].as_bool().unwrap_or(false),
            ),
            "assessment" => {
                families::tvl_tval::calculate_assessment(family, month, shifts, &settings, resolver)
            }
            "hourly" => families::tvl_tval::duty_hourly(
                family,
                input["date"].as_str().unwrap(),
                profile,
                resolver,
            ),
            "rates" => families::tvl_tval::duty_overtime_rates(
                family,
                input["date"].as_str().unwrap(),
                profile,
                resolver,
            ),
            other => panic!("Unknown operation {other}"),
        };
    }
    assert_eq!(family, Family::Tvuk);
    match input["operation"].as_str().unwrap() {
        "month" => families::tvuk::calculate_month(
            input["month"].as_str().unwrap(),
            shifts,
            profile,
            input["assessmentShifts"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or(shifts),
            resolver,
        ),
        "shift" => families::tvuk::calculate_shift(
            &input["shift"],
            profile,
            input["saturdayShiftWork"].as_bool().unwrap_or(false),
            input["paidNightBreaks"].as_bool().unwrap_or(false),
            resolver,
            input["trace"].as_bool().unwrap_or(false),
        ),
        "assessment" => {
            families::tvuk::calculate_assessment(input["month"].as_str().unwrap(), shifts, resolver)
        }
        "hourly" => families::tvuk::duty_hourly(input["date"].as_str().unwrap(), profile, resolver),
        other => panic!("Unknown family operation {other}"),
    }
}
fn result(value: Result<Value, FamilyError>) -> Value {
    match value {
        Ok(value) => json!({"value":value}),
        Err(error) => {
            let mut value = json!({"error":{"name":match error{FamilyError::Rule(_)=>"RuleResolutionError",FamilyError::Profile(_)=>"UserFacingError",_=>"Error"},"message":error.to_string()}});
            if let FamilyError::Rule(failure) = error {
                value["error"]["failure"] = serde_json::to_value(failure).unwrap();
            }
            value
        }
    }
}

#[test]
fn ported_current_families_match_frozen_source() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/family-pay-golden.json")).unwrap();
    let resolver = RuleResolver::bundled().unwrap();
    let mut catalogs = std::collections::BTreeMap::new();
    for (id, spec) in fixture["catalogs"].as_object().unwrap() {
        catalogs.insert(
            id.clone(),
            RuleResolver::new(
                serde_json::from_value(spec["catalog"].clone()).unwrap(),
                serde_json::from_value(spec["packageIds"].clone()).unwrap(),
                None,
            )
            .unwrap(),
        );
    }
    let mut failures = vec![];
    let mut count = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        count += 1;
        let selected = input["catalogRef"]
            .as_str()
            .map(|id| catalogs.get(id).unwrap())
            .unwrap_or(&resolver);
        let actual = result(evaluate(&input, selected));
        if actual != case["expected"] {
            failures.push(format!(
                "{}\nactual: {}\nexpected: {}",
                case["id"], actual, case["expected"]
            ));
        }
    }
    assert!(count > 100);
    assert!(
        failures.is_empty(),
        "{} failed cases:\n{}",
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
fn public_dispatchers_preserve_frozen_cash_trace_and_rate_outputs() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/family-pay-golden.json")).unwrap();
    let resolver = RuleResolver::bundled().unwrap();
    let mut families_seen = std::collections::BTreeSet::new();
    let mut checked = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        if input.get("catalogRef").is_some() {
            continue;
        }
        let id = case["id"].as_str().unwrap();
        let op = input["operation"].as_str().unwrap();
        if !(id.contains("month-work-")
            || id.contains("shift-0-true-true")
            || id.contains("hourly-2026-05-01-2310")
            || id.contains("rates-2026-05-01-2310"))
        {
            continue;
        }
        let family: Family = serde_json::from_value(input["family"].clone()).unwrap();
        let shifts = input["shifts"].as_array().map(Vec::as_slice).unwrap_or(&[]);
        let settings = Default::default();
        let profile = &input["profile"];
        let native = match op {
            "month" => families::calculate_monthly_pay(
                family,
                &families::FamilyMonthInput {
                    month: input["month"].as_str().unwrap(),
                    shifts,
                    profile,
                    decision: input.get("decision"),
                    assessment_shifts: shifts,
                    settings: &settings,
                },
                &resolver,
            ),
            "shift" => families::calculate_shift_breakdown(
                family,
                &input["shift"],
                profile,
                &resolver,
                &families::FamilyShiftOptions {
                    saturday_shift_work: true,
                    regular_shift_work: true,
                    paid_night_breaks: false,
                    allowance_status: "NONE".into(),
                },
                true,
            ),
            "hourly" => families::duty_hourly_cents(
                family,
                input["date"].as_str().unwrap(),
                profile,
                &resolver,
            )
            .map(|value| json!(value)),
            "rates" => families::duty_overtime_rates(
                family,
                input["date"].as_str().unwrap(),
                profile,
                &resolver,
            )
            .map(|value| json!(value)),
            _ => unreachable!(),
        };
        assert_eq!(result(native), case["expected"], "{}", case["id"]);
        checked += 1;
        families_seen.insert(input["family"].as_str().unwrap().to_owned());
    }
    assert_eq!(families_seen.len(), 6);
    assert!(checked >= 40);
}

#[test]
fn one_pass_month_evidence_preserves_all_frozen_month_results_and_reports_coverage() {
    let f: Value =
        serde_json::from_str(include_str!("../../reference/family-pay-golden.json")).unwrap();
    let bundled = RuleResolver::bundled().unwrap();
    let mut catalogs = std::collections::BTreeMap::new();
    for (id, spec) in f["catalogs"].as_object().unwrap() {
        catalogs.insert(
            id.clone(),
            RuleResolver::new(
                serde_json::from_value(spec["catalog"].clone()).unwrap(),
                serde_json::from_value(spec["packageIds"].clone()).unwrap(),
                None,
            )
            .unwrap(),
        );
    }
    let mut checked = 0;
    let mut captured = 0;
    let mut missing = 0;
    let mut families_seen = std::collections::BTreeSet::new();
    for case in f["cases"].as_array().unwrap() {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        if input["operation"] != "month" {
            continue;
        }
        let family: Family = serde_json::from_value(input["family"].clone()).unwrap();
        let shifts = input["shifts"].as_array().map(Vec::as_slice).unwrap_or(&[]);
        let settings = input
            .get("settings")
            .map(|s| serde_json::from_value(s.clone()).unwrap())
            .unwrap_or_default();
        let selected = input["catalogRef"]
            .as_str()
            .map(|id| catalogs.get(id).unwrap())
            .unwrap_or(&bundled);
        let output = families::calculate_monthly_pay_with_evidence(
            family,
            &families::FamilyMonthInput {
                month: input["month"].as_str().unwrap(),
                shifts,
                profile: &input["profile"],
                decision: input.get("decision").filter(|d| !d.is_null()),
                assessment_shifts: input["assessmentShifts"]
                    .as_array()
                    .map(Vec::as_slice)
                    .unwrap_or(shifts),
                settings: &settings,
            },
            selected,
        );
        match output {
            Err(e) => assert_eq!(result(Err(e)), case["expected"], "{}", case["id"]),
            Ok(output) => {
                assert_eq!(
                    json!({"value":&output.estimate}),
                    case["expected"],
                    "{}",
                    case["id"]
                );
                let cash = output.estimate["shiftBreakdowns"]
                    .as_array()
                    .map(Vec::as_slice)
                    .unwrap_or(&[]);
                for evidence in &output.premium_evidence {
                    assert!(evidence.trace.is_object());
                    assert_eq!(evidence.trace["id"], evidence.shift_id);
                    assert!(evidence.breakdown.get("payrollTrace").is_none());
                    assert!(cash.iter().any(|b| b == &evidence.breakdown));
                    assert!(output.expected_shift_ids.contains(&evidence.shift_id));
                    assert!(!output.missing_trace_shift_ids.contains(&evidence.shift_id));
                }
                for id in &output.missing_trace_shift_ids {
                    assert!(!output.premium_evidence.iter().any(|e| &e.shift_id == id));
                }
                for id in &output.expected_shift_ids {
                    assert!(
                        output.premium_evidence.iter().any(|e| &e.shift_id == id)
                            || output.missing_trace_shift_ids.contains(id)
                    );
                }
                if output.estimate["available"] == true {
                    assert!(output.missing_trace_shift_ids.is_empty(), "{}", case["id"]);
                }
                captured += output.premium_evidence.len();
                missing += output.missing_trace_shift_ids.len();
            }
        }
        checked += 1;
        families_seen.insert(input["family"].as_str().unwrap().to_owned());
    }
    assert!(
        checked >= 100 && captured >= 6 && missing > 0,
        "checked {checked}, captured {captured}, missing {missing}"
    );
    assert_eq!(families_seen.len(), 6);
    eprintln!(
        "One-pass family evidence: {checked} unchanged frozen months, {captured} captured shifts, {missing} explicitly missing"
    );
}
