use jiff::{ToSpan, civil::Date};
use luna_engine::{
    calendar::recurrence::CollationRanks,
    credit::{analysis, context::DailyCreditContextCache, metrics, summary},
    rules::RuleResolver,
    target::{PreparedTargetContext, PreparedTargetSource, TargetContext, TargetError},
};
use serde_json::{Value, json};
use std::sync::Arc;
fn large_profile() -> Value {
    let first = Date::new(1900, 1, 1).unwrap();
    let days=(0..50_000).map(|i|json!({"date":first.checked_add(i.days()).unwrap().to_string(),"rosterStatus":"FINAL","disposition":"ROSTER_FREE"})).collect::<Vec<_>>();
    json!({"federalState":"NW","holidayRegion":"NONE","weeklyMinutes":1200,"timeZone":"Europe/Berlin","workingTimeTarget":{"status":"ready","mode":"FORECAST","notices":[],"context":{"periods":[{"validFrom":"1900-01-01","validTo":null,"weeklyMinutes":1200,"federalState":"NW","holidayRegion":"NONE","model":{"kind":"FIXED_WEEK","weekdayMinutes":[240,240,240,240,240,0,0]},"tariff":{"kind":"CUSTOM"}}],"days":days}}})
}
#[test]
fn one_immutable_source_parses_its_complete_50k_target_only_once_for_all_month_profiles() {
    let source = PreparedTargetSource::new(Arc::new(large_profile()));
    assert_eq!(source.stats().input_parses, 0);
    let profiles = (0..12)
        .map(|_| source.base_profile().unwrap())
        .collect::<Vec<_>>();
    assert!(profiles.iter().all(|p| {
        p.profile()
            .working_time_target
            .as_ref()
            .unwrap()
            .context
            .as_ref()
            .unwrap()
            .days
            .len()
            == 50_000
    }));
    assert_eq!(
        source.stats().input_parses,
        1,
        "All months must share one actual typed deserialization, without dropping any original day facts"
    );
    assert!(profiles.iter().all(|p| p.shares_input_with(&profiles[0])));
    let resolver = RuleResolver::bundled().unwrap();
    let ranks: CollationRanks = serde_json::from_value(json!({})).unwrap();
    let mut cache = DailyCreditContextCache::with_source(&source, &resolver);
    for month in 1..=12 {
        let month = format!("2026-{month:02}");
        let summary =
            summary::calculate_monthly_summary_prepared(&month, &[], &mut cache, None, &ranks)
                .unwrap();
        let series =
            metrics::monthly_hours_series_prepared(&month, &[], &mut cache, &ranks).unwrap();
        assert_eq!(
            summary["targetMinutes"].as_i64().unwrap(),
            series
                .as_array()
                .unwrap()
                .iter()
                .map(|p| p["targetMinutes"].as_f64().unwrap() as i64)
                .sum::<i64>()
        );
        analysis::monthly_shift_type_analysis_prepared(&month, &[], &mut cache, &ranks).unwrap();
    }
    assert_eq!(cache.cached_basis_count(), 12);
    assert_eq!(source.stats().input_parses, 1);
    assert_eq!(
        source.stats().context_preparations,
        1,
        "All report views must share the single full-context validation and day index"
    );
    // New request/month-result caches still share immutable preparation.
    let mut second = DailyCreditContextCache::with_source(&source, &resolver);
    second.resolve("2026-07-10").unwrap();
    assert_eq!(source.stats().context_preparations, 1);
    assert_eq!(second.cached_basis_count(), 1);
}

