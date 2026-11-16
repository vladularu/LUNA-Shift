mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::report::time_details::{annual_distribution_sections, special_duty_time_facts};
#[test]
fn numeric_time_sidecars_match_all_original_frozen_outputs() {
    let fixture = value_pool::decode(include_str!("../../reference/time-details-golden.json"));
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 1357);
    for case in cases {
        let actual = match case["operation"].as_str().unwrap() {
            "distribution" => {
                let input: Vec<(String, f64)> =
                    serde_json::from_value(case["input"].clone()).unwrap();
                serde_json::to_value(annual_distribution_sections(&input)).unwrap()
            }
            "specialDutyFacts" => {
                serde_json::to_value(special_duty_time_facts(&case["input"]).unwrap()).unwrap()
            }
            other => panic!("unknown {other}"),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
#[test]
fn malformed_payable_minutes_are_rejected_and_missing_is_not_pending_null() {
    let facts=special_duty_time_facts(&serde_json::json!({"specialDutyTimeCredits":[{"settlement":"PAY","recordedMinutes":100},{"settlement":"PAY","creditedMinutes":null,"recordedMinutes":100},{"settlement":"PAY","creditedMinutes":0,"recordedMinutes":0.1},{"settlement":"TIME_OFF","creditedMinutes":0,"recordedMinutes":500}]})).unwrap();
    assert_eq!(facts.paid_minutes, 0.1);
    assert_eq!(facts.pending_indices, vec![1]);
    assert_eq!(facts.pending_count, 1);
    let error=special_duty_time_facts(&serde_json::json!({"specialDutyTimeCredits":[{"settlement":"PAY","creditedMinutes":0,"recordedMinutes":"private-secret"}]})).unwrap_err();
    assert!(!error.to_string().contains("private-secret"));
    assert!(special_duty_time_facts(&serde_json::Value::Null).is_err());
}
