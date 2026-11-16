mod common;
#[path = "support/issues.rs"]
mod fixture;
use luna_engine::rules::validation::validate_rule_package;
use serde_json::{Value, json};
#[test]
fn generic_tariff_semantics_and_combined_full_pipeline_issues_match_source() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/generic-tariff-validation-golden.json"
    ))
    .unwrap();
    assert_eq!(
        data["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    assert_eq!(data["cases"].as_array().unwrap().len(), 2521);
    for case in data["cases"].as_array().unwrap() {
        let value = fixture::edited(
            data["seeds"][case["seedId"].as_str().unwrap()].clone(),
            case["edits"].as_array().unwrap(),
        );
        let issues =
            validate_rule_package(&value).unwrap_or_else(|e| panic!("{}: {e}", case["id"]));
        common::assert_json_eq(
            &json!({"ok":issues.is_empty(),"issues":issues}),
            &fixture::expected(&data, case),
            case["id"].as_str().unwrap(),
        );
    }
}
