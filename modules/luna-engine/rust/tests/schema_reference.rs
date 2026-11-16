mod common;
#[path = "support/issues.rs"]
mod fixture;
use luna_engine::rules::validation::schema::{SchemaKind, validate_schema};
use serde_json::{Value, json};
#[test]
fn all_embedded_schema_contracts_and_source_issues_match() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/schema-golden.json")).unwrap();
    assert_eq!(
        data["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    assert_eq!(data["cases"].as_array().unwrap().len(), 24158);
    for case in data["cases"].as_array().unwrap() {
        let edits = case
            .get("edit")
            .filter(|v| !v.is_null())
            .map(std::slice::from_ref)
            .unwrap_or(&[]);
        let value = fixture::edited(
            data["seeds"][case["seedId"].as_str().unwrap()].clone(),
            edits,
        );
        let kind: SchemaKind = serde_json::from_value(case["kind"].clone()).unwrap();
        let issues = validate_schema(kind, &value).unwrap();
        common::assert_json_eq(
            &json!({"ok":issues.is_empty(),"issues":issues}),
            &fixture::expected(&data, case),
            case["id"].as_str().unwrap(),
        );
    }
}
