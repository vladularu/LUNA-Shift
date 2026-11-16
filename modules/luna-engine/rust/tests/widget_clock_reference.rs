mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::calendar::widget::WidgetClock;
use serde_json::{Value, json};
#[test]
fn widget_clock_keeps_original_range_and_midnight_without_host_date_arithmetic() {
    let source = value_pool::decode(include_str!("../../reference/widget-golden.json"));
    let mut compared = 0;
    for c in source["cases"].as_array().unwrap() {
        let op = c["operation"].as_str().unwrap();
        if !matches!(op, "widget.range" | "widget.midnight") {
            continue;
        }
        let i = &c["input"];
        let epoch = i["observedEpochMilliseconds"].as_i64().unwrap();
        let clock = WidgetClock::from_epoch(epoch, i["timeZone"].as_str().unwrap()).unwrap();
        let actual: Value = if op == "widget.range" {
            serde_json::to_value(clock.entry_range().unwrap()).unwrap()
        } else {
            json!(clock.next_midnight().unwrap())
        };
        common::assert_json_eq(&actual, &c["expected"], c["id"].as_str().unwrap());
        compared += 1;
    }
    assert!(compared >= 4);
}
#[test]
fn all_original_dst_leap_signed_and_skipped_day_boundaries_keep_their_exact_epoch() {
    let source: Value =
        serde_json::from_str(include_str!("../../reference/widget-clock-golden.json")).unwrap();
    let cases = source["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 120);
    for c in cases {
        let i = &c["input"];
        let clock = WidgetClock::from_epoch(
            i["observedEpochMilliseconds"].as_i64().unwrap(),
            i["timeZone"].as_str().unwrap(),
        )
        .unwrap();
        let actual = json!({"range":clock.entry_range().unwrap(),"nextMidnight":clock.next_midnight().unwrap()});
        common::assert_json_eq(&actual, &c["expected"], c["id"].as_str().unwrap());
    }
}
#[test]
fn raw_widget_clock_rejects_unsupported_epochs_and_posix_zone_syntax() {
    assert!(WidgetClock::from_epoch(i64::MAX, "UTC").is_err());
    assert!(WidgetClock::from_epoch(1794500000000, "Europe/Unknown").is_err());
    assert!(WidgetClock::from_epoch(1794500000000, "EST5EDT,M3.2.0,M11.1.0").is_err());
}
