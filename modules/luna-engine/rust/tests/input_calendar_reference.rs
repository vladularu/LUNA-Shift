mod common;
use luna_engine::input::{InputError, calendar as c, special_duty as s};
use serde_json::{Value, json};
fn compare(case: &Value, result: Result<Value, InputError>) {
    if case["malformedType"] == true
        || case["engineDiagnostic"] == true
        || case["nativeMalformed"] == true
    {
        assert!(result.is_err(), "safe malformed rejection {}", case["id"]);
        return;
    }
    let actual = match result {
        Ok(value) => json!({"value":value}),
        Err(error) => json!({"$error":error.message(),"name":error.name()}),
    };
    common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
}
#[test]
fn pure_calendar_validation_matches_original_normalization_and_errors() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/input-calendar-golden.json")).unwrap();
    assert_eq!(data["cases"].as_array().unwrap().len(), 712);
    for case in data["cases"].as_array().unwrap() {
        let x = &case["input"];
        let result = match case["operation"].as_str().unwrap() {
            "requireLocalDate" => c::require_local_date(x).map(Value::String),
            "requireLocalMonth" => c::require_local_month(x).map(Value::String),
            "requireLocalTime" => c::require_local_time(x).map(Value::String),
            "requireNonEmpty" => {
                c::require_non_empty(&x["value"], x["label"].as_str().unwrap()).map(Value::String)
            }
            "requireColor" => c::require_color(x).map(Value::String),
            "requireAllowanceStatus" => c::require_allowance_status(x).map(Value::String),
            "requirePositiveRevision" => c::require_positive_revision(x),
            "validateMonthlyTariffDecision" => c::validate_monthly_tariff_decision(x),
            "validateShift" => c::validate_shift(x),
            "validateAppointment" => c::validate_appointment(x),
            "validateTemplate" => c::validate_template(x),
            op => panic!("Unknown {op}"),
        };
        compare(case, result);
    }
}
#[test]
fn versioned_duties_agreements_and_parent_dst_validation_match_original() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/input-special-duty-golden.json"
    ))
    .unwrap();
    assert_eq!(data["cases"].as_array().unwrap().len(), 841);
    for case in data["cases"].as_array().unwrap() {
        let x = &case["input"];
        let result = match case["operation"].as_str().unwrap() {
            "validateSpecialDuty" => {
                s::validate_special_duty(Some(x)).map(|v| v.unwrap_or(Value::Null))
            }
            "validateStandbyAgreement" => s::validate_standby_agreement(x),
            "validateDutyParent" => {
                s::validate_duty_parent(Some(&x["duty"]), &x["parent"]).map(|()| Value::Null)
            }
            "dutyInstant" => s::duty_instant_milliseconds(
                x["date"].as_str().unwrap(),
                x["minute"].as_i64().unwrap(),
                x["timeZone"].as_str().unwrap(),
            )
            .map(|v| json!(v)),
            "plannedSpecialDuty" => s::planned_special_duty(x),
            op => panic!("Unknown {op}"),
        };
        compare(case, result);
    }
}

#[test]
fn stored_backup_duty_parent_preserves_the_original_narrow_validation_role() {
    use luna_engine::input::special_duty_command::DutyFormCommand;
    // Original DevTools backups deliberately preserve legacy raw clocks and metadata.
    // An absent duty must not invoke the complete SHIFT input/stored-record validator.
    let value: DutyFormCommand = serde_json::from_value(json!({"kind":"VALIDATE_PARENT","value":null,"parent":{"date":"2026-05-04","type":"DAY","allDay":false,"startTime":"7:00","endTime":"16:00","breakMinutes":30,"createdAt":"a"}})).unwrap();
    assert_eq!(value.execute().unwrap(), json!({"ok":true}));
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/input-special-duty-golden.json"
    ))
    .unwrap();
    let mut parents = 0;
    for case in data["cases"].as_array().unwrap() {
        if case["operation"] != "validateDutyParent"
            || case["malformedType"] == true
            || case["nativeMalformed"] == true
        {
            continue;
        }
        let input = &case["input"];
        // This family already supplies the validated duty used by the original parent caller.
        if s::validate_special_duty(Some(&input["duty"])).is_err() {
            continue;
        }
        let command: DutyFormCommand = serde_json::from_value(
            json!({"kind":"VALIDATE_PARENT","value":input["duty"],"parent":input["parent"]}),
        )
        .unwrap();
        let actual = command.execute().map(|_| Value::Null);
        compare(case, actual);
        parents += 1;
    }
    assert!(parents > 0);
}
