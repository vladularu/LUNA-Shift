mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    credit::context::{DailyCreditContextCache, DailyCreditError},
    employment::EmploymentError,
    report::export_rows::{
        ReportEntryError, report_entries, report_entries_from_refs,
        report_entries_from_refs_bounded,
    },
    rules::{HistoricalCatalog, PackageIds, RuleResolver},
    target::PreparedTargetSource,
};
use serde_json::json;
use std::{collections::BTreeMap, sync::Arc};
#[test]
fn complete_original_readable_report_rows_match_native_shared_credit_sources() {
    let fixture = value_pool::decode(include_str!("../../reference/export-rows-golden.json"));
    let mut resolvers = BTreeMap::new();
    for row in fixture["resolvers"].as_array().unwrap() {
        let ids: PackageIds = serde_json::from_value(row["packageIds"].clone()).unwrap();
        let history: Option<HistoricalCatalog> = row
            .get("historical")
            .map(|v| serde_json::from_value(v.clone()).unwrap());
        let resolver = RuleResolver::from_catalog_json(row["catalog"].clone(), ids, history)
            .unwrap()
            .with_collation_ranks(serde_json::from_value(row["collationRanks"].clone()).unwrap());
        resolvers.insert(row["id"].as_str().unwrap(), resolver);
    }
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 910);
    for case in cases {
        let profile = Arc::new(case["profile"].clone());
        let source = PreparedTargetSource::new(Arc::clone(&profile));
        let mut cache = DailyCreditContextCache::with_source(
            &source,
            &resolvers[case["resolver"].as_str().unwrap()],
        );
        let ranks = serde_json::from_value(case["platformCollationRanks"].clone()).unwrap();
        let capture = |result| match result {
            Ok(value) => json!({"value":value}),
            Err(ReportEntryError::Credit(DailyCreditError::Employment(
                EmploymentError::AmbiguousHistory,
            ))) => {
                json!({"error":{"name":"RemunerationProfileError","message":EmploymentError::AmbiguousHistory.to_string()}})
            }
            Err(error) => panic!("unexpected {error}: {}", case["id"]),
        };
        let entries = case["entries"].as_array().unwrap();
        let actual = capture(report_entries(entries, &mut cache, &ranks));
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        let before = cache.preparation_stats();
        let borrowed = entries.iter().collect::<Vec<_>>();
        let actual = capture(report_entries_from_refs(&borrowed, &mut cache, &ranks));
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        let after = cache.preparation_stats();
        assert_eq!(before.input_parses, after.input_parses);
        assert_eq!(before.context_preparations, after.context_preparations);
        let actual = capture(report_entries_from_refs_bounded(
            &borrowed, &mut cache, &ranks, 100_000,
        ));
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
#[test]
fn fifty_thousand_borrowed_ordinary_rows_do_not_parse_target_or_retain_plan_owner() {
    let profile = Arc::new(
        json!({"timeZone":"Europe/Berlin","federalState":"NW","holidayRegion":"NONE","weeklyMinutes":2310,"workingTimeTarget":{"unknownFacts":vec![json!({"fact":"unrelated"});50_000]}}),
    );
    let source = PreparedTargetSource::new(profile);
    let resolver = RuleResolver::bundled().unwrap();
    let mut cache = DailyCreditContextCache::with_source(&source, &resolver);
    let entries = Arc::new(vec![
        json!({"kind":"SHIFT","id":"ordinary","date":"2026-07-01","title":"Dienst","type":"EARLY","color":"#123456","startTime":"08:00","endTime":"16:00","breakMinutes":30,"allDay":false,"deletedAt":null,"note":"private"});
        50_000
    ]);
    let owner = Arc::downgrade(&entries);
    let borrowed = entries.iter().collect::<Vec<_>>();
    let rows = report_entries_from_refs(
        &borrowed,
        &mut cache,
        &serde_json::from_value(json!({"ordinary":1})).unwrap(),
    )
    .unwrap();
    assert_eq!(rows.len(), 50_000);
    assert_eq!(rows.last().unwrap().duration_minutes, Some(450.0));
    assert_eq!(cache.preparation_stats().input_parses, 0);
    assert_eq!(cache.preparation_stats().context_preparations, 0);
    assert_eq!(Arc::strong_count(&entries), 1);
    drop(borrowed);
    drop(entries);
    assert!(owner.upgrade().is_none());
    assert_eq!(rows[0].title, "Dienst");
}
#[test]
fn ordinary_export_rows_never_prepare_target_facts_and_invalid_fields_never_echo_input() {
    let profile = Arc::new(
        json!({"timeZone":"Europe/Berlin","federalState":"NW","holidayRegion":"NONE","weeklyMinutes":2310,"workingTimeTarget":{"unknownFacts":vec![json!({"fact":"unrelated"});50_000]}}),
    );
    let source = PreparedTargetSource::new(profile);
    let resolver = RuleResolver::bundled().unwrap();
    let mut cache = DailyCreditContextCache::with_source(&source, &resolver);
    let entries = vec![
        json!({"kind":"SHIFT","id":"ordinary","date":"2026-07-01","title":"Dienst","type":"EARLY","color":"#123456","startTime":"08:00","endTime":"16:00","breakMinutes":30,"allDay":false,"deletedAt":null,"note":"private"}),
    ];
    let ranks = serde_json::from_value(json!({"ordinary":1})).unwrap();
    for _ in 0..12 {
        let rows = report_entries(&entries, &mut cache, &ranks).unwrap();
        assert_eq!(rows[0].duration_minutes, Some(450.0));
        assert_eq!(rows[0].credit_minutes, Some(0.0));
    }
    assert_eq!(cache.preparation_stats().input_parses, 0);
    assert_eq!(cache.preparation_stats().context_preparations, 0);
    let mut malformed = entries;
    malformed[0]["title"] = json!({"secret":"never-echo-this"});
    let error = report_entries(&malformed, &mut cache, &ranks).unwrap_err();
    assert!(matches!(error, ReportEntryError::InvalidEntry));
    assert!(!error.to_string().contains("never-echo-this"));
}
#[test]
fn bounded_export_counts_generated_parts_before_time_or_target_work_and_never_returns_partial_rows()
{
    let fixture = value_pool::decode(include_str!("../../reference/export-rows-golden.json"));
    let case = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| {
            let count = case["expected"]["value"].as_array().map_or(0, Vec::len);
            count > case["entries"].as_array().unwrap().len() && case["resolver"] == "bundled"
        })
        .unwrap();
    let source = PreparedTargetSource::new(Arc::new(case["profile"].clone()));
    let resolver = RuleResolver::bundled().unwrap();
    let mut cache = DailyCreditContextCache::with_source(&source, &resolver);
    let entries = case["entries"]
        .as_array()
        .unwrap()
        .iter()
        .collect::<Vec<_>>();
    let ranks = serde_json::from_value(case["platformCollationRanks"].clone()).unwrap();
    let count = case["expected"]["value"].as_array().unwrap().len();
    assert!(matches!(
        report_entries_from_refs_bounded(&entries, &mut cache, &ranks, count - 1),
        Err(ReportEntryError::TooLarge)
    ));
    assert_eq!(cache.preparation_stats().input_parses, 0);
    assert_eq!(cache.preparation_stats().context_preparations, 0);
    let actual = report_entries_from_refs_bounded(&entries, &mut cache, &ranks, count).unwrap();
    common::assert_json_eq(
        &json!({"value":actual}),
        &case["expected"],
        case["id"].as_str().unwrap(),
    );
    assert!(
        report_entries_from_refs_bounded(&[], &mut cache, &ranks, 0)
            .unwrap()
            .is_empty()
    );
    assert!(matches!(
        report_entries_from_refs_bounded(&entries, &mut cache, &ranks, 0),
        Err(ReportEntryError::TooLarge)
    ));
}

