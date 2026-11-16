mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    EngineError,
    calendar::presentation::{DisplayOptions, LabelMode, preview, rows},
};
use serde::Deserialize;
use serde_json::Value;
fn run(case: &Value) -> Result<Value, EngineError> {
    let i = &case["input"];
    if i["validatedSpecialDuty"] == true {
        let duty =
            luna_engine::input::special_duty::validate_special_duty(i["entry"].get("specialDuty"))
                .unwrap();
        luna_engine::input::special_duty::validate_duty_parent(duty.as_ref(), &i["entry"]).unwrap();
    }
    match case["kind"].as_str().unwrap() {
        "shift" => rows::shift_detail(
            &i["entry"],
            DisplayOptions::deserialize(&i["options"]).unwrap(),
            i["timeZone"].as_str().unwrap(),
        )
        .map(|r| r.map_or(Value::Null, Value::String)),
        "shared" => rows::shared_shift_detail(
            &i["entry"],
            i["startTime"].as_str().unwrap(),
            DisplayOptions::deserialize(&i["options"]).unwrap(),
        )
        .map(|r| r.map_or(Value::Null, Value::String)),
        "label" => rows::label(&i["entry"], LabelMode::deserialize(&i["mode"]).unwrap())
            .map(|r| serde_json::to_value(r).unwrap()),
        "preview" => preview::entry_preview(
            i["entries"].as_array().unwrap(),
            i["capacity"].as_f64().unwrap(),
            i["detailed"].as_bool().unwrap(),
            i["reserve"].as_bool().unwrap(),
        )
        .map(|r| serde_json::to_value(r).unwrap()),
        "combined" => preview::combined_preview(
            i["own"].as_array().unwrap(),
            i["shared"].as_array().unwrap(),
            i["weekHeight"].as_f64().unwrap(),
            i["detailed"].as_bool().unwrap(),
            i["entryRowHeight"].as_f64().unwrap(),
        )
        .map(|r| serde_json::to_value(r).unwrap()),
        _ => panic!("Unexpected frozen case kind"),
    }
}
#[test]
fn all_original_calendar_display_expressions_match() {
    let corpus = value_pool::decode(include_str!(
        "../../reference/calendar-presentation-golden.json"
    ));
    assert_eq!(
        corpus["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = corpus["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 1203);
    for case in cases {
        let result = run(case);
        if case.get("error").is_some() {
            assert!(result.is_err(), "{}", case["id"]);
        } else {
            let actual = result.unwrap_or_else(|e| panic!("{}: {e:?}", case["id"]));
            common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        }
    }
}
#[test]
fn invalid_projection_requests_fail_boundedly_without_echoing_input() {
    use serde_json::json;
    assert!(LabelMode::deserialize(&json!("TITLE")).is_err());
    assert!(preview::entry_preview(&[], f64::NAN, false, false).is_err());
    assert!(preview::combined_preview(&[], &[], f64::INFINITY, false, 12.0).is_err());
    let too_many = vec![Value::Null; 100001];
    assert!(preview::entry_preview(&too_many, 1.0, false, false).is_err());
    let malformed = json!({"date":"private-user-input","endTime":"15:00","specialDuty":{"kind":"ON_CALL","endDay":i64::MAX,"callouts":[],"calloutsComplete":true}});
    let error = rows::special_duty_description(&malformed).unwrap_err();
    assert!(!format!("{error:?}").contains("private-user-input"));
}
#[test]
fn inactive_time_labels_do_not_read_a_zone_or_perform_time_arithmetic() {
    use serde_json::json;
    let row = json!({"date":"unused","startTime":"raw-start","endTime":"raw-end","breakMinutes":null,"allDay":false,"specialDuty":null});
    assert_eq!(
        rows::shift_detail(
            &row,
            DisplayOptions {
                show_shift_times: false,
                show_shift_duration: false
            },
            "unused"
        )
        .unwrap(),
        None
    );
    assert_eq!(
        rows::shift_detail(
            &row,
            DisplayOptions {
                show_shift_times: true,
                show_shift_duration: false
            },
            "unused"
        )
        .unwrap(),
        Some("raw-start".to_owned())
    );
}
