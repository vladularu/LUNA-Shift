mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::calendar::{
    loaded_scope::{CalendarLoadRange, RawScopeRows},
    recurrence::CollationRanks,
    window::{
        CalendarRecordSource, CalendarSourceIndex, SharedCalendarSourceIndex, WindowOptions,
        WindowSpec,
    },
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

#[test]
fn shared_native_row_owners_match_every_complete_original_window_without_value_clones() {
    let corpus = value_pool::decode(include_str!("../../reference/calendar-window-golden.json"));
    let cases = corpus["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 160);
    for case in cases {
        let input = &case["input"];
        let rows = Arc::new(
            input["entries"]
                .as_array()
                .unwrap()
                .iter()
                .cloned()
                .map(Arc::new)
                .collect::<Vec<Arc<Value>>>(),
        );
        let source = SharedCalendarSourceIndex::from_shared_entries(rows).unwrap();
        let spec: WindowSpec = serde_json::from_value(input["spec"].clone()).unwrap();
        let options: WindowOptions = serde_json::from_value(input["options"].clone()).unwrap();
        let prepared = source.prepare(&spec).unwrap();
        let expected: BTreeSet<String> =
            serde_json::from_value(case["candidates"].clone()).unwrap();
        assert_eq!(prepared.candidates(), &expected, "{}", case["id"]);
        let ranks: CollationRanks = serde_json::from_value(case["ranks"].clone()).unwrap();
        let result =
            serde_json::to_value(prepared.finalize(&ranks).unwrap().index(options).unwrap())
                .unwrap();
        common::assert_json_eq(&result, &case["expected"], case["id"].as_str().unwrap());
    }
}

#[test]
fn shared_unranked_rows_preserve_all_original_seed_and_occurrence_ties() {
    let corpus = value_pool::decode(include_str!(
        "../../reference/calendar-unranked-golden.json"
    ));
    let cases = corpus["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 96);
    for case in cases {
        let input = &case["input"];
        let rows = Arc::new(
            input["entries"]
                .as_array()
                .unwrap()
                .iter()
                .cloned()
                .map(Arc::new)
                .collect::<Vec<_>>(),
        );
        let source = SharedCalendarSourceIndex::from_unranked_entry_source(rows.clone()).unwrap();
        assert!(Arc::ptr_eq(source.entry_source(), &rows));
        let prepared = source
            .prepare(&serde_json::from_value(input["spec"].clone()).unwrap())
            .unwrap();
        let candidates: BTreeSet<String> =
            serde_json::from_value(case["candidates"].clone()).unwrap();
        assert_eq!(prepared.candidates(), &candidates, "{}", case["id"]);
        let ranks = serde_json::from_value(case["ranks"].clone()).unwrap();
        let window = prepared.finalize(&ranks).unwrap();
        assert!(Arc::ptr_eq(window.entry_source(), &rows));
        let result = serde_json::to_value(
            window
                .index(serde_json::from_value(input["options"].clone()).unwrap())
                .unwrap(),
        )
        .unwrap();
        common::assert_json_eq(&result, &case["expected"], case["id"].as_str().unwrap());
    }
}

#[derive(Clone)]
struct DisplaySource {
    rows: Arc<Vec<Arc<Value>>>,
    display: Arc<BTreeMap<&'static str, Value>>,
}
impl CalendarRecordSource for DisplaySource {
    fn entries_len(&self) -> usize {
        self.rows.len()
    }
    fn base_value(&self, index: usize) -> &Value {
        &self.rows[index]
    }
    fn field(&self, index: usize, key: &str) -> Option<&Value> {
        if self.rows[index]["templateId"] == "template" {
            self.display.get(key).or_else(|| self.rows[index].get(key))
        } else {
            self.rows[index].get(key)
        }
    }
}
fn ranked_candidates(candidates: &BTreeSet<String>) -> CollationRanks {
    CollationRanks::from(
        candidates
            .iter()
            .enumerate()
            .map(|(i, text)| (text.clone(), i as u32))
            .collect::<BTreeMap<_, _>>(),
    )
}

#[test]
fn display_overlays_drive_candidates_order_and_streamed_occurrences_without_changing_base() {
    let rows = Arc::new(vec![
        Arc::new(
            json!({"kind":"APPOINTMENT","id":"series","templateId":"template","date":"2026-03-01","title":"old","color":"old","symbol":"old","startTime":null,"createdAt":"same","deletedAt":null,"recurrence":{"frequency":"DAY","interval":1}}),
        ),
        Arc::new(
            json!({"kind":"APPOINTMENT","id":"ordinary","templateId":null,"date":"2026-03-02","title":"M","color":"base","symbol":null,"startTime":null,"createdAt":"same","deletedAt":null,"recurrence":null}),
        ),
    ]);
    let display = Arc::new(BTreeMap::from([
        ("title", json!("A")),
        ("color", json!("new")),
        ("symbol", json!("⭐")),
    ]));
    let source = DisplaySource {
        rows: rows.clone(),
        display: display.clone(),
    };
    let spec = WindowSpec::Day {
        date: "2026-03-02".to_owned(),
    };
    let prepared = CalendarSourceIndex::from_entry_source(source)
        .unwrap()
        .prepare(&spec)
        .unwrap();
    assert!(prepared.candidates().contains("A"));
    assert!(!prepared.candidates().contains("old"));
    let ranks = ranked_candidates(prepared.candidates());
    let result = prepared.finalize(&ranks).unwrap();
    let first = result.entry(0).unwrap();
    assert_eq!(first.original()["title"], "old");
    assert_eq!(first.get("title"), Some(&json!("A")));
    assert_eq!(first.date(), "2026-03-02");
    assert!(std::ptr::eq(first.original(), rows[0].as_ref()));
    let mut materialized = rows
        .iter()
        .map(|row| row.as_ref().clone())
        .collect::<Vec<_>>();
    for (key, value) in display.iter() {
        materialized[0][*key] = value.clone();
    }
    let flat = CalendarSourceIndex::new(Arc::new(materialized))
        .unwrap()
        .prepare(&spec)
        .unwrap()
        .finalize(&ranks)
        .unwrap();
    let options = WindowOptions {
        show_appointments: true,
        show_shifts: true,
    };
    assert_eq!(
        serde_json::to_value(result.index(options).unwrap()).unwrap(),
        serde_json::to_value(flat.index(options).unwrap()).unwrap()
    );
    assert_eq!(rows[0]["date"], "2026-03-01");
    assert_eq!(rows[0]["color"], "old");
}

#[test]
fn fifty_thousand_shared_rows_are_borrowed_and_released_with_the_last_window_owner() {
    let rows = Arc::new((0..50_000).map(|i| Arc::new(json!({"kind":"SHIFT","id":format!("id-{i:05}"),"date":if i%2==0{"2026-03-01"}else{"2030-03-01"},"title":"Shared","type":"EARLY","startTime":"06:00","endTime":"14:00","breakMinutes":30,"createdAt":"2026-01-01T00:00:00Z","deletedAt":null,"opaque":{"nested":[i]}}))).collect::<Vec<_>>());
    let source_weak = Arc::downgrade(&rows);
    let row_weak = Arc::downgrade(&rows[0]);
    let index = SharedCalendarSourceIndex::from_shared_entries(rows.clone()).unwrap();
    let prepared = index
        .prepare(&WindowSpec::Day {
            date: "2026-03-01".to_owned(),
        })
        .unwrap();
    assert_eq!(prepared.projected_len(), 25_000);
    assert!(!prepared.candidates().contains("id-00001"));
    let ranks = ranked_candidates(prepared.candidates());
    let window = prepared.finalize(&ranks).unwrap();
    assert!(Arc::ptr_eq(window.source_entries(), &rows));
    assert!(std::ptr::eq(
        window.entry(0).unwrap().original(),
        rows[0].as_ref()
    ));
    assert_eq!(
        Arc::strong_count(&rows[0]),
        1,
        "descriptors never clone individual row owners"
    );
    let view = window
        .index(WindowOptions {
            show_appointments: true,
            show_shifts: true,
        })
        .unwrap();
    drop(index);
    drop(rows);
    drop(window);
    assert!(source_weak.upgrade().is_some());
    assert!(row_weak.upgrade().is_some());
    drop(view);
    assert!(source_weak.upgrade().is_none());
    assert!(row_weak.upgrade().is_none());
}

#[test]
fn selected_loaded_scope_owners_flow_directly_into_the_existing_window_kernel() {
    let corpus = value_pool::decode(include_str!("../../reference/loaded-scope-golden.json"));
    let source_ranks = CollationRanks::from(
        corpus["collationRanks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|pair| {
                (
                    pair[0].as_str().unwrap().to_owned(),
                    pair[1].as_u64().unwrap() as u32,
                )
            })
            .collect::<BTreeMap<_, _>>(),
    );
    let options = WindowOptions {
        show_appointments: true,
        show_shifts: true,
    };
    let mut reads = 0;
    let mut ready = 0;
    for case in corpus["cases"].as_array().unwrap() {
        for capture in case["input"]["captures"].as_array().unwrap() {
            if capture["queries"].as_array().unwrap().is_empty() {
                continue;
            }
            reads += 1;
            let raw = &capture["rawSource"];
            let owner = RawScopeRows::new(
                Arc::from(raw["shiftRows"].as_array().unwrap().clone()),
                Arc::from(raw["appointmentRows"].as_array().unwrap().clone()),
                Arc::from(raw["templateRows"].as_array().unwrap().clone()),
            )
            .unwrap();
            let range = CalendarLoadRange {
                start_date: capture["range"]["startDate"].as_str().unwrap().to_owned(),
                end_date: capture["range"]["endDate"].as_str().unwrap().to_owned(),
            };
            let observed = case["expected"]["frames"]
                .as_array()
                .unwrap()
                .iter()
                .flat_map(|frame| frame["io"].as_array().unwrap())
                .find(|job| job["id"] == capture["id"] && !job["result"].is_null())
                .unwrap();
            let scope = owner
                .prepare(&range)
                .and_then(|draft| draft.finish(&source_ranks));
            if observed["result"]["ok"] != true {
                assert!(scope.is_err());
                continue;
            }
            let scope = scope.unwrap();
            ready += 1;
            let flat = CalendarSourceIndex::new(Arc::new(
                scope
                    .entries()
                    .iter()
                    .map(|entry| entry.value().clone())
                    .collect::<Vec<_>>(),
            ))
            .unwrap();
            let borrowed = CalendarSourceIndex::from_entry_source(scope.clone()).unwrap();
            for (expected, actual) in scope
                .entries()
                .iter()
                .zip(borrowed.entry_source().entries())
            {
                assert!(Arc::ptr_eq(expected, actual));
            }
            for date in case["input"]["requestedDates"].as_array().unwrap() {
                let spec = WindowSpec::Day {
                    date: date.as_str().unwrap().to_owned(),
                };
                let prepared = borrowed.prepare(&spec).unwrap();
                let flat_prepared = flat.prepare(&spec).unwrap();
                assert_eq!(prepared.candidates(), flat_prepared.candidates());
                let ranks = ranked_candidates(prepared.candidates());
                let actual = serde_json::to_value(
                    prepared.finalize(&ranks).unwrap().index(options).unwrap(),
                )
                .unwrap();
                let expected = serde_json::to_value(
                    flat_prepared
                        .finalize(&ranks)
                        .unwrap()
                        .index(options)
                        .unwrap(),
                )
                .unwrap();
                common::assert_json_eq(&actual, &expected, case["id"].as_str().unwrap());
            }
        }
    }
    assert_eq!(reads, 81);
    assert_eq!(ready, 77);
}
