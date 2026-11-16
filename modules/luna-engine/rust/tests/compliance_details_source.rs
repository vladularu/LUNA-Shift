mod common;
#[path = "support/export_time_snapshot.rs"]
mod raw_snapshot;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    compliance::details::calculate_monthly_details,
    runtime::export_report::{ExportTimeError, NativeTimeExportSource},
};
use std::sync::Arc;

#[test]
fn original_details_window_and_month_checks_use_actual_provider_profile_and_order() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/compliance-details-source-golden.json"
    ));
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 696);
    for case in cases {
        let input = &case["input"];
        let ranks = &case["platformCollationRanks"];
        // Only original SQL/recorded entry inputs enter native preparation.
        // The complete original profile is compared below, never deserialized
        // as a Ready source or used as a mathematical input.
        let facts = raw_snapshot::raw_facts(&input["rawSource"], ranks);
        let native = NativeTimeExportSource::from_facts(&facts);
        if case["expected"]["state"] == "PROFILE_MISSING" {
            assert!(matches!(native, Err(ExportTimeError::MissingProfile)));
            continue;
        }
        let native = native.unwrap_or_else(|error| panic!("{}: {error}", case["id"]));
        let profile = native.profile_for_reference();
        common::assert_json_eq(profile, &case["expected"]["profile"], "profile");
        let resolver = facts.catalog().unwrap();
        let actual = calculate_monthly_details(
            input["month"].as_str().unwrap(),
            Arc::new(input["entries"].as_array().unwrap().clone()),
            profile,
            input["epoch"].as_i64().unwrap(),
            input["youthProtection"].as_bool().unwrap(),
            resolver.resolver(),
            Arc::new(serde_json::from_value(ranks.clone()).unwrap()),
        )
        .unwrap_or_else(|error| panic!("{}: {error}", case["id"]));
        for key in ["referenceDate", "window", "compliance"] {
            common::assert_json_eq(
                &actual[key],
                &case["expected"][key],
                &format!("{}.{key}", case["id"]),
            );
        }
    }
}
