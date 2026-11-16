mod common;
use luna_engine::{
    calendar::recurrence::CollationRanks, report::time::TimeReportContext, rules::RuleResolver,
};
use serde_json::{Value, json};
use std::sync::Arc;
#[test]
fn independent_time_section_matches_original_complete_annual_report() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/annual-time-golden.json")).unwrap();
    assert!(data["cases"].as_array().unwrap().len() >= 15);
    let resolver = Arc::new(RuleResolver::bundled().unwrap());
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let ranks: CollationRanks =
            serde_json::from_value(input["collationRanks"].clone()).unwrap();
        let result = TimeReportContext::new(
            Arc::new(input["profile"].clone()),
            Arc::new(input["entries"].as_array().unwrap().clone()),
            Arc::clone(&resolver),
            ranks,
        )
        .and_then(|mut c| c.annual(input["year"].as_i64().unwrap() as i32));
        let actual = match result {
            Ok(value) => json!({"value":value}),
            Err(e) => json!({"error":{"name":e.source_error_name(),"message":e.to_string()}}),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}

#[test]
fn complete_50k_target_and_neighbor_year_results_are_reused_without_monthly_copies() {
    use jiff::{ToSpan, civil::Date};
    let start = Date::new(1900, 1, 1).unwrap();
    let days=(0..50_000).map(|index|json!({"date":start.checked_add(index.days()).unwrap().to_string(),"rosterStatus":"FINAL","disposition":"ROSTER_FREE"})).collect::<Vec<_>>();
    let profile = json!({"timeZone":"Europe/Berlin","federalState":"NW","holidayRegion":"NONE","weeklyMinutes":1200,"workingTimeTarget":{"status":"ready","mode":"FORECAST","context":{"periods":[{"validFrom":"1900-01-01","validTo":null,"weeklyMinutes":1200,"federalState":"NW","holidayRegion":"NONE","model":{"kind":"FIXED_WEEK","weekdayMinutes":[240,240,240,240,240,0,0]},"tariff":{"kind":"CUSTOM"}}],"days":days}}});
    let mut context = TimeReportContext::new(
        Arc::new(profile),
        Arc::new(vec![]),
        Arc::new(RuleResolver::bundled().unwrap()),
        CollationRanks::default(),
    )
    .unwrap();
    assert_eq!(context.preparation_stats().input_parses, 0);
    let first = context.annual_shared(2026).unwrap();
    assert_eq!(context.preparation_stats().input_parses, 1);
    assert_eq!(context.preparation_stats().context_preparations, 1);
    context.annual_shared(2027).unwrap();
    let again = context.annual_shared(2026).unwrap();
    assert!(Arc::ptr_eq(&first, &again));
    assert_eq!(context.annual_computations(), 2);
    assert_eq!(context.preparation_stats().input_parses, 1);
    assert_eq!(context.preparation_stats().context_preparations, 1);
    for year in 2030..=2036 {
        context.annual_shared(year).unwrap();
    }
    assert_eq!(context.annual_computations(), 9);
    context.annual_shared(2035).unwrap();
    assert_eq!(context.annual_computations(), 9);
    context.annual_shared(2026).unwrap();
    assert_eq!(context.annual_computations(), 10);
    assert_eq!(context.preparation_stats().input_parses, 1);
    assert_eq!(context.preparation_stats().context_preparations, 1);
    assert!(context.annual_shared(1899).is_err());
    assert!(context.annual_shared(4100).is_err());
}

#[test]
fn monthly_header_basis_cannot_cross_immutable_source_owners() {
    use luna_engine::{
        credit::{
            context::DailyCreditContextCache,
            summary::{self, MonthlySummaryBasis},
        },
        target::PreparedTargetSource,
    };
    let profile = Arc::new(
        json!({"timeZone":"Europe/Berlin","federalState":"NW","holidayRegion":"NONE","weeklyMinutes":1200}),
    );
    let one = PreparedTargetSource::new(Arc::clone(&profile));
    let two = PreparedTargetSource::new(profile);
    let resolver = RuleResolver::bundled().unwrap();
    let mut cache = DailyCreditContextCache::with_source(&one, &resolver);
    let foreign = two.base_profile().unwrap();
    assert!(
        summary::calculate_monthly_summary_prepared_with_basis(
            "2026-07",
            &[],
            &mut cache,
            MonthlySummaryBasis {
                profile: &foreign,
                context: None
            },
            &CollationRanks::default(),
            &[]
        )
        .is_err()
    );
    let own = cache.target_profile_at("2026-07-01").unwrap();
    assert!(
        summary::calculate_monthly_summary_prepared_with_basis(
            "2026-07",
            &[],
            &mut cache,
            MonthlySummaryBasis {
                profile: &own,
                context: None
            },
            &CollationRanks::default(),
            &[]
        )
        .is_ok()
    );
}

#[test]
fn separate_native_calendar_windows_share_one_profile_bound_target_owner() {
    use luna_engine::target::PreparedTargetSource;
    let data: Value =
        serde_json::from_str(include_str!("../../reference/annual-time-golden.json")).unwrap();
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "fixed-target")
        .unwrap();
    let profile = Arc::new(case["input"]["profile"].clone());
    let source = Arc::new(PreparedTargetSource::new(Arc::clone(&profile)));
    let resolver = Arc::new(RuleResolver::bundled().unwrap());
    let mut one = TimeReportContext::with_source(
        Arc::clone(&profile),
        Arc::clone(&source),
        Arc::new(vec![]),
        Arc::clone(&resolver),
        CollationRanks::default(),
    )
    .unwrap();
    let mut two = TimeReportContext::with_source(
        Arc::clone(&profile),
        Arc::clone(&source),
        Arc::new(vec![]),
        Arc::clone(&resolver),
        CollationRanks::default(),
    )
    .unwrap();
    one.annual_shared(2026).unwrap();
    two.annual_shared(2027).unwrap();
    assert_eq!(source.stats().input_parses, 1);
    assert_eq!(source.stats().context_preparations, 1);
    assert!(
        TimeReportContext::with_source(
            Arc::new(profile.as_ref().clone()),
            source,
            Arc::new(vec![]),
            resolver,
            CollationRanks::default()
        )
        .is_err()
    );
}
