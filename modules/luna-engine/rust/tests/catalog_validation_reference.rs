mod common;
use luna_engine::rules::validation::validate_rule_catalog;
use serde_json::{Value, json};
#[test]
fn signed_catalog_metadata_membership_and_error_paths_match_frozen_source() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/catalog-validation-golden.json"
    ))
    .unwrap();
    assert_eq!(
        data["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    assert_eq!(data["cases"].as_array().unwrap().len(), 22);
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let issues =
            validate_rule_catalog(&input["manifest"], input["packages"].as_array().unwrap())
                .unwrap();
        common::assert_json_eq(
            &json!({"ok":issues.is_empty(),"issues":issues}),
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
}
