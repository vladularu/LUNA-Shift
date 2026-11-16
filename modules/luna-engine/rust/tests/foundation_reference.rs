use bigdecimal::BigDecimal;
use luna_engine::{EngineError, calendar, money, time};
use serde::Deserialize;
use serde_json::{Value, json};
use std::str::FromStr;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TimeInput {
    shift: time::ShiftTime,
    time_zone: String,
}

fn run(operation: &str, input: &Value) -> Result<Value, EngineError> {
    let string = |key| {
        input
            .get(key)
            .and_then(Value::as_str)
            .ok_or(EngineError::InvalidDate)
    };
    match operation {
        "money.roundRatio" => money::round_ratio(
            input["numerator"]
                .as_i64()
                .ok_or(EngineError::InvalidMoney)?,
            input["denominator"]
                .as_i64()
                .ok_or(EngineError::InvalidMoney)?,
        )
        .map(Value::from),
        "calendar.monthGrid" => serde_json::to_value(calendar::month_grid(string("month")?)?)
            .map_err(|_| EngineError::Overflow),
        "calendar.monthRange" => serde_json::to_value(calendar::month_range(string("month")?)?)
            .map_err(|_| EngineError::Overflow),
        "calendar.isoWeek" => calendar::iso_week(string("date")?).map(Value::from),
        "calendar.addMonths" => calendar::add_months(
            string("month")?,
            input["amount"]
                .as_i64()
                .and_then(|n| i32::try_from(n).ok())
                .ok_or(EngineError::InvalidDate)?,
        )
        .map(Value::from),
        "time.shiftBounds" | "time.shiftMinutes" => {
            let input: TimeInput =
                serde_json::from_value(input.clone()).map_err(|_| EngineError::InvalidTime)?;
            if operation == "time.shiftBounds" {
                serde_json::to_value(time::shift_bounds(&input.shift, &input.time_zone)?)
                    .map_err(|_| EngineError::Overflow)
            } else {
                serde_json::to_value(time::shift_minutes(&input.shift, &input.time_zone)?)
                    .map_err(|_| EngineError::Overflow)
            }
        }
        _ => unreachable!("test dispatch only receives explicitly supported operations"),
    }
}

fn same_value(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => {
            BigDecimal::from_str(&a.to_string()).expect("JSON number")
                == BigDecimal::from_str(&b.to_string()).expect("JSON number")
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(x, y)| same_value(x, y))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, value)| b.get(key).is_some_and(|other| same_value(value, other)))
        }
        _ => actual == expected,
    }
}

#[test]
fn all_frozen_foundation_cases_match_without_numeric_tolerance() {
    let fixtures: Value =
        serde_json::from_str(include_str!("../../reference/cases.json")).expect("frozen reference");
    assert_eq!(
        fixtures["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let operations = [
        "money.roundRatio",
        "calendar.monthGrid",
        "calendar.monthRange",
        "calendar.isoWeek",
        "calendar.addMonths",
        "time.shiftBounds",
        "time.shiftMinutes",
    ];
    let mut compared = 0;
    for case in fixtures["cases"].as_array().expect("cases") {
        let op = case["operation"].as_str().expect("operation");
        if !operations.contains(&op) {
            continue;
        }
        let actual = match run(op, &case["input"]) {
            Ok(value) => value,
            Err(EngineError::InvalidMoney) => {
                json!({"$error":{"name":"Error","message":"Ungültige Berechnungsgrundlage."}})
            }
            Err(error) => panic!("{}: unexpected Rust error {error}", case["id"]),
        };
        assert!(
            same_value(&actual, &case["expected"]),
            "{}\nactual: {actual}\nexpected: {}",
            case["id"],
            case["expected"]
        );
        compared += 1;
    }
    assert_eq!(
        compared, 54,
        "Coverage must not silently shrink; remaining engine operations are not claimed implemented here."
    );
}
