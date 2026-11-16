mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::calendar::{
    incoming::timeline_source::IncomingTimelineSource,
    loaded_scope::{CalendarLoadRange, RawScopeRows},
    recurrence::CollationRanks,
    widget::{WidgetClock, WidgetRowOptions},
};
use serde_json::{Value, json};
use std::sync::Arc;
#[test]
fn actual_original_sql_range_entries_feed_widgets_without_a_ready_value_copy() {
    let source: Value =
        value_pool::decode(include_str!("../../reference/widget-own-query-golden.json"));
    let cases = source["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 24);
    let dump_path = std::env::var("LUNA_WIDGET_OWN_NATIVE_OUTPUT").ok();
    let mut dumped = Vec::new();
    let mut frames = 0;
    for c in cases {
        let i = &c["input"];
        let r = &i["raw"];
        let clock = WidgetClock::from_epoch(
            i["observedEpochMilliseconds"].as_i64().unwrap(),
            i["timeZone"].as_str().unwrap(),
        )
        .unwrap();
        let range = clock.entry_range().unwrap();
        assert_eq!(serde_json::to_value(&range).unwrap(), i["range"]);
        let raw = RawScopeRows::new(
            Arc::from(r["shiftRows"].as_array().unwrap().clone()),
            Arc::from(r["appointmentRows"].as_array().unwrap().clone()),
            Arc::from(r["templateRows"].as_array().unwrap().clone()),
        )
        .unwrap();
        let prepared = raw
            .prepare(&CalendarLoadRange {
                start_date: range.start_date,
                end_date: range.end_date,
            })
            .unwrap();
        let ranks: CollationRanks = serde_json::from_value(i["comparisonRanks"].clone()).unwrap();
        let entries = prepared.finish(&ranks).unwrap();
        common::assert_json_eq(
            &Value::Array(
                entries
                    .entries()
                    .iter()
                    .map(|e| serde_json::to_value(e.as_ref()).unwrap())
                    .collect(),
            ),
            &c["expected"]["entries"],
            c["id"].as_str().unwrap(),
        );
        let incoming = IncomingTimelineSource::from_raw(Arc::new(Vec::new())).unwrap();
        let output = serde_json::to_value(
            clock
                .business_timeline_from_records(
                    &entries,
                    &ranks,
                    &incoming,
                    WidgetRowOptions {
                        show_shifts: true,
                        show_appointments: true,
                        show_shift_times: true,
                        show_shift_duration: true,
                    },
                    true,
                )
                .unwrap(),
        )
        .unwrap();
        let actual = output.as_array().unwrap();
        let expected = c["expected"]["frames"].as_array().unwrap();
        assert_eq!(actual.len(), expected.len());
        for (n, e) in actual.iter().zip(expected) {
            assert_eq!(
                n["observedEpochMilliseconds"],
                e["observedEpochMilliseconds"]
            );
            for key in ["todayDate", "month", "monthTitle", "state"] {
                assert_eq!(n[key], e["props"][key], "{}:{key}", c["id"])
            }
        }
        frames += actual.len();
        if dump_path.is_some() {
            dumped.push(json!({"id":c["id"],"frames":output}));
        }
    }
    assert_eq!(frames, 358);
    if let Some(path) = dump_path {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(path)
            .unwrap();
        f.write_all(&serde_json::to_vec(&dumped).unwrap()).unwrap();
    }
}
