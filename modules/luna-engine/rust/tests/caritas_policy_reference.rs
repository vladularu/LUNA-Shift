mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    remuneration::{
        caritas::policy::{overtime, shift, time},
        context::model::FullNativePackageValidator,
    },
    rules::RulePackage,
};
use serde_json::json;
use std::collections::BTreeMap;
#[test]
fn caritas_policy_periods_minute_buckets_and_settlements_match_original() {
    let data = value_pool::decode(include_str!("../../reference/caritas-policy-golden.json"));
    assert_eq!(data["cases"].as_array().unwrap().len(), 17834);
    let packages: BTreeMap<String, RulePackage> =
        serde_json::from_value(data["packages"].clone()).unwrap();
    let validator = FullNativePackageValidator;
    for case in data["cases"].as_array().unwrap() {
        let x = &case["input"];
        let pkg = &packages[x["packageRef"].as_str().unwrap()];
        let result = match case["operation"].as_str().unwrap() {
            "shift" => shift::calculate(pkg, x, &validator),
            "time" => time::calculate(pkg, x, &validator),
            "overtime" => overtime::calculate(pkg, x, &validator),
            _ => panic!("unknown operation"),
        };
        let actual = match result {
            Ok(value) => json!({"value":value}),
            Err(error) => json!({"$error":error.to_string(),"name":"Error"}),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
