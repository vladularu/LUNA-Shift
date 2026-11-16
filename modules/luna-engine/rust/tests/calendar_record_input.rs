mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    calendar::{
        recurrence::CollationRanks,
        window::{WindowOptions, WindowSpec},
    },
    contract::SourceState,
    runtime::calendar_only::CalendarRows,
};
use serde_json::{Value, json};
use std::collections::BTreeSet;

fn source(value: Value) -> SourceState {
    serde_json::from_value(json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":value}}})).unwrap()
}
#[test]
fn existing_calendar_source_projects_exact_provider_records_through_original_160_windows() {
    let data = value_pool::decode(include_str!("../../reference/calendar-window-golden.json"));
    let mut compared = 0;
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let rows = CalendarRows::prepare(&source(
            json!({"kind":"RECORDED_ENTRIES","entries":input["entries"]}),
        ))
        .unwrap();
        let spec: WindowSpec = serde_json::from_value(input["spec"].clone()).unwrap();
        let options: WindowOptions = serde_json::from_value(input["options"].clone()).unwrap();
        let prepared = rows.index().prepare(&spec).unwrap();
        let candidates = case["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_owned())
            .collect::<BTreeSet<_>>();
        assert_eq!(prepared.candidates(), &candidates, "{}", case["id"]);
        let ranks: CollationRanks = serde_json::from_value(case["ranks"].clone()).unwrap();
        let actual =
            serde_json::to_value(prepared.finalize(&ranks).unwrap().index(options).unwrap())
                .unwrap();
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        compared += 1;
    }
    assert_eq!(compared, 160);
}
#[test]
fn recorded_input_accepts_no_host_indices_ready_result_or_excess_rows() {
    for raw in [
        json!({"kind":"RECORDED_ENTRIES","entries":[],"ready":true}),
        json!({"kind":"RECORDED_ENTRIES","entries":[],"platformCollationRanks":{}}),
        json!({"kind":"RECORDED_ENTRIES","entries":[{"kind":"SHIFT","date":"2026-11-01","deletedAt":null}]}),
        json!({"kind":"RECORDED_ENTRIES","entries":vec![Value::Null;50_001]}),
    ] {
        assert!(CalendarRows::prepare(&source(raw)).is_err());
    }
}
