use luna_engine::rules::{
    RulePackage,
    validation::{package_validation_issues, validate_rule_package},
};
use serde_json::{Value, json};
use std::sync::Arc;
fn legal() -> Value {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/rule-validation-golden.json")).unwrap();
    data["seeds"]["example-legal"].clone()
}
#[test]
fn validation_cache_is_bound_to_this_body_and_guards_modified_public_headers() {
    let value = legal();
    let package: RulePackage = serde_json::from_value(value.clone()).unwrap();
    let first = package_validation_issues(&package).unwrap();
    assert!(first.is_empty());
    let again = package_validation_issues(&package).unwrap();
    assert!(Arc::ptr_eq(&first, &again));
    let mut changed = package.clone();
    changed.engine_contract_version = 3;
    assert!(!package_validation_issues(&changed).unwrap().is_empty());
    assert!(package_validation_issues(&package).unwrap().is_empty());
    let mut different_body = value;
    different_body["rules"]["workingTime"]["maxDailyMinutes"] =
        different_body["rules"]["workingTime"]["standardDailyMinutes"].clone();
    let different: RulePackage = serde_json::from_value(different_body).unwrap();
    assert_eq!(different.package_id, package.package_id);
    assert_eq!(different.version_id, package.version_id);
    assert!(!package_validation_issues(&different).unwrap().is_empty());
}
#[test]
fn schema_integer_lexemes_remain_valid_in_native_typed_catalogs() {
    let mut value = legal();
    value["engineContractVersion"] = json!(1.0);
    value["rules"]["workingTime"]["standardDailyMinutes"] = json!(480.0);
    assert!(validate_rule_package(&value).unwrap().is_empty());
    let package: RulePackage = serde_json::from_value(value).unwrap();
    assert_eq!(package.engine_contract_version, 1);
    assert_eq!(
        package.rules()["workingTime"]["standardDailyMinutes"].as_i64(),
        Some(480)
    );
    assert!(package_validation_issues(&package).unwrap().is_empty());
}
