mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    calendar::{
        recurrence::CollationRanks,
        window::{CalendarSourceIndex, WindowSpec},
    },
    credit::context::DailyCreditContextCache,
    report::day_details,
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};
fn corpus() -> Value {
    value_pool::decode(include_str!("../../reference/day-details-golden.json"))
}
#[test]
fn every_original_day_details_metric_notice_and_row_is_preserved() {
    let fixture = corpus();
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 689);
    let resolver = RuleResolver::bundled().unwrap();
    for case in cases {
        let input = &case["input"];
        let date = input["date"].as_str().unwrap();
        let ranks: CollationRanks =
            serde_json::from_value::<BTreeMap<String, u32>>(input["ranks"].clone())
                .unwrap()
                .into();
        let source =
            CalendarSourceIndex::new(Arc::new(input["entries"].as_array().unwrap().clone()))
                .unwrap();
        let window = source
            .prepare(&WindowSpec::Day { date: date.into() })
            .unwrap()
            .finalize(&ranks)
            .unwrap();
        let mut cache = DailyCreditContextCache::new(&input["profile"], &resolver);
        let result = day_details::prepare(date, Arc::clone(&window), &mut cache, &ranks)
            .unwrap_or_else(|error| panic!("{}: {error:?}", case["id"]));
        assert!(Arc::ptr_eq(result.source_window(), &window));
        let mut actual = serde_json::to_value(&result).unwrap();
        let mut rows = Vec::new();
        for offset in (0..result.entry_count()).step_by(3) {
            rows.extend(result.rows(offset, 3).unwrap());
        }
        actual["entries"] = Value::Array(rows);
        let mut expected = case["expected"].clone();
        // Navigation stays in the host. Its actual original callbacks remain
        // frozen in the same fixture for the later UI adapter parity test.
        for row in expected["entries"].as_array_mut().unwrap() {
            row.as_object_mut().unwrap().remove("route");
        }
        common::assert_json_eq(&actual, &expected, case["id"].as_str().unwrap());
    }
}
#[test]
fn rows_are_bounded_and_never_accept_a_different_day_window() {
    let fixture = corpus();
    let input = &fixture["cases"][1]["input"];
    let resolver = RuleResolver::bundled().unwrap();
    let ranks: CollationRanks =
        serde_json::from_value::<BTreeMap<String, u32>>(input["ranks"].clone())
            .unwrap()
            .into();
    let source =
        CalendarSourceIndex::new(Arc::new(input["entries"].as_array().unwrap().clone())).unwrap();
    let date = input["date"].as_str().unwrap();
    let window = source
        .prepare(&WindowSpec::Day { date: date.into() })
        .unwrap()
        .finalize(&ranks)
        .unwrap();
    let mut cache = DailyCreditContextCache::new(&input["profile"], &resolver);
    assert!(day_details::prepare("2026-07-02", Arc::clone(&window), &mut cache, &ranks).is_err());
    let view = day_details::prepare(date, window, &mut cache, &ranks).unwrap();
    for (offset, limit) in [(0, 0), (0, 129), (u32::MAX, 1)] {
        assert!(view.rows(offset, limit).is_err());
    }
    assert_eq!(
        view.rows(view.entry_count(), 1).unwrap(),
        Vec::<Value>::new()
    );
    assert_eq!(
        serde_json::to_value(&view).unwrap()["entriesCaption"],
        json!(format!("{} an diesem Tag", view.entry_count()))
    );
}

#[test]
fn fifty_thousand_unrelated_rows_share_one_owner_and_do_not_expand_the_day_view() {
    let fixture = corpus();
    let input = &fixture["cases"][1]["input"];
    let mut row = input["entries"][0].clone();
    row["date"] = json!("2026-06-30");
    let mut rows = vec![row; 49_999];
    rows.push(input["entries"][0].clone());
    let rows = Arc::new(rows);
    let weak = Arc::downgrade(&rows);
    let source = CalendarSourceIndex::new(Arc::clone(&rows)).unwrap();
    let ranks: CollationRanks =
        serde_json::from_value::<BTreeMap<String, u32>>(input["ranks"].clone())
            .unwrap()
            .into();
    let date = input["date"].as_str().unwrap();
    let window = source
        .prepare(&WindowSpec::Day { date: date.into() })
        .unwrap()
        .finalize(&ranks)
        .unwrap();
    assert_eq!(window.projected_len(), 1);
    assert!(Arc::ptr_eq(window.source_entries(), &rows));
    let resolver = RuleResolver::bundled().unwrap();
    let mut cache = DailyCreditContextCache::new(&input["profile"], &resolver);
    let view = day_details::prepare(date, Arc::clone(&window), &mut cache, &ranks).unwrap();
    assert!(Arc::ptr_eq(view.source_window(), &window));
    drop(source);
    drop(rows);
    drop(window);
    assert!(weak.upgrade().is_some());
    assert!(serde_json::to_vec(&view).unwrap().len() < 2048);
    assert_eq!(view.rows(0, 128).unwrap().len(), 1);
    drop(view);
    assert!(weak.upgrade().is_none());
}

