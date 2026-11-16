use luna_engine::net::payment_schedule::*;
use serde::Serialize;
use serde_json::{Value, json};

fn value<T: Serialize>(value: T) -> Value {
    serde_json::to_value(value).expect("serialized schedule")
}
fn compute(operation: &str, input: &Value) -> Result<Value, ScheduleError> {
    if operation == "validate" {
        return validate_salary_payment_preferences(&input["value"]).map(value);
    }
    let month = input["month"].as_str().unwrap_or("");
    if operation == "add-months" {
        return add_salary_payment_months(month, input["delta"].as_i64().expect("delta") as i32)
            .map(value);
    }
    let preferences = validate_salary_payment_preferences(&input["preferences"])?;
    let group = || {
        serde_json::from_value::<PaymentGroup>(input["group"].clone()).map_err(|_| ScheduleError)
    };
    match operation {
        "period" => resolve_salary_payment_period(&preferences, month).map(value),
        "component" => salary_component_payment_month(&preferences, month, group()?).map(value),
        "sources" => salary_payment_sources(&preferences, month, group()?).map(value),
        "required" => salary_payment_required_months(
            month,
            &preferences,
            serde_json::from_value(input["perspective"].clone()).expect("perspective"),
        )
        .map(value),
        "set-period" => set_salary_payment_period(&preferences, &input["period"]).map(value),
        "set-empty" => set_salary_payment_empty_month(
            &preferences,
            month,
            input["reviewed"].as_bool().expect("reviewed"),
        )
        .map(value),
        "set-lag" => set_salary_payment_lag(
            &preferences,
            month,
            input["lag"].as_u64().expect("lag") as u8,
        )
        .map(value),
        other => panic!("unexpected operation {other}"),
    }
}
#[test]
fn effective_periods_delays_empty_months_and_sources_match_frozen_ts() {
    let reference: Value =
        serde_json::from_str(include_str!("../../reference/payment-schedule-golden.json"))
            .expect("payment schedule golden");
    let cases = reference["cases"].as_array().expect("cases");
    assert_eq!(cases.len(), 812);
    for case in cases {
        let actual = compute(
            case["operation"].as_str().expect("operation"),
            &case["input"],
        )
        .unwrap_or_else(|error| json!({"$error":error.to_string()}));
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}
