mod common;
use luna_engine::{
    pay::legacy,
    rules::{PackageIds, RuleResolver},
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
#[test]
fn legacy_shift_amounts_and_priced_trace_share_exact_frozen_results() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/legacy-pay-golden.json")).unwrap();
    assert_eq!(
        data["baselineDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let mut resolvers = BTreeMap::new();
    for data in data["resolvers"].as_array().unwrap() {
        let ids: PackageIds = serde_json::from_value(data["packageIds"].clone()).unwrap();
        resolvers.insert(
            data["id"].as_str().unwrap(),
            RuleResolver::from_catalog_json(data["catalog"].clone(), ids, None).unwrap(),
        );
    }
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 426);
    for case in cases {
        let input = &case["input"];
        let resolver = resolvers.get(input["resolver"].as_str().unwrap()).unwrap();
        let result =
            legacy::calculate_shift_for_profile(&input["shift"], &input["profile"], resolver)
                .and_then(|breakdown| {
                    legacy::calculate_shift_premium_trace_for_profile(
                        &input["shift"],
                        &input["profile"],
                        resolver,
                    )
                    .map(|trace| json!({"breakdown":breakdown,"trace":trace}))
                });
        let actual = match result {
            Ok(value) => value,
            Err(error) => json!({"$error":{"name":"Error","message":error.to_string()}}),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
