mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    remuneration::{caritas::flow, context::model::FullNativePackageValidator},
    rules::{RulePackage, RuleResolver},
};
use serde_json::json;
#[test]
fn caritas_raw_work_saved_catalog_and_entitlements_match_original() {
    let data = value_pool::decode(include_str!(
        "../../reference/caritas-month-flow-golden.json"
    ));
    let packages: std::collections::BTreeMap<String, RulePackage> =
        serde_json::from_value(data["packages"].clone()).unwrap();
    let bundled = RuleResolver::bundled().unwrap();
    let full = RuleResolver::new(
        serde_json::from_value(data["fullCatalog"].clone()).unwrap(),
        bundled.default_package_ids().clone(),
        None,
    )
    .unwrap();
    let empty = RuleResolver::new(
        serde_json::from_value(json!({"tariff":[],"legal":[],"holiday":[]})).unwrap(),
        bundled.default_package_ids().clone(),
        None,
    )
    .unwrap();
    let preview = RuleResolver::new(
        serde_json::from_value(data["resolverData"]["catalog"].clone()).unwrap(),
        serde_json::from_value(data["resolverData"]["packageIds"].clone()).unwrap(),
        Some(serde_json::from_value(data["resolverData"]["historical"].clone()).unwrap()),
    )
    .unwrap();
    let equal = RuleResolver::new(
        serde_json::from_value(data["resolverData"]["catalog"].clone()).unwrap(),
        serde_json::from_value(data["resolverData"]["packageIds"].clone()).unwrap(),
        Some(serde_json::from_value(data["resolverData"]["historical"].clone()).unwrap()),
    )
    .unwrap();
    let reviewed_full = RuleResolver::new(
        serde_json::from_value(data["fullCatalog"].clone()).unwrap(),
        serde_json::from_value(data["resolverData"]["packageIds"].clone()).unwrap(),
        Some(serde_json::from_value(data["resolverData"]["historical"].clone()).unwrap()),
    )
    .unwrap();
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 8529);
    let mut catalog_successes = 0;
    for case in cases {
        let input = &case["input"];
        let resolver = match input["resolverRef"].as_str() {
            Some("full") => &full,
            Some("empty") => &empty,
            Some("preview") => &preview,
            Some("equalCustom") => &equal,
            Some("reviewedFull") => &reviewed_full,
            _ => &bundled,
        };
        let result = if case["operation"] == "entitlements" {
            flow::derive_entitlements(
                input["month"].as_str().unwrap(),
                input["profiles"].as_array().unwrap(),
                input["savedMonths"].as_array().unwrap(),
            )
        } else {
            let pkg = &packages[input["packageRef"].as_str().unwrap()];
            match case["operation"].as_str().unwrap() {
                "month" => flow::calculate_month(pkg, input, &FullNativePackageValidator),
                "saved" => flow::from_saved(pkg, input, resolver, &FullNativePackageValidator),
                "persisted" => {
                    flow::from_persisted(pkg, input, resolver, &FullNativePackageValidator)
                }
                "stored" => flow::from_stored(pkg, input, resolver, &FullNativePackageValidator),
                "catalog" => flow::from_catalog(input, resolver, &FullNativePackageValidator),
                _ => panic!("unknown operation"),
            }
        };
        let actual = match result {
            Ok(value) => json!({"value":value}),
            Err(e) => json!({"$error":e.to_string(),"name":e.name()}),
        };
        if case["operation"] == "catalog" && actual["value"]["kind"] == "draft-known-subtotal" {
            catalog_successes += 1;
        }
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        if case["operation"] == "catalog" {
            let result = flow::from_catalog_sources(
                &flow::CatalogMonthSources {
                    month: input["month"].as_str().unwrap(),
                    work_profile: &input["workProfile"],
                    shifts: input["shifts"].as_array().unwrap(),
                    pause_details: input["pauseDetails"].as_array().unwrap(),
                    entries_complete: input["entriesComplete"].as_bool().unwrap(),
                    shift_entitlements: input["shiftEntitlements"].as_array().unwrap(),
                    work_day_confirmations: input["workDayConfirmations"].as_array().unwrap(),
                    remuneration_profiles: input["remunerationProfiles"].as_array().unwrap(),
                    month_facts: input["monthFacts"].as_array().unwrap(),
                },
                resolver,
                &FullNativePackageValidator,
            );
            let borrowed = match result {
                Ok(v) => json!({"value":v}),
                Err(e) => json!({"$error":e.to_string(),"name":e.name()}),
            };
            common::assert_json_eq(&borrowed, &case["expected"], case["id"].as_str().unwrap());
        }
    }
    assert!(catalog_successes > 0);
}
