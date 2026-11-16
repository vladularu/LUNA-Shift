mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    remuneration::{caritas::annual, context::model::FullNativePackageValidator},
    rules::RulePackage,
};
use serde_json::json;
#[test]
fn caritas_annual_rule_entitlement_regular_basis_and_exact_rounding_match_original() {
    let data = value_pool::decode(include_str!(
        "../../reference/caritas-annual-core-golden.json"
    ));
    let packages: std::collections::BTreeMap<String, RulePackage> =
        serde_json::from_value(data["packages"].clone()).unwrap();
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 6919);
    for case in cases {
        let input = &case["input"];
        let pkg = &packages[input["packageRef"].as_str().unwrap()];
        let result = match case["operation"].as_str().unwrap() {
            "rule" => annual::lookup_rule(pkg, input, &FullNativePackageValidator),
            "entitlement" => annual::assess_entitlement(pkg, input, &FullNativePackageValidator),
            "basis" => annual::regular_basis(pkg, input, &FullNativePackageValidator),
            "amount" => annual::regular_amount(pkg, input, &FullNativePackageValidator),
            "round" => annual::round_amount(
                pkg,
                &input["entitlementYear"],
                &input["basis"],
                &input["factor"],
            ),
            _ => panic!("unknown operation"),
        };
        let actual = json!({"value":result.unwrap()});
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
