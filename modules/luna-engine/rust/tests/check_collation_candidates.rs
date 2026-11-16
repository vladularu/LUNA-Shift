use luna_engine::{compliance::preparation::check_collation_candidates, training};
use serde_json::{Value, json};
use std::collections::BTreeSet;

#[test]
fn candidate_ids_match_frozen_original_duty_projection() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../reference/compliance-foundation-golden.json"
    ))
    .unwrap();
    let mut comparisons = 0;
    for case in corpus["cases"].as_array().unwrap() {
        if case["operation"] != "compliance.prepare" {
            continue;
        }
        let Some(projected) = case["expected"]["shifts"].as_array() else {
            continue;
        };
        let mut expected: BTreeSet<String> = training::code_candidates()
            .iter()
            .map(|v| (*v).to_owned())
            .collect();
        expected.extend(
            projected
                .iter()
                .map(|v| v["id"].as_str().unwrap().to_owned()),
        );
        let mut input = case["input"]["shifts"].as_array().unwrap().clone();
        input.push(json!({"kind":"APPOINTMENT","id":"appointment-excluded"}));
        assert_eq!(
            check_collation_candidates(&input).unwrap(),
            expected,
            "{}",
            case["id"]
        );
        comparisons += 1;
    }
    assert!(comparisons >= 10, "actual Source comparisons {comparisons}");
}

#[test]
fn large_normal_plan_needs_only_ids_and_static_codes() {
    let entries: Vec<Value> = (0..50_000)
        .map(|i| json!({"kind":"SHIFT","id":format!("plan-{i}")}))
        .collect();
    let actual = check_collation_candidates(&entries).unwrap();
    assert_eq!(actual.len(), 50_000 + 64);
    for entry in &entries {
        assert!(actual.contains(entry["id"].as_str().unwrap()));
    }
}
