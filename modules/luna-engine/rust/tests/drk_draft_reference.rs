mod common;
use luna_engine::{
    remuneration::{
        context::model::FullNativePackageValidator,
        drk::{base, profile},
    },
    rules::{RulePackage, RuleResolver},
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
#[test]
fn drk_employee_and_training_drafts_match_every_original_table_row_and_profile_state() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/drk-draft-golden.json")).unwrap();
    let packages: BTreeMap<String, RulePackage> =
        serde_json::from_value(data["packages"].clone()).unwrap();
    let resolver = RuleResolver::new(
        serde_json::from_value(
            json!({"tariff":data["catalogRefs"].as_array().unwrap().iter().map(|key|&packages[key.as_str().unwrap()]).collect::<Vec<_>>(),"legal":[],"holiday":[]}),
        )
        .unwrap(),
        serde_json::from_value(data["packageIds"].clone()).unwrap(),
        None,
    )
    .unwrap();
    let split = RuleResolver::new(
        serde_json::from_value(data["extraCatalogs"]["split"].clone()).unwrap(),
        serde_json::from_value(data["packageIds"].clone()).unwrap(),
        None,
    )
    .unwrap();
    let empty = RuleResolver::new(
        serde_json::from_value(json!({"tariff":[],"legal":[],"holiday":[]})).unwrap(),
        serde_json::from_value(data["packageIds"].clone()).unwrap(),
        None,
    )
    .unwrap();
    let validator = FullNativePackageValidator;
    assert_eq!(data["cases"].as_array().unwrap().len(), 3513);
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let resolver = match input["resolverRef"].as_str() {
            Some("empty") => &empty,
            Some("split") => &split,
            _ => &resolver,
        };
        let value = match case["operation"].as_str().unwrap() {
            "employeeBase" => base::calculate_employee_table_base(
                &packages[input["packageRef"].as_str().unwrap()],
                input,
                &validator,
            ),
            "trainingBase" => base::calculate_training_table_base(
                &packages[input["packageRef"].as_str().unwrap()],
                input,
                &validator,
            ),
            "employeeProfile" => profile::calculate_employee_from_profile(
                input["month"].as_str().unwrap(),
                input["profiles"].as_array().unwrap(),
                resolver,
                &input["confirmations"],
                &validator,
            ),
            "trainingProfile" => profile::calculate_training_from_profile(
                input["month"].as_str().unwrap(),
                input["remunerationProfiles"].as_array().unwrap(),
                input["trainingProfiles"].as_array().unwrap(),
                resolver,
                &input["confirmations"],
                &validator,
            ),
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
