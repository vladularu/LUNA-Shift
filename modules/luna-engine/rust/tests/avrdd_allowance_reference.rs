mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    remuneration::{avrdd, context::model::FullNativePackageValidator},
    rules::RulePackage,
};
use serde_json::json;
#[test]
fn avrdd_base_care_and_shift_drafts_match_original() {
    let data = value_pool::decode(include_str!("../../reference/avrdd-allowance-golden.json"));
    let packages: std::collections::BTreeMap<String, RulePackage> =
        serde_json::from_value(data["packages"].clone()).unwrap();
    let cases = data["cases"].as_array().unwrap();
    assert!(cases.len() > 1500);
    for c in cases {
        let input = &c["input"];
        let p = &packages[input["packageRef"].as_str().unwrap()];
        let result = match c["operation"].as_str().unwrap() {
            "base" => avrdd::base(p, input, &FullNativePackageValidator),
            "care" => avrdd::care(p, input, &FullNativePackageValidator),
            "shift" => avrdd::shift(p, input, &FullNativePackageValidator),
            _ => panic!("operation"),
        };
        let actual = match result {
            Ok(v) => json!({"value":v}),
            Err(e) => json!({"$error":e.to_string(),"name":"Error"}),
        };
        common::assert_json_eq(&actual, &c["expected"], c["id"].as_str().unwrap());
    }
}
