mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::calendar::{
    incoming::shared_calendar_days,
    recurrence::CollationRanks,
    widget::{WidgetRowOptions, WidgetRows},
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
fn rows_projection(day: &Value) -> Value {
    let shifts = day["shifts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            let mut object = serde_json::Map::new();
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
                    object.insert(key.into(), value.clone());
                }
            }
            Value::Object(object)
        })
        .collect::<Vec<_>>();
    json!({"date":day["date"],"shifts":shifts,"appointments":day["appointments"]})
}
#[test]
fn native_widget_business_rows_match_all_original_frames_and_grids() {
    let source = value_pool::decode(include_str!("../../reference/widget-golden.json"));
    let ranks: Value =
        serde_json::from_str(include_str!("../../reference/widget-platform-ranks.json")).unwrap();
    let mut cases = 0;
    let mut days = 0;
    for c in source["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["operation"] == "widget.timeline")
    {
        let i = &c["input"];
        let facts = ranks["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == c["id"])
            .unwrap();
        let collation = CollationRanks::from(
            serde_json::from_value::<BTreeMap<String, u32>>(facts["ranks"].clone()).unwrap(),
        );
        let display = &i["display"];
        let options = WidgetRowOptions {
            show_shifts: display
                .get("showShifts")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            show_appointments: display.get("showAppointments").and_then(Value::as_bool)
                != Some(false),
            show_shift_times: display
                .get("showShiftTimes")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            show_shift_duration: display
                .get("showShiftDuration")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        };
        let zone = i["timeZone"].as_str().unwrap();
        let own =
            WidgetRows::new(i["entries"].as_array().unwrap(), &collation, zone, options).unwrap();
        let incoming = Arc::new(
            i.get("sharedCalendars")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        );
        for frame in c["expected"].as_array().unwrap() {
            let props = &frame["props"];
            let shared = shared_calendar_days(
                incoming.clone(),
                zone,
                Some(frame["observedEpochMilliseconds"].as_f64().unwrap()),
                None,
            )
            .unwrap();
            let mut seen = BTreeSet::new();
            for grid in ["days", "weekDays", "monthDays"] {
                for day in props[grid].as_array().unwrap() {
                    let date = day["date"].as_str().unwrap();
                    if !seen.insert(date) {
                        continue;
                    }
                    let actual = serde_json::to_value(own.day(date, &shared).unwrap()).unwrap();
                    common::assert_json_eq(
                        &rows_projection(&actual),
                        &rows_projection(day),
                        c["id"].as_str().unwrap(),
                    );
                    for row in actual["shifts"].as_array().unwrap() {
                        let id = row["id"].as_str().unwrap();
                        let own_source = i["entries"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .find(|e| e["id"] == id && e["kind"] != "APPOINTMENT");
                        if row["origin"] == "OWN" {
                            assert_eq!(row["rawSymbol"], own_source.unwrap()["symbol"]);
                        } else {
                            assert_eq!(row["origin"], "SHARED");
                            let source = incoming
                                .iter()
                                .flat_map(|c| {
                                    c["entries"].as_array().unwrap().iter().map(move |e| (c, e))
                                })
                                .find(|(c, e)| {
                                    format!(
                                        "shared:{}:{}",
                                        c["calendar"]["id"].as_str().unwrap(),
                                        e["id"].as_str().unwrap()
                                    ) == id
                                })
                                .unwrap();
                            assert_eq!(row["rawSymbol"], source.1["symbol"]);
                        }
                    }
                    days += 1;
                }
            }
        }
        cases += 1;
    }
    assert_eq!(cases, 92);
    assert!(days > 10000);
}

#[test]
fn widget_rows_reject_missing_genuine_platform_comparison_facts() {
    let source = value_pool::decode(include_str!("../../reference/widget-golden.json"));
    let c = source["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            c["operation"] == "widget.timeline"
                && !c["input"]["entries"].as_array().unwrap().is_empty()
        })
        .unwrap();
    let options = WidgetRowOptions {
        show_shifts: true,
        show_appointments: true,
        show_shift_times: true,
        show_shift_duration: false,
    };
    assert!(
        WidgetRows::new(
            c["input"]["entries"].as_array().unwrap(),
            &CollationRanks::from(BTreeMap::new()),
            "Europe/Berlin",
            options
        )
        .is_err()
    );
}
