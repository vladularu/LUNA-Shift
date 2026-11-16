mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{input::standby_transfer, rules::RuleResolver};
use serde_json::{Value, json};
#[test]
fn full_original_candidates_and_transfer_inputs_match_without_mocking_finance() {
    let fixture = value_pool::decode(include_str!("../../reference/standby-transfer-golden.json"));
    let resolver = RuleResolver::bundled().unwrap();
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 1656);
    for case in fixture["cases"].as_array().unwrap() {
        let input = &case["input"];
        let result = match case["operation"].as_str().unwrap() {
            "CANDIDATES" => standby_transfer::candidates(
                &input["original"],
                &input["next"],
                input["entries"].as_array().unwrap(),
                &input["profile"],
                &resolver,
            )
            .map(|v| serde_json::to_value(v).unwrap()),
            "TRANSFER" => standby_transfer::transfer_inputs(
                &input["original"],
                &input["next"],
                input["selected"].as_array().unwrap(),
                input["candidates"].as_array().unwrap(),
            )
            .map(Value::Array),
            _ => panic!("Unknown source operation"),
        };
        let actual = match result {
            Ok(value) => json!({"ok":true,"value":value}),
            Err(error) => {
                json!({"ok":false,"error":{"name":error.name(),"message":error.to_string()}})
            }
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}

#[test]
fn candidates_borrow_the_source_rows_and_do_not_copy_unrelated_profile_trees() {
    let fixture = value_pool::decode(include_str!("../../reference/standby-transfer-golden.json"));
    let case = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| {
            case["operation"] == "CANDIDATES"
                && case["expected"]["value"]
                    .as_array()
                    .is_some_and(|v| !v.is_empty())
        })
        .unwrap();
    let input = &case["input"];
    let mut profile = input["profile"].clone();
    profile["unrelatedLargeTree"] = json!(vec![json!({"ignored":true}); 50_000]);
    let entries = input["entries"].as_array().unwrap();
    let actual = standby_transfer::candidates(
        &input["original"],
        &input["next"],
        entries,
        &profile,
        &RuleResolver::bundled().unwrap(),
    )
    .unwrap();
    common::assert_json_eq(
        &serde_json::to_value(&actual).unwrap(),
        &case["expected"]["value"],
        "borrowed",
    );
    assert!(
        actual
            .iter()
            .all(|row| entries.iter().any(|entry| std::ptr::eq(*row, entry)))
    );
    assert_eq!(
        profile["unrelatedLargeTree"].as_array().unwrap().len(),
        50_000
    );
}