#[test]
fn every_original_day_details_view_uses_shared_native_records_without_a_second_tree() {
    let fixture = corpus();
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 689);
    let resolver = RuleResolver::bundled().unwrap();
    for case in cases {
        let input = &case["input"];
        let date = input["date"].as_str().unwrap();
        let ranks: CollationRanks =
            serde_json::from_value::<BTreeMap<String, u32>>(input["ranks"].clone())
                .unwrap()
                .into();
        let source = CalendarSourceIndex::from_entry_source(Arc::new(
            input["entries"]
                .as_array()
                .unwrap()
                .iter()
                .cloned()
                .map(Arc::new)
                .collect::<Vec<_>>(),
        ))
        .unwrap();
        let window = source
            .prepare(&WindowSpec::Day { date: date.into() })
            .unwrap()
            .finalize(&ranks)
            .unwrap();
        let mut cache = DailyCreditContextCache::new(&input["profile"], &resolver);
        let result = day_details::prepare(date, Arc::clone(&window), &mut cache, &ranks)
            .unwrap_or_else(|error| panic!("{}: {error:?}", case["id"]));
        assert!(Arc::ptr_eq(result.source_window(), &window));
        let mut actual = serde_json::to_value(&result).unwrap();
        let mut rows = Vec::new();
        for offset in (0..result.entry_count()).step_by(3) {
            rows.extend(result.rows(offset, 3).unwrap());
        }
        actual["entries"] = Value::Array(rows);
        let mut expected = case["expected"].clone();
        // Navigation stays in the host. Its actual original callbacks remain
        // frozen in the same fixture for the later UI adapter parity test.
        for row in expected["entries"].as_array_mut().unwrap() {
            row.as_object_mut().unwrap().remove("route");
        }
        common::assert_json_eq(&actual, &expected, case["id"].as_str().unwrap());
    }
}

#[derive(Clone)]
struct NativeDisplayOverlay {
    rows: Arc<Vec<Value>>,
    title: Value,
    color: Value,
    symbol: Value,
}
impl luna_engine::calendar::window::CalendarRecordSource for NativeDisplayOverlay {
    fn entries_len(&self) -> usize {
        self.rows.len()
    }
    fn base_value(&self, index: usize) -> &Value {
        &self.rows[index]
    }
    fn field(&self, index: usize, key: &str) -> Option<&Value> {
        if self.rows[index]["kind"] == "SHIFT" {
            match key {
                "title" => return Some(&self.title),
                "color" => return Some(&self.color),
                "symbol" => return Some(&self.symbol),
                _ => {}
            }
        }
        self.rows[index].get(key)
    }
}
#[test]
fn display_fields_borrow_the_native_overlay_while_time_math_keeps_physical_rows() {
    let fixture = corpus();
    let c = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            c["input"]["entries"]
                .as_array()
                .unwrap()
                .iter()
                .any(|row| row["kind"] == "SHIFT" && row["date"] == c["input"]["date"])
        })
        .unwrap();
    let input = &c["input"];
    let date = input["date"].as_str().unwrap();
    let ranks: CollationRanks =
        serde_json::from_value::<BTreeMap<String, u32>>(input["ranks"].clone())
            .unwrap()
            .into();
    let rows = Arc::new(input["entries"].as_array().unwrap().clone());
    let source = NativeDisplayOverlay {
        rows: rows.clone(),
        title: input["date"].clone(),
        color: json!("#123ABC"),
        symbol: json!("star"),
    };
    let index = CalendarSourceIndex::from_entry_source(source).unwrap();
    let window = index
        .prepare(&WindowSpec::Day { date: date.into() })
        .unwrap()
        .finalize(&ranks)
        .unwrap();
    let resolver = RuleResolver::bundled().unwrap();
    let mut cache = DailyCreditContextCache::new(&input["profile"], &resolver);
    let view = day_details::prepare(date, window, &mut cache, &ranks).unwrap();
    let metadata = serde_json::to_value(&view).unwrap();
    assert_eq!(metadata["summary"], c["expected"]["summary"]);
    let visible = view.rows(0, 128).unwrap();
    for row in visible.iter().filter(|row| row["kind"] == "SHIFT") {
        assert_eq!(row["title"], input["date"]);
        assert_eq!(row["color"], "#123ABC");
        assert_eq!(row["symbol"], "star");
    }
    assert!(visible.iter().any(|row| row["kind"] == "SHIFT"));
    assert_ne!(
        rows.iter().find(|row| row["kind"] == "SHIFT").unwrap()["title"],
        input["date"]
    );
}
