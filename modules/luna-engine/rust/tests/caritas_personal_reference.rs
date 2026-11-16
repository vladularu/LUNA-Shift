mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    remuneration::{
        caritas::{personal_allowances, personal_base, personal_cash},
        context::model::FullNativePackageValidator,
    },
    rules::RulePackage,
};
use serde_json::json;
use std::collections::BTreeMap;
#[test]
fn caritas_personal_components_match_original_and_retain_explicit_claim_boundaries() {
    let data = value_pool::decode(include_str!("../../reference/caritas-personal-golden.json"));
    assert_eq!(data["cases"].as_array().unwrap().len(), 37749);
    let packages: BTreeMap<String, RulePackage> =
        serde_json::from_value(data["packages"].clone()).unwrap();
    let validator = FullNativePackageValidator;
    for case in data["cases"].as_array().unwrap() {
        let x = &case["input"];
        let pkg = &packages[x["packageRef"].as_str().unwrap()];
        let result = match case["operation"].as_str().unwrap() {
            "base" => personal_base::calculate(pkg, x, &validator),
            "originalBase" => personal_base::calculate_original(pkg, x, &validator),
            "legacyAllowance" => personal_allowances::legacy_dynamic(pkg, x, &validator),
            "legacyFixed" => personal_allowances::legacy_fixed(pkg, x, &validator),
            "personalAllowance" => personal_allowances::care(pkg, x, &validator),
            "monthlyShift" => personal_allowances::monthly_shift(pkg, x, &validator),
            "hourlyShift" => personal_allowances::hourly_shift(pkg, x, &validator),
            "timeCash" => personal_cash::time_premium(pkg, x, &validator),
            "overtimeCash" => personal_cash::overtime(pkg, x, &validator),
            _ => panic!("unknown operation"),
        };
        let actual = match result {
            Ok(value) => json!({"value":value}),
            Err(error) => json!({"$error":error.to_string(),"name":"Error"}),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
