mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    remuneration::{base::BaseError, caritas::monthly, context::model::FullNativePackageValidator},
    rules::RulePackage,
};
use serde_json::json;
#[test]
fn caritas_monthly_compositions_match_original_complete_outputs() {
    let data = value_pool::decode(include_str!("../../reference/caritas-monthly-golden.json"));
    let packages: std::collections::BTreeMap<String, RulePackage> =
        serde_json::from_value(data["packages"].clone()).unwrap();
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 7429);
    let mut malformed_rejections = 0;
    for case in cases {
        let input = &case["input"];
        let pkg = &packages[input["packageRef"].as_str().unwrap()];
        let result = match case["operation"].as_str().unwrap() {
            "components" => monthly::components(pkg, input, &FullNativePackageValidator),
            "shift" => monthly::with_shift(pkg, input, &FullNativePackageValidator),
            "hourly" => monthly::with_hourly(pkg, input, &FullNativePackageValidator),
            "time" => monthly::with_time(pkg, input, &FullNativePackageValidator),
            "overtime" => monthly::with_overtime(pkg, input, &FullNativePackageValidator),
            "composition" => monthly::composition(pkg, input, &FullNativePackageValidator),
            _ => panic!("unknown operation"),
        };
        if case["expected"]["$error"].is_string() {
            assert_eq!(case["expected"]["name"], "TypeError");
            assert_eq!(result, Err(BaseError::InvalidCalculation), "{}", case["id"]);
            malformed_rejections += 1;
        } else {
            let actual = json!({"value":result.unwrap()});
            common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        }
    }
    assert_eq!(malformed_rejections, 5);
}