struct FieldSource<'a> {
    values: &'a [serde_json::Value],
    fields: &'a [serde_json::Value],
}
impl luna_engine::calendar::window::CalendarRecordSource for FieldSource<'_> {
    fn entries_len(&self) -> usize {
        self.values.len()
    }
    fn base_value(&self, index: usize) -> &serde_json::Value {
        &self.values[index]
    }
    fn field(&self, index: usize, key: &str) -> Option<&serde_json::Value> {
        self.fields[index]
            .get(key)
            .or_else(|| self.values[index].get(key))
    }
}
#[test]
fn effective_template_fields_use_original_report_math_without_materializing_entry_json() {
    use luna_engine::{
        calendar::window::CalendarRecordSource,
        report::export_rows::{
            report_comparison_candidates_from_records, report_entries_from_records_bounded,
        },
    };
    let original = value_pool::decode(include_str!("../../reference/export-rows-golden.json"));
    let fixture = value_pool::decode(include_str!(
        "../../reference/export-record-fields-golden.json"
    ));
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 910);
    let mut resolvers = BTreeMap::new();
    for row in original["resolvers"].as_array().unwrap() {
        let ids = serde_json::from_value(row["packageIds"].clone()).unwrap();
        let history = row
            .get("historical")
            .map(|v| serde_json::from_value(v.clone()).unwrap());
        resolvers.insert(
            row["id"].as_str().unwrap(),
            RuleResolver::from_catalog_json(row["catalog"].clone(), ids, history)
                .unwrap()
                .with_collation_ranks(
                    serde_json::from_value(row["collationRanks"].clone()).unwrap(),
                ),
        );
    }
    for (case, raw) in fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .zip(original["cases"].as_array().unwrap())
    {
        assert_eq!(case["id"], raw["id"]);
        let source = FieldSource {
            values: raw["entries"].as_array().unwrap(),
            fields: case["overlays"].as_array().unwrap(),
        };
        let refs = source.records().collect::<Vec<_>>();
        for (record, base) in refs.iter().zip(source.values) {
            assert!(std::ptr::eq(record.base_value(), base));
        }
        let candidates =
            report_comparison_candidates_from_records(&refs, 100_000, 32 * 1024 * 1024).unwrap();
        common::assert_json_eq(
            &json!(candidates.strings()),
            &case["candidates"],
            case["id"].as_str().unwrap(),
        );
        let target = PreparedTargetSource::new(Arc::new(raw["profile"].clone()));
        let mut cache = DailyCreditContextCache::with_source(
            &target,
            &resolvers[raw["resolver"].as_str().unwrap()],
        );
        let ranks = serde_json::from_value(raw["platformCollationRanks"].clone()).unwrap();
        let actual = match report_entries_from_records_bounded(&refs, &mut cache, &ranks, 100_000) {
            Ok(value) => json!({"value":value}),
            Err(ReportEntryError::Credit(DailyCreditError::Employment(
                EmploymentError::AmbiguousHistory,
            ))) => {
                json!({"error":{"name":"RemunerationProfileError","message":EmploymentError::AmbiguousHistory.to_string()}})
            }
            Err(error) => panic!("unexpected {error}: {}", case["id"]),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}

struct UniformFields<'a> {
    values: &'a [serde_json::Value],
    fields: serde_json::Value,
}
impl luna_engine::calendar::window::CalendarRecordSource for UniformFields<'_> {
    fn entries_len(&self) -> usize {
        self.values.len()
    }
    fn base_value(&self, index: usize) -> &serde_json::Value {
        &self.values[index]
    }
    fn field(&self, index: usize, key: &str) -> Option<&serde_json::Value> {
        self.fields.get(key).or_else(|| self.values[index].get(key))
    }
}
#[test]
fn record_views_share_fifty_thousand_physical_rows_and_keep_null_fields_distinct() {
    use luna_engine::{
        calendar::window::CalendarRecordSource,
        report::export_rows::{
            report_comparison_candidates_from_records, report_entries_from_records_bounded,
        },
    };
    let values = Arc::new(vec![
        json!({"kind":"SHIFT","id":"same","date":"2026-07-01","title":"base-private","color":"#123456","type":"DAY","startTime":"08:00","endTime":"16:00","breakMinutes":30,"allDay":false,"deletedAt":null});
        50_000
    ]);
    let weak = Arc::downgrade(&values);
    let profile = Arc::new(
        json!({"timeZone":"Europe/Berlin","workingTimeTarget":{"malformedFacts":vec![json!({"unused":true});50_000]}}),
    );
    let target = PreparedTargetSource::new(profile);
    let resolver = RuleResolver::bundled().unwrap();
    let mut cache = DailyCreditContextCache::with_source(&target, &resolver);
    let ranks = serde_json::from_value(json!({"same":0})).unwrap();
    let view = UniformFields {
        values: &values,
        fields: json!({"title":"effective","color":"#AABBCC"}),
    };
    let records = view.records().collect::<Vec<_>>();
    assert!(
        records
            .iter()
            .zip(values.iter())
            .all(|(record, base)| std::ptr::eq(record.base_value(), base))
    );
    let candidates =
        report_comparison_candidates_from_records(&records, 50_000, 32 * 1024 * 1024).unwrap();
    assert!(candidates.strings().iter().any(|v| v == "effective"));
    assert!(!candidates.strings().iter().any(|v| v == "base-private"));
    let rows = report_entries_from_records_bounded(&records, &mut cache, &ranks, 50_000).unwrap();
    assert_eq!(rows.len(), 50_000);
    assert_eq!(rows.last().unwrap().title, "effective");
    assert_eq!(rows.last().unwrap().color, "#AABBCC");
    assert_eq!(rows.last().unwrap().duration_minutes, Some(450.0));
    assert_eq!(Arc::strong_count(&values), 1);
    assert_eq!(cache.preparation_stats().input_parses, 0);
    assert_eq!(cache.preparation_stats().context_preparations, 0);
    let invalid = UniformFields {
        values: &values[..1],
        fields: json!({"title":null}),
    };
    let one = invalid.records().collect::<Vec<_>>();
    assert!(matches!(
        report_comparison_candidates_from_records(&one, 1, 32 * 1024 * 1024),
        Err(ReportEntryError::InvalidEntry)
    ));
    assert!(matches!(
        report_entries_from_records_bounded(&one, &mut cache, &ranks, 1),
        Err(ReportEntryError::InvalidEntry)
    ));
    drop(one);
    drop(invalid);
    drop(records);
    drop(view);
    drop(values);
    assert!(weak.upgrade().is_none());
    assert_eq!(rows[0].title, "effective");
}
