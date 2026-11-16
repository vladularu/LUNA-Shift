use luna_engine::compliance::presentation;
use serde_json::Value;
#[path = "support/value_pool.rs"]
mod value_pool;

#[test]
fn full_original_finding_presentations_and_evidence_boundaries_match() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/check-presentation-golden.json"
    ));
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 3411);
    for case in cases {
        let input = &case["input"];
        let actual = match case["operation"].as_str().unwrap() {
            "issue" => presentation::issue(input).unwrap(),
            "number" => presentation::number(input.as_f64().unwrap()).unwrap(),
            "tariff" => presentation::tariff(input).unwrap(),
            "facts" => presentation::valid_facts(&input["value"], input["rule"].as_str().unwrap())
                .cloned()
                .unwrap_or(Value::Null),
            "weekend" => Value::Bool(presentation::valid_weekend(input)),
            other => panic!("Unknown operation {other}"),
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}

#[test]
fn raw_shape_failures_and_non_json_numbers_cannot_panic_or_become_ready_facts() {
    for raw in [
        Value::Null,
        serde_json::json!([]),
        serde_json::json!({"description":"private input"}),
    ] {
        assert_eq!(
            presentation::issue(&raw).unwrap_err().to_string(),
            "Invalid check presentation input"
        );
        assert_eq!(
            presentation::tariff(&raw).unwrap_err().to_string(),
            "Invalid check presentation input"
        );
        assert!(!presentation::valid_weekend(&raw));
        assert!(presentation::valid_facts(&raw, "PLANNING_7_DAYS").is_none());
    }
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(presentation::number(value).is_err());
    }
}
