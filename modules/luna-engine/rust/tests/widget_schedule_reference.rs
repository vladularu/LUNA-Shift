mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::calendar::widget::WidgetClock;
use serde_json::{Value, json};
fn projected_days(value: &Value) -> Value {
    json!(value.as_array().unwrap().iter().map(|day|json!({"date":day["date"],"weekday":day["weekday"],"weekdayIndex":day["weekdayIndex"],"shortDate":day["shortDate"]})).collect::<Vec<_>>())
}
#[test]
fn every_original_widget_timeline_keeps_native_frame_states_dates_and_complete_grids() {
    let source = value_pool::decode(include_str!("../../reference/widget-golden.json"));
    let mut compared = 0;
    for c in source["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["operation"] == "widget.timeline")
    {
        let i = &c["input"];
        let clock = WidgetClock::from_epoch(
            i["observedEpochMilliseconds"].as_i64().unwrap(),
            i["timeZone"].as_str().unwrap(),
        )
        .unwrap();
        let fetched = i
            .get("sharedCalendars")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|cached| cached["fetchedAt"].as_str())
            .collect::<Vec<_>>();
        let actual = serde_json::to_value(
            clock
                .frame_plan(i["hasProfile"].as_bool().unwrap(), &fetched)
                .unwrap(),
        )
        .unwrap();
        let expected=json!(c["expected"].as_array().unwrap().iter().map(|frame|{let p=&frame["props"];json!({"observedEpochMilliseconds":frame["observedEpochMilliseconds"],"todayDate":p["todayDate"],"month":p["month"],"monthTitle":p["monthTitle"],"state":p["state"],"days":projected_days(&p["days"]),"weekDays":projected_days(&p["weekDays"]),"monthDays":projected_days(&p["monthDays"])})}).collect::<Vec<_>>());
        common::assert_json_eq(&actual, &expected, c["id"].as_str().unwrap());
        compared += 1;
    }
    assert_eq!(compared, 92);
}
