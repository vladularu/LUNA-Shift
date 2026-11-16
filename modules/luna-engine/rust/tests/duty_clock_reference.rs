mod common;
use luna_engine::input::special_duty_clock;
use serde_json::Value;
#[test]
fn all_original_clock_helpers_and_actual_time_block_callbacks_match() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/duty-clock-golden.json")).unwrap();
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 3237);
    for case in fixture["cases"].as_array().unwrap() {
        let actual = special_duty_clock::execute(
            serde_json::from_value(case["operation"].clone()).unwrap(),
            &case["input"],
        )
        .unwrap();
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}

#[test]
fn invalid_numeric_clocks_do_not_turn_into_midnight_and_commands_are_closed() {
    use serde_json::json;
    use special_duty_clock::DutyClockOperation as Op;
    let actual = special_duty_clock::execute(
        Op::ChangeClock,
        &json!({"part":{"start":null,"end":null,"breakMinutes":0},"field":"end","time":"08:00"}),
    )
    .unwrap();
    assert!(actual["value"]["start"].is_null());
    assert_eq!(actual["value"]["end"], Value::Null);
    assert!(special_duty_clock::execute(Op::DayLabel, &json!({"day":1,"ready":true})).is_err());
    assert!(special_duty_clock::execute(Op::DayLabel, &json!({})).is_err());
    assert!(serde_json::from_value::<Op>(json!("READY_DUTY")).is_err());
}
