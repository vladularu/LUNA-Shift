mod common;
use luna_engine::{
    input::InputError,
    remuneration::{
        context::model::FullNativePackageValidator,
        drk::{from_saved, saved},
    },
    rules::RuleResolver,
};
use serde_json::{Value, json};
fn validation(value: Result<Value, InputError>) -> Value {
    match value {
        Ok(value) => json!({"value":value}),
        Err(error) => json!({"$error":error.message(),"name":error.name()}),
    }
}
#[test]
fn drk_saved_validation_freshness_and_composition_match_original() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/drk-saved-golden.json")).unwrap();
    let ids = serde_json::from_value(data["packageIds"].clone()).unwrap();
    let full=RuleResolver::new(serde_json::from_value(json!({"tariff":data["packages"].as_object().unwrap().values().collect::<Vec<_>>(),"legal":[],"holiday":[]})).unwrap(),ids,None).unwrap();
    let empty = RuleResolver::new(
        serde_json::from_value(json!({"tariff":[],"legal":[],"holiday":[]})).unwrap(),
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
    assert_eq!(data["cases"].as_array().unwrap().len(), 534);
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let resolver = match input["resolverRef"].as_str() {
            Some("empty") => &empty,
            Some("split") => &split,
            _ => &full,
        };
        let actual = match case["operation"].as_str().unwrap() {
            "validateEmployee" => validation(saved::validate_employee(input)),
            "validateTraining" => validation(saved::validate_training(input)),
            "currentEmployee" => {
                json!({"value":saved::is_current_employee(&input["saved"],&input["profile"],input["version"].as_str().unwrap())})
            }
            "currentTraining" => {
                json!({"value":saved::is_current_training(&input["saved"],&input["profile"],&input["training"],input["version"].as_str().unwrap())})
            }
            "employeePackage" => json!({"value":saved::is_employee_package_id(input)}),
            "trainingVariant" => json!({"value":saved::is_training_variant(input)}),
            "employeeSaved" => {
                json!({"value":from_saved::calculate_employee(input["month"].as_str().unwrap(),input["profiles"].as_array().unwrap(),resolver,input["confirmations"].as_array().unwrap(),&FullNativePackageValidator).unwrap()})
            }
            "trainingSaved" => {
                json!({"value":from_saved::calculate_training(input["month"].as_str().unwrap(),input["remunerationProfiles"].as_array().unwrap(),input["trainingProfiles"].as_array().unwrap(),resolver,input["confirmations"].as_array().unwrap(),&FullNativePackageValidator).unwrap()})
            }
            _ => panic!("unknown operation"),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