fn small_profile() -> Value {
    json!({"federalState":"NW","holidayRegion":"NONE","weeklyMinutes":1200,"timeZone":"Europe/Berlin","workingTimeTarget":{"status":"ready","mode":"FORECAST","notices":[],"context":{"periods":[{"validFrom":"2026-01-01","validTo":null,"weeklyMinutes":1200,"federalState":"NW","holidayRegion":"NONE","model":{"kind":"FIXED_WEEK","weekdayMinutes":[240,240,240,240,240,0,0]},"tariff":{"kind":"CUSTOM"}}],"days":[]}}})
}
fn target_context(profile: &Value) -> TargetContext {
    serde_json::from_value(profile["workingTimeTarget"]["context"].clone()).unwrap()
}
#[test]
fn readiness_and_request_guards_precede_context_validation_and_cached_results() {
    let resolver = RuleResolver::bundled().unwrap();
    for (status, error) in [
        ("loading", TargetError::Loading),
        ("error", TargetError::ReadError),
    ] {
        let mut profile = small_profile();
        profile["workingTimeTarget"]["status"] = json!(status);
        // Typed shape is valid, business validation is deliberately invalid.
        profile["workingTimeTarget"]["context"]["periods"][0]["weeklyMinutes"] = json!(-1);
        let source = PreparedTargetSource::new(Arc::new(profile));
        let prepared = source.base_profile().unwrap();
        for _ in 0..2 {
            assert_eq!(
                prepared
                    .calculate("bad-month", &resolver, None)
                    .unwrap_err(),
                error
            );
        }
        assert_eq!(source.stats().input_parses, 1);
        assert_eq!(source.stats().context_preparations, 0);
    }
    let source = PreparedTargetSource::new(Arc::new(small_profile()));
    let mut cache = DailyCreditContextCache::with_source(&source, &resolver);
    cache.base_monthly_target("2026-07", None).unwrap();
    assert!(cache.base_monthly_target("2026-13", None).is_err());
    assert_eq!(cache.cached_basis_count(), 1);
    assert_eq!(source.stats().context_preparations, 1);
}
#[test]
fn invalid_context_is_validated_once_and_never_becomes_a_ready_zero_result() {
    let resolver = RuleResolver::bundled().unwrap();
    let mut profile = small_profile();
    profile["workingTimeTarget"]["context"]["days"] = json!([
        {"date":"2026-07-01","rosterStatus":"FINAL","disposition":"ROSTER_FREE"},
        {"date":"2026-07-01","rosterStatus":"FINAL","disposition":"ROSTER_FREE"}
    ]);
    let source = PreparedTargetSource::new(Arc::new(profile));
    let mut cache = DailyCreditContextCache::with_source(&source, &resolver);
    for month in ["2026-07", "2026-08", "2026-07"] {
        assert!(cache.base_monthly_target(month, None).is_err());
    }
    assert_eq!(cache.cached_basis_count(), 0);
    assert_eq!(source.stats().input_parses, 1);
    assert_eq!(source.stats().context_preparations, 1);
}
#[test]
fn owned_overrides_and_replacement_sources_cannot_reuse_stale_contexts() {
    let resolver = RuleResolver::bundled().unwrap();
    let original = small_profile();
    let first = PreparedTargetContext::new(Arc::new(target_context(&original)));
    let first_clone = first.clone();
    let mut changed = original.clone();
    changed["workingTimeTarget"]["context"]["periods"][0]["weeklyMinutes"] = json!(1800);
    changed["workingTimeTarget"]["context"]["periods"][0]["model"]["weekdayMinutes"] =
        json!([360, 360, 360, 360, 360, 0, 0]);
    let second = PreparedTargetContext::new(Arc::new(target_context(&changed)));
    let source = PreparedTargetSource::new(Arc::new(original));
    let replacement = PreparedTargetSource::new(Arc::new(changed));
    assert!(
        !source
            .base_profile()
            .unwrap()
            .shares_input_with(&replacement.base_profile().unwrap())
    );
    let mut cache = DailyCreditContextCache::with_source(&source, &resolver);
    let a = cache.base_monthly_target("2026-07", Some(&first)).unwrap();
    let b = cache
        .base_monthly_target("2026-07", Some(&first_clone))
        .unwrap();
    assert!(Arc::ptr_eq(&a, &b));
    let c = cache.base_monthly_target("2026-07", Some(&second)).unwrap();
    assert_ne!(a.target_minutes, c.target_minutes);
    assert_eq!(cache.cached_basis_count(), 2);
    assert_eq!(first.stats().context_preparations, 1);
    assert_eq!(second.stats().context_preparations, 1);
    assert_eq!(
        source.stats().context_preparations,
        0,
        "Explicit overrides must not validate or index an unused default context"
    );
    let mut next = DailyCreditContextCache::with_source(&replacement, &resolver);
    assert_eq!(
        next.base_monthly_target("2026-07", None)
            .unwrap()
            .target_minutes,
        c.target_minutes
    );
    assert_eq!(replacement.stats().context_preparations, 1);
}
#[test]
fn dated_timezone_changes_share_input_but_null_and_error_overlays_keep_their_semantics() {
    let resolver = RuleResolver::bundled().unwrap();
    let mut profile = small_profile();
    profile["employmentTimeline"] = json!([
        {"effectiveFrom":"2026-01-01","employment":{"timeZone":"Europe/Berlin"}},
        {"effectiveFrom":"2026-07-10","employment":{"timeZone":"Etc/UTC"}},
        {"effectiveFrom":"2026-07-20","employment":{"weeklyMinutes":1800,"workingTimeTarget":null}},
        {"effectiveFrom":"2026-07-25","employment":{"workingTimeTarget":{"status":"error","notices":[]}}}
    ]);
    let source = PreparedTargetSource::new(Arc::new(profile));
    let mut cache = DailyCreditContextCache::with_source(&source, &resolver);
    assert_eq!(
        cache.resolve("2026-07-01").unwrap().time_zone,
        "Europe/Berlin"
    );
    assert_eq!(cache.resolve("2026-07-10").unwrap().time_zone, "Etc/UTC");
    assert_eq!(cache.cached_basis_count(), 1);
    assert_eq!(
        cache
            .resolve("2026-07-20")
            .unwrap()
            .context
            .target_minutes
            .to_string(),
        "360"
    );
    assert_eq!(cache.cached_basis_count(), 2);
    assert!(matches!(
        cache.resolve("2026-07-27"),
        Err(luna_engine::credit::context::DailyCreditError::Target(
            TargetError::ReadError
        ))
    ));
    assert_eq!(cache.cached_basis_count(), 2);
    assert_eq!(source.stats().input_parses, 2);
    assert_eq!(source.stats().context_preparations, 1);
}
#[test]
fn simultaneous_source_consumers_share_one_typed_input() {
    let source = Arc::new(PreparedTargetSource::new(Arc::new(small_profile())));
    let threads = (0..8)
        .map(|_| {
            let source = Arc::clone(&source);
            std::thread::spawn(move || source.base_profile().unwrap())
        })
        .collect::<Vec<_>>();
    let profiles = threads
        .into_iter()
        .map(|t| t.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(source.stats().input_parses, 1);
    assert!(profiles.iter().all(|p| p.shares_input_with(&profiles[0])));
}
