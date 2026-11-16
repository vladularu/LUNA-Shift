mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    remuneration::{caritas::annual, context::model::FullNativePackageValidator},
    rules::RulePackage,
};
use serde_json::json;
#[test]
fn caritas_partial_fallback_annual_basis_and_amounts_match_original() {
    let data = value_pool::decode(include_str!(
        "../../reference/caritas-annual-partial-golden.json"
    ));
    let packages: std::collections::BTreeMap<String, RulePackage> =
        serde_json::from_value(data["packages"].clone()).unwrap();
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 2972);
    let mut partial_successes = 0;
    let mut fallback_successes = 0;
    for case in cases {
        let input = &case["input"];
        let pkg = &packages[input["packageRef"].as_str().unwrap()];
        let result = match case["operation"].as_str().unwrap() {
            "partialBasis" => annual::partial_basis(pkg, input, &FullNativePackageValidator),
            "partialAmount" => annual::partial_amount(pkg, input, &FullNativePackageValidator),
            "fallbackBasis" => annual::fallback_basis(pkg, input, &FullNativePackageValidator),
            "fallbackAmount" => annual::fallback_amount(pkg, input, &FullNativePackageValidator),
            _ => panic!("unknown operation"),
        }
        .unwrap();
        if result["kind"] == "personal-annual-payment-partial-amount" {
            partial_successes += 1;
        }
        if result["kind"] == "personal-annual-payment-fallback-amount" {
            fallback_successes += 1;
        }
        common::assert_json_eq(
            &json!({"value":result}),
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
    assert!(partial_successes > 10 && fallback_successes > 10);
}
