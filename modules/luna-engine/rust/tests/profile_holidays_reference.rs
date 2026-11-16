mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    employment::EmploymentError,
    rules::{
        HistoricalCatalog, PackageIds, RuleResolver,
        profile_holidays::{ProfileHolidayError, resolve_profile_holiday_map_for_month},
    },
};
use serde_json::json;
use std::collections::BTreeMap;
#[test]
fn full_profile_holiday_maps_and_first_failures_match_original() {
    let golden = value_pool::decode(include_str!("../../reference/profile-holidays-golden.json"));
    let mut resolvers = BTreeMap::new();
    for row in golden["resolvers"].as_array().unwrap() {
        let ids: PackageIds = serde_json::from_value(row["packageIds"].clone()).unwrap();
        let historical: Option<HistoricalCatalog> = row
            .get("historical")
            .map(|v| serde_json::from_value(v.clone()).unwrap());
        let resolver = RuleResolver::from_catalog_json(row["catalog"].clone(), ids, historical)
            .unwrap()
            .with_collation_ranks(serde_json::from_value(row["collationRanks"].clone()).unwrap());
        resolvers.insert(row["id"].as_str().unwrap(), resolver);
    }
    let cases = golden["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 3509);
    let mut partial = 0;
    for case in cases {
        let result = resolve_profile_holiday_map_for_month(
            case["month"].as_str().unwrap(),
            &case["profile"],
            &resolvers[case["resolver"].as_str().unwrap()],
        );
        let actual = match result {
            Ok(result) => {
                if result.status == "UNAVAILABLE" && !result.holidays.is_empty() {
                    partial += 1;
                }
                json!({"value":{"status":result.status,"holidays":{"$type":"Map","entries":result.holidays.into_iter().collect::<Vec<_>>()} ,"failure":result.failure}})
            }
            Err(ProfileHolidayError::Employment(EmploymentError::AmbiguousHistory)) => {
                json!({"error":{"name":"RemunerationProfileError","message":EmploymentError::AmbiguousHistory.to_string()}})
            }
            Err(error) => panic!("unexpected {error}: {}", case["id"]),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
    assert_eq!(partial, 8);
}
#[test]
fn holiday_views_do_not_require_or_parse_large_working_target_contexts() {
    let resolver = RuleResolver::bundled().unwrap();
    let base = json!({"federalState":"NW","holidayRegion":"NONE"});
    let mut large = base.clone();
    // Deliberately not a target schema: holiday selection has no target input.
    large["workingTimeTarget"] =
        json!({"unrelatedFacts":vec![json!({"id":"fact","minutes":480});50_000]});
    let owner = std::sync::Arc::new(large);
    for month in 1..=12 {
        let month = format!("2026-{month:02}");
        let expected = resolve_profile_holiday_map_for_month(&month, &base, &resolver).unwrap();
        let actual = resolve_profile_holiday_map_for_month(&month, &owner, &resolver).unwrap();
        assert_eq!(
            serde_json::to_value(actual).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
    }
    assert_eq!(
        owner["workingTimeTarget"]["unrelatedFacts"]
            .as_array()
            .unwrap()
            .len(),
        50_000
    );
}
