mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::calendar::{
    recurrence::CollationRanks,
    widget::{WidgetClock, WidgetRowOptions},
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};
fn day(value: &Value) -> Value {
    let mut object = serde_json::Map::new();
    for key in [
        "date",
        "weekday",
        "weekdayIndex",
        "shortDate",
        "appointments",
    ] {
        object.insert(key.into(), value[key].clone());
    }
    object.insert(
        "shifts".into(),
        json!(
            value["shifts"]
                .as_array()
                .unwrap()
                .iter()
                .map(|row| {
                    let mut result = serde_json::Map::new();
                    for key in [
                        "id",
                        "title",
                        "start",
                        "end",
                        "nextDay",
                        "color",
                        "detail",
                        "ownerName",
                        "ownerColor",
                    ] {
                        if let Some(value) = row.get(key) {
                            result.insert(key.into(), value.clone());
                        }
                    }
                    Value::Object(result)
                })
                .collect::<Vec<_>>()
        ),
    );
    Value::Object(object)
}
fn frame(value: &Value) -> Value {
    let mut result = serde_json::Map::new();
    for key in [
        "observedEpochMilliseconds",
        "todayDate",
        "month",
        "monthTitle",
        "state",
    ] {
        result.insert(key.into(), value[key].clone());
    }
    for key in ["days", "weekDays", "monthDays"] {
        result.insert(
            key.into(),
            json!(
                value[key]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(day)
                    .collect::<Vec<_>>()
            ),
        );
    }
    Value::Object(result)
}
#[test]
fn complete_native_business_timelines_preserve_every_original_typed_frame() {
    let corpus = value_pool::decode(include_str!("../../reference/widget-golden.json"));
    let locale: Value =
        serde_json::from_str(include_str!("../../reference/widget-platform-ranks.json")).unwrap();
    let mut compared = 0;
    let dump_path = std::env::var("LUNA_WIDGET_NATIVE_OUTPUT").ok();
    let mut dumped = Vec::new();
    for c in corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["operation"] == "widget.timeline")
    {
        let i = &c["input"];
        let facts = locale["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["id"] == c["id"])
            .unwrap();
        let ranks: CollationRanks =
            serde_json::from_value::<BTreeMap<String, u32>>(facts["ranks"].clone())
                .unwrap()
                .into();
        let d = &i["display"];
        let options = WidgetRowOptions {
            show_shifts: d.get("showShifts").and_then(Value::as_bool).unwrap_or(true),
            show_appointments: d.get("showAppointments").and_then(Value::as_bool) != Some(false),
            show_shift_times: d
                .get("showShiftTimes")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            show_shift_duration: d
                .get("showShiftDuration")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        };
        let shared = Arc::new(
            i.get("sharedCalendars")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        );
        let clock = WidgetClock::from_epoch(
            i["observedEpochMilliseconds"].as_i64().unwrap(),
            i["timeZone"].as_str().unwrap(),
        )
        .unwrap();
        let wire = serde_json::to_value(
            clock
                .business_timeline(
                    i["entries"].as_array().unwrap(),
                    &ranks,
                    shared,
                    options,
                    i["hasProfile"].as_bool().unwrap(),
                )
                .unwrap(),
        )
        .unwrap();
        let expected = json!(
            c["expected"]
                .as_array()
                .unwrap()
                .iter()
                .map(|f| {
                    let mut p = f["props"].clone();
                    p["observedEpochMilliseconds"] = f["observedEpochMilliseconds"].clone();
                    frame(&p)
                })
                .collect::<Vec<_>>()
        );
        let actual = json!(
            wire.as_array()
                .unwrap()
                .iter()
                .map(frame)
                .collect::<Vec<_>>()
        );
        common::assert_json_eq(&actual, &expected, c["id"].as_str().unwrap());
        if dump_path.is_some() {
            dumped.push(json!({"id":c["id"],"frames":wire}));
        }
        compared += 1;
    }
    assert_eq!(compared, 92);
    if let Some(path) = dump_path {
        let file = std::fs::File::create(path).unwrap();
        serde_json::to_writer(file, &dumped).unwrap();
    }
}
