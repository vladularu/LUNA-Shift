use luna_engine::remuneration::service_facts::{self, ServiceFactsError};
use serde_json::{Value, json};
#[test]
fn saved_service_evidence_and_actual_interval_parents_match_frozen_source() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/service-facts-golden.json")).unwrap();
    assert_eq!(
        data["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let mut failures = Vec::new();
    let mut safe = 0;
    let mut exact = 0;
    for case in data["cases"].as_array().unwrap() {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let actual: Result<Value, ServiceFactsError> = match case["operation"].as_str().unwrap() {
            "validate" => service_facts::validate_tvl_shift_work(&input["value"])
                .map(|v| serde_json::to_value(v).unwrap()),
            "intervals" => input
                .get("value")
                .ok_or(ServiceFactsError::Intervals)
                .and_then(service_facts::validate_burn_care_intervals)
                .map(|v| serde_json::to_value(v).unwrap()),
            "current" => Ok(
                json!({"service":service_facts::is_current_tvl_service_facts(&input["value"],&input["shift"],input["timeZone"].as_str().unwrap(),&input["profile"]),"shiftWork":service_facts::is_current_tvl_shift_work(&input["value"],&input["shift"],input["timeZone"].as_str().unwrap(),&input["profile"])}),
            ),
            "parents" => {
                let intervals = service_facts::validate_burn_care_intervals(&input["intervals"])
                    .unwrap()
                    .unwrap();
                let history = input["history"].as_array().unwrap();
                service_facts::require_burn_care_interval_parents(
                    &intervals,
                    &input["shift"],
                    input["timeZone"].as_str().unwrap(),
                    &history[input["profileIndex"].as_u64().unwrap() as usize],
                    history,
                )
                .map(|()| Value::Null)
            }
            _ => panic!("Unknown fixture operation"),
        };
        if case["rejectionPolicy"] == "SAFE_INVALID_TIME_ZONE" {
            assert!(
                matches!(
                    actual,
                    Err(ServiceFactsError::Time(
                        luna_engine::EngineError::InvalidTimeZone
                    ))
                ),
                "{} {actual:?}",
                case["id"]
            );
            safe += 1;
            continue;
        }
        exact += 1;
        let actual = match actual {
            Ok(v) => json!({"value":v}),
            Err(e) => json!({"error":{"name":e.class_name(),"message":e.to_string()}}),
        };
        if actual != case["expected"] {
            failures.push(format!(
                "{}\nactual: {actual}\nexpected: {}\ninput: {}",
                case["id"], case["expected"], case["inputJson"]
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} mismatches\n{}",
        failures.len(),
        failures
            .iter()
            .take(12)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    eprintln!("Saved service facts: {exact} exact cases; {safe} named safe invalid timezones");
}
