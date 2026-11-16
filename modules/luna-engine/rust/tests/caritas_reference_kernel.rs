mod common;
use luna_engine::{
    remuneration::{
        caritas::{lookup, overtime, rates, reference},
        context::model::FullNativePackageValidator,
    },
    rules::RulePackage,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
#[test]
fn all_caritas_reference_lookups_and_rounding_match_original() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/caritas-reference-kernel-golden.json"
    ))
    .unwrap();
    let packages: BTreeMap<String, RulePackage> =
        serde_json::from_value(data["packages"].clone()).unwrap();
    let validator = FullNativePackageValidator;
    assert_eq!(data["cases"].as_array().unwrap().len(), 11208);
    for case in data["cases"].as_array().unwrap() {
        let x = &case["input"];
        let pkg = &packages[x["packageRef"].as_str().unwrap()];
        let date = x["date"].as_str().unwrap();
        let variant = x["variantId"].as_str().unwrap();
        let region = x["regionId"].as_str().unwrap();
        let group = x["groupId"].as_str().unwrap();
        let step = x["stepId"].as_str().unwrap();
        let value = match case["operation"].as_str().unwrap() {
            "table" => lookup::care_table(pkg, date, variant, region, group, step, &validator),
            "weekly" => lookup::full_time_weekly_minutes(pkg, date, variant, region, &validator),
            "careRate" => rates::care_allowance(
                pkg,
                date,
                variant,
                region,
                x["provisionId"].as_str().unwrap(),
                &validator,
            ),
            "shiftRate" => rates::shift_allowance(pkg, date, variant, region, &validator),
            "timeRate" => rates::time_premium(pkg, date, variant, region, &validator),
            "premiumReference" => {
                reference::time_premium(pkg, date, variant, region, group, &validator)
            }
            "ratio" => reference::hourly_ratio(pkg, date, variant, region, group, &validator),
            "hourly" => reference::hourly_values(pkg, date, variant, region, group, &validator),
            "overtimeBase" => {
                overtime::hourly_base(pkg, date, variant, region, group, step, &validator)
            }
            "overtimePremium" => {
                overtime::hourly_premium(pkg, date, variant, region, group, &validator)
            }
            "overtimeValues" => {
                overtime::hourly_values(pkg, date, variant, region, group, step, &validator)
            }
            _ => panic!("unknown operation"),
        }
        .unwrap();
        common::assert_json_eq(
            &json!({"value":value}),
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
}
