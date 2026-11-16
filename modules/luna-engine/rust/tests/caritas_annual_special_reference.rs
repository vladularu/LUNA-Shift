mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    remuneration::{caritas::annual, context::model::FullNativePackageValidator},
    rules::RulePackage,
};
use serde_json::json;
#[test]
fn caritas_annual_late_early_and_parental_cases_match_original() {
    let data = value_pool::decode(include_str!(
        "../../reference/caritas-annual-special-golden.json"
    ));
    let packages: std::collections::BTreeMap<String, RulePackage> =
        serde_json::from_value(data["packages"].clone()).unwrap();
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 1112);
    let mut positives = std::collections::BTreeSet::new();
    for case in cases {
        let input = &case["input"];
        let pkg = &packages[input["packageRef"].as_str().unwrap()];
        let result = match case["operation"].as_str().unwrap() {
            "lateBasis" => annual::late_basis(pkg, input, &FullNativePackageValidator),
            "lateAssessment" => annual::late_assessment(pkg, input, &FullNativePackageValidator),
            "early" => annual::early_exit_amount(pkg, input, &FullNativePackageValidator),
            "parental" => annual::parental_amount(pkg, input, &FullNativePackageValidator),
            _ => panic!("unknown operation"),
        }
        .unwrap();
        if result["kind"] != "unavailable" {
            positives.insert(case["operation"].as_str().unwrap());
        }
        common::assert_json_eq(
            &json!({"value":result}),
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
    assert_eq!(positives.len(), 4);
}
