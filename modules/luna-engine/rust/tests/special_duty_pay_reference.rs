use bigdecimal::BigDecimal;
use luna_engine::{
    pay::special::{self, SpecialDutyError, callout, rates, standby, time_account, trace},
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::str::FromStr;

fn same_value(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(left), Value::Number(right)) => {
            BigDecimal::from_str(&left.to_string()).expect("number")
                == BigDecimal::from_str(&right.to_string()).expect("number")
        }
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|(left, right)| same_value(left, right))
        }
        (Value::Object(left), Value::Object(right)) => {
            left.len() == right.len()
                && left.iter().all(|(key, value)| {
                    right.get(key).is_some_and(|other| same_value(value, other))
                })
        }
        _ => left == right,
    }
}
fn run(case: &Value, resolver: &RuleResolver) -> Result<Value, SpecialDutyError> {
    let input = &case["input"];
    let profile = &input["profile"];
    let text = |key| input[key].as_str().expect("fixture string");
    match case["operation"].as_str().expect("operation") {
        "special.hourlyCents" => Ok(json!(rates::hourly_cents(text("date"), profile, resolver)?)),
        "special.overtimeRates" => Ok(json!(rates::overtime_rates(
            text("date"),
            profile,
            &input["shift"],
            resolver
        )?)),
        "special.standbyHourlyRate" => Ok(json!(rates::standby_hourly_rate(
            text("date"),
            profile,
            &input["agreement"],
            resolver
        )?)),
        "special.calculateStandbyPay" => {
            standby::calculate_standby_pay(&input["shift"], profile, resolver)
        }
        "special.calculateDutyCalloutPay" => callout::calculate_duty_callout_pay(
            &input["shift"],
            profile,
            serde_json::from_value(input["family"].clone()).expect("family"),
            resolver,
        ),
        "special.calculateSpecialDutyPay" => special::calculate_special_duty_pay(
            text("month"),
            input["entries"].as_array().expect("entries"),
            profile,
            resolver,
        )
        .map(Value::Array),
        "special.specialDutyTimeAccount" => time_account::special_duty_time_account(
            text("month"),
            input["entries"].as_array().expect("entries"),
            profile,
            resolver,
        )
        .map(|value| value.to_json()),
        "special.payrollTraces" => Ok(Value::Array(trace::payroll_traces_from_lines(
            &special::calculate_special_duty_pay(
                text("month"),
                input["entries"].as_array().expect("entries"),
                profile,
                resolver,
            )?,
        ))),
        op => panic!("Unknown fixture operation {op}"),
    }
}
#[test]
fn all_raw_special_duty_amounts_statuses_credits_and_traces_match() {
    let fixtures: Value =
        serde_json::from_str(include_str!("../../reference/special-duty-pay-golden.json"))
            .expect("frozen special duty reference");
    assert_eq!(
        fixtures["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = fixtures["cases"].as_array().expect("cases");
    assert_eq!(cases.len(), 766, "coverage must not silently shrink");
    let resolver = RuleResolver::bundled().expect("bundled rules");
    for case in cases {
        let actual = run(case, &resolver).unwrap_or_else(|error| panic!("{}: {error}", case["id"]));
        assert!(
            same_value(&actual, &case["expected"]),
            "{}\nactual {actual}\nexpected {}",
            case["id"],
            case["expected"]
        );
    }
}

#[test]
fn source_ieee_numbers_survive_the_json_boundary_bit_exactly() {
    for value in [
        0.49874999999999997_f64,
        29.924999999999997_f64,
        0.285_f64,
        1.005_f64,
    ] {
        let encoded = serde_json::to_string(&value).expect("JSON serialization");
        let decoded: f64 = serde_json::from_str(&encoded).expect("JSON deserialization");
        assert_eq!(
            decoded.to_bits(),
            value.to_bits(),
            "JSON must preserve source IEEE value {encoded}"
        );
    }
}
