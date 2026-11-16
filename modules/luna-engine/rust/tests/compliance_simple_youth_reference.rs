use bigdecimal::BigDecimal;
use luna_engine::{
    calendar::recurrence::CollationRanks,
    compliance::{
        issue::{IssueSpec, create_issue},
        preparation::prepare_calendar,
        simple_youth::{calculate_simple_youth_compliance, youth_duty_days},
    },
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::str::FromStr;
fn same_value(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            BigDecimal::from_str(&a.to_string()).unwrap()
                == BigDecimal::from_str(&b.to_string()).unwrap()
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same_value(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, v)| b.get(k).is_some_and(|b| same_value(v, b)))
        }
        _ => a == b,
    }
}
#[test]
fn full_manual_youth_duty_results_match_frozen_raw_input_oracle() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/compliance-simple-youth-golden.json"
    ))
    .unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 228);
    let resolver = RuleResolver::bundled().unwrap();
    for case in cases {
        let input = &case["input"];
        let ranks: CollationRanks =
            serde_json::from_value(input["collationRanks"].clone()).unwrap();
        let run = (|| {
            let month = input["month"].as_str().unwrap();
            let context = prepare_calendar(
                month,
                input["shifts"].as_array().unwrap(),
                input["timeZone"].as_str().unwrap(),
                &input["options"],
                &format!("{month}-15"),
                &resolver,
                &ranks,
            )?;
            let shared = input["sharedSpecs"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| create_issue(IssueSpec::from_json(s)?, []))
                .collect::<Result<Vec<_>, _>>()?;
            if case["operation"] == "compliance.simpleYouthDays" {
                return youth_duty_days(&context.intervals);
            }
            calculate_simple_youth_compliance(
                month,
                &context.intervals,
                &input["options"],
                &shared,
                &resolver,
            )
        })();
        let actual = match run {
            Ok(v) => v,
            Err(e) => json!({"$error":{"name":e.source_error_name(),"message":e.to_string()}}),
        };
        assert!(
            same_value(&actual, &case["expected"]),
            "{}\nactual {actual}\nexpected {}",
            case["id"],
            case["expected"]
        );
    }
}
