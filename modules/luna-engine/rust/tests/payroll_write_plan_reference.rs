mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    input::{finance_rows::RawNetPayTimeline, javascript_date, net_form::InitialNetSettings},
    runtime::payroll_form::plan::{NetPlanSource, TimingPlanSource},
};
use serde_json::{Value, json};
use std::sync::Arc;
fn epoch(value: &Value) -> f64 {
    match value.as_str() {
        Some("NaN") => f64::NAN,
        Some("Infinity") => f64::INFINITY,
        Some("-Infinity") => f64::NEG_INFINITY,
        _ => value.as_f64().unwrap(),
    }
}
fn error(value: luna_engine::input::InputError) -> Value {
    json!({"$error":{"name":value.name(),"message":value.message()}})
}
#[test]
fn original_real_sqlite_writes_match_closed_native_plan_values_and_guard_order() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/payroll-write-plan-golden.json"
    ));
    for case in fixture["cases"].as_array().unwrap() {
        let input = &case["input"];
        let actual = (|| {
            if input["kind"] == "TIMING" {
                TimingPlanSource::from_raw_row(
                    input.get("preference").filter(|value| !value.is_null()),
                    epoch(&input["epoch"]),
                )?
                .set_lag(
                    input["month"].as_str().unwrap(),
                    input["choice"].as_str().unwrap(),
                )
            } else {
                let timeline = RawNetPayTimeline::try_from_rows(Arc::new(
                    input["rows"].as_array().unwrap().clone(),
                ))?;
                let source = NetPlanSource::new(Arc::new(timeline), epoch(&input["epoch"]));
                if input["kind"] == "CONTINUOUS" {
                    source.continuous_save(&InitialNetSettings::try_from_raw(&input["settings"])?)
                } else {
                    source.reset_annual(input["year"].as_i64().unwrap() as i32)
                }
            }
        })()
        .map(|plan| plan.value().clone())
        .unwrap_or_else(error);
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
#[test]
fn full_javascript_timeclip_range_and_iso_milliseconds_match_original_date() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/payroll-write-plan-golden.json"
    ));
    for case in fixture["dateCases"].as_array().unwrap() {
        let actual = javascript_date::iso_from_epoch_milliseconds(epoch(&case["epoch"]))
            .map(|value| json!({"value":value}))
            .unwrap_or_else(error);
        assert_eq!(actual, case["expected"], "epoch {}", case["epoch"]);
    }
}
