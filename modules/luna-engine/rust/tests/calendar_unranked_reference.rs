mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::calendar::{
    recurrence::CollationRanks,
    window::{CalendarSourceIndex, WindowOptions, WindowSpec},
};
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc};
fn corpus() -> Value {
    value_pool::decode(include_str!(
        "../../reference/calendar-unranked-golden.json"
    ))
}
#[test]
fn native_selected_base_order_then_recurrence_matches_all_complete_original_windows() {
    let corpus = corpus();
    let cases = corpus["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 96);
    for case in cases {
        let input = &case["input"];
        let rows = Arc::new(input["entries"].as_array().unwrap().clone());
        let source = CalendarSourceIndex::from_unranked_normalized(rows.clone()).unwrap();
        assert!(Arc::ptr_eq(source.source_entries(), &rows));
        let spec: WindowSpec = serde_json::from_value(input["spec"].clone()).unwrap();
        let options: WindowOptions = serde_json::from_value(input["options"].clone()).unwrap();
        let prepared = source.prepare(&spec).unwrap();
        let expected: BTreeSet<String> =
            serde_json::from_value(case["candidates"].clone()).unwrap();
        assert_eq!(
            prepared.candidates(),
            &expected,
            "{} full seed/projected union",
            case["id"]
        );
        let ranks: CollationRanks = serde_json::from_value(case["ranks"].clone()).unwrap();
        let result =
            serde_json::to_value(prepared.finalize(&ranks).unwrap().index(options).unwrap())
                .unwrap();
        common::assert_json_eq(&result, &case["expected"], case["id"].as_str().unwrap());
    }
}
#[test]
fn reverse_seed_dates_with_platform_equal_ids_expose_the_actual_stability_bug() {
    let corpus = corpus();
    let case = corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "monthly-reverse-seeds-DAY-true-true")
        .unwrap();
    let rows = Arc::new(case["input"]["entries"].as_array().unwrap().clone());
    let spec: WindowSpec = serde_json::from_value(case["input"]["spec"].clone()).unwrap();
    let ranks: CollationRanks = serde_json::from_value(case["ranks"].clone()).unwrap();
    let options = WindowOptions {
        show_appointments: true,
        show_shifts: true,
    };
    let wrong = CalendarSourceIndex::new(rows.clone())
        .unwrap()
        .prepare(&spec)
        .unwrap()
        .finalize(&ranks)
        .unwrap()
        .index(options)
        .unwrap();
    let wrong = serde_json::to_value(wrong).unwrap();
    assert_eq!(wrong["expanded"][0]["opaque"]["marker"], "newer-first");
    assert_eq!(
        case["expected"]["expanded"][0]["opaque"]["marker"],
        "older-second"
    );
    let actual = CalendarSourceIndex::from_unranked_normalized(rows)
        .unwrap()
        .prepare(&spec)
        .unwrap()
        .finalize(&ranks)
        .unwrap()
        .index(options)
        .unwrap();
    common::assert_json_eq(
        &serde_json::to_value(actual).unwrap(),
        &case["expected"],
        "old rank shortcut would reverse source-equal occurrences",
    );
}
#[test]
fn fifty_thousand_rows_only_collect_comparison_strings_for_the_requested_window() {
    let rows=Arc::new((0..50_000).map(|i|json!({"kind":"SHIFT","id":format!("id-{i:05}"),"date":if i%2==0{"2026-03-01"}else{"2030-03-01"},"title":"Synthetic","type":"EARLY","startTime":"06:00","endTime":"14:00","breakMinutes":30,"createdAt":"2026-01-01T00:00:00Z","deletedAt":null})).collect::<Vec<_>>());
    let index = CalendarSourceIndex::from_unranked_normalized(rows.clone()).unwrap();
    let prepared = index
        .prepare(&WindowSpec::Day {
            date: "2026-03-01".to_owned(),
        })
        .unwrap();
    assert!(Arc::ptr_eq(index.source_entries(), &rows));
    assert_eq!(prepared.projected_len(), 25_000);
    assert!(prepared.candidates().len() < 25_010);
    assert!(!prepared.candidates().contains("id-00001"));
    assert!(!prepared.candidates().contains("2030-03-01"));
}
