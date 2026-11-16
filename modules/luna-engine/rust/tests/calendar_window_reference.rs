mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::calendar::{
    recurrence::CollationRanks,
    window::{CalendarSourceIndex, WindowOptions, WindowSpec},
};
use luna_engine::{EngineError, calendar::window::WindowError};
use serde_json::Value;
use serde_json::json;
use std::{collections::BTreeSet, sync::Arc};
#[test]
fn every_complete_source_calendar_window_matches_without_row_or_occurrence_policy_changes() {
    let corpus = value_pool::decode(include_str!("../../reference/calendar-window-golden.json"));
    assert_eq!(
        corpus["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = corpus["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 160);
    for case in cases {
        let input = &case["input"];
        let entries = Arc::new(input["entries"].as_array().unwrap().clone());
        let source = CalendarSourceIndex::new(entries.clone()).unwrap();
        assert!(Arc::ptr_eq(source.source_entries(), &entries));
        let spec: WindowSpec = serde_json::from_value(input["spec"].clone()).unwrap();
        let options: WindowOptions = serde_json::from_value(input["options"].clone()).unwrap();
        let prepared = source
            .prepare(&spec)
            .unwrap_or_else(|e| panic!("{}: {e:?}", case["id"]));
        let expected: BTreeSet<String> = case["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_owned())
            .collect();
        assert_eq!(
            prepared.candidates(),
            &expected,
            "{} candidate coverage",
            case["id"]
        );
        let ranks: CollationRanks = serde_json::from_value(case["ranks"].clone()).unwrap();
        let result: Value =
            serde_json::to_value(prepared.finalize(&ranks).unwrap().index(options).unwrap())
                .unwrap();
        common::assert_json_eq(&result, &case["expected"], case["id"].as_str().unwrap());
    }
}
#[test]
fn new_occurrence_dates_require_the_complete_window_rank_map() {
    let corpus = value_pool::decode(include_str!("../../reference/calendar-window-golden.json"));
    let case = corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "mixed-MONTHS-2026-07-true-true")
        .unwrap();
    let input = &case["input"];
    let rows = Arc::new(input["entries"].as_array().unwrap().clone());
    let original_dates = rows
        .iter()
        .filter_map(|v| v["date"].as_str())
        .collect::<BTreeSet<_>>();
    let source = CalendarSourceIndex::new(rows.clone()).unwrap();
    let spec = serde_json::from_value(input["spec"].clone()).unwrap();
    let prepared = source.prepare(&spec).unwrap();
    let missing = prepared
        .candidates()
        .iter()
        .find(|s| {
            s.len() == 10 && s.starts_with("2026-07-") && !original_dates.contains(s.as_str())
        })
        .unwrap();
    let mut ranks = case["ranks"].clone();
    ranks.as_object_mut().unwrap().remove(missing);
    assert!(matches!(
        prepared.finalize(&serde_json::from_value(ranks).unwrap()),
        Err(WindowError::Engine(EngineError::InvalidCollation))
    ));
}
#[test]
fn fifty_thousand_rows_keep_one_owner_and_select_only_the_requested_dates() {
    let rows=Arc::new((0..50_000).map(|i|json!({"kind":"SHIFT","id":format!("row-{i}"),"date":format!("{}-07-01",2000+i%50),"title":"Dienst","type":"EARLY","startTime":"06:00","endTime":"14:00","createdAt":"2026-01-01T00:00:00Z","deletedAt":null})).collect::<Vec<_>>());
    let source = CalendarSourceIndex::new(rows.clone()).unwrap();
    assert!(Arc::ptr_eq(source.source_entries(), &rows));
    let spec = WindowSpec::Day {
        date: "2026-07-01".to_owned(),
    };
    let first = source.prepare(&spec).unwrap();
    let second = source
        .prepare(&WindowSpec::Day {
            date: "2027-07-01".to_owned(),
        })
        .unwrap();
    assert_eq!(first.projected_len(), 1000);
    assert_eq!(second.projected_len(), 1000);
    assert_eq!(
        Arc::strong_count(&rows),
        4,
        "caller + source + two metadata-only projections share the one normalized allocation"
    );
    drop(first);
    drop(second);
    assert_eq!(Arc::strong_count(&rows), 2);
}
#[test]
fn indexed_view_can_outlive_preparation_without_self_references_or_entry_copies() {
    let rows = Arc::new(vec![
        json!({"kind":"APPOINTMENT","id":"series","date":"2026-06-30","title":"Termin","startTime":null,"createdAt":"2026-01-01T00:00:00Z","deletedAt":null,"recurrence":{"frequency":"DAY","interval":1},"opaque":{"largeText":"x".repeat(100_000)}}),
    ]);
    let source = CalendarSourceIndex::new(rows.clone()).unwrap();
    let prepared = source
        .prepare(&WindowSpec::Day {
            date: "2026-07-01".to_owned(),
        })
        .unwrap();
    let ranks = CollationRanks::from(
        prepared
            .candidates()
            .iter()
            .map(|s| (s.clone(), 0u32))
            .collect::<std::collections::BTreeMap<_, _>>(),
    );
    let sorted = prepared.finalize(&ranks).unwrap();
    assert!(Arc::ptr_eq(sorted.source_entries(), &rows));
    let view = sorted
        .index(WindowOptions {
            show_appointments: true,
            show_shifts: true,
        })
        .unwrap();
    drop(sorted);
    drop(source);
    let row = view.window().entry(view.visible_indices()[0]).unwrap();
    assert_eq!(row.date(), "2026-07-01");
    assert_eq!(row.original()["date"], "2026-06-30");
    assert!(std::ptr::eq(row.original(), &rows[0]));
    drop(rows);
    let value = serde_json::to_value(view).unwrap();
    assert_eq!(value["expanded"][0]["date"], "2026-07-01");
    assert_eq!(value["expanded"][0]["id"], "series");
    assert_eq!(
        value["expanded"][0]["opaque"]["largeText"]
            .as_str()
            .unwrap()
            .len(),
        100_000
    );
}
#[test]
fn strict_flags_limits_and_legacy_attempt_guard_never_truncate_into_ready_output() {
    assert!(
        serde_json::from_value::<WindowOptions>(
            json!({"showAppointments":true,"showShifts":true,"unknown":false})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<WindowOptions>(json!({"showAppointments":null,"showShifts":true}))
            .is_err()
    );
    let source = CalendarSourceIndex::new(Arc::new(vec![])).unwrap();
    assert!(matches!(
        source.prepare(&WindowSpec::Months { months: vec![] }),
        Err(WindowError::InvalidQuery)
    ));
    assert!(matches!(
        source.prepare(&WindowSpec::Months {
            months: vec!["2026-07".to_owned(); 17]
        }),
        Err(WindowError::ResourceLimit)
    ));
    assert!(matches!(
        source.prepare(&WindowSpec::Months {
            months: vec!["1900-01".to_owned(), "4099-12".to_owned()]
        }),
        Err(WindowError::ResourceLimit)
    ));
    assert!(matches!(
        CalendarSourceIndex::new(Arc::new(vec![Value::Null; 100_001])),
        Err(WindowError::ResourceLimit)
    ));
    let oversized_candidates = CalendarSourceIndex::new(Arc::new(vec![json!({
        "kind":"APPOINTMENT","id":"large-title","date":"2026-07-01",
        "title":"x".repeat(16 * 1024 * 1024 + 1),"startTime":null,
        "createdAt":"2026-01-01T00:00:00Z","deletedAt":null,"recurrence":null
    })]))
    .unwrap();
    assert!(matches!(
        oversized_candidates.prepare(&WindowSpec::Day {
            date: "2026-07-01".to_owned()
        }),
        Err(WindowError::ResourceLimit)
    ));
    let legacy = |i| json!({"kind":"APPOINTMENT","id":format!("legacy-{i}"),"date":"2026-07-01","title":"Termin","createdAt":"2026-01-01T00:00:00Z","deletedAt":null,"recurrence":{"frequency":"DAY","interval":0}});
    let one = CalendarSourceIndex::new(Arc::new(vec![legacy(0)])).unwrap();
    assert_eq!(
        one.prepare(&WindowSpec::Day {
            date: "2026-07-01".to_owned()
        })
        .unwrap()
        .projected_len(),
        10_000,
        "retain the old per-series attempted-index guard even for corrupt zero intervals"
    );
    let many = CalendarSourceIndex::new(Arc::new((0..11).map(legacy).collect())).unwrap();
    assert!(
        matches!(
            many.prepare(&WindowSpec::Day {
                date: "2026-07-01".to_owned()
            }),
            Err(WindowError::ResourceLimit)
        ),
        "oversized projections are rejected, not silently cut off"
    );
}
