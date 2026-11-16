mod common;
use luna_engine::rules::validation::{
    validate_manifest, validate_publication, validate_rule_package,
};
use serde_json::{Value, json};
#[path = "support/issues.rs"]
mod fixture;
use fixture::edited;
#[test]
fn non_tariff_catalog_contracts_match_source_semantics_and_schema_diagnostics() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/rule-validation-golden.json")).unwrap();
    assert_eq!(
        data["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    assert_eq!(data["cases"].as_array().unwrap().len(), 6093);
    for case in data["cases"].as_array().unwrap() {
        let value = edited(
            data["seeds"][case["seedId"].as_str().unwrap()].clone(),
            case["edits"].as_array().unwrap(),
        );
        let issues = match case["kind"].as_str().unwrap() {
            "manifest" => validate_manifest(&value),
            "publication" => validate_publication(&value),
            "package" => validate_rule_package(&value),
            _ => panic!("Unknown operation"),
        }
        .unwrap_or_else(|e| panic!("{}: {e}", case["id"]));
        common::assert_json_eq(
            &json!({"ok":issues.is_empty(),"issues":issues}),
            &fixture::expected(&data, case),
            case["id"].as_str().unwrap(),
        );
    }
}
