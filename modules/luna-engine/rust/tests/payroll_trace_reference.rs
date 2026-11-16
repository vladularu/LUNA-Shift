use luna_engine::pay::trace::{TariffPayrollOptions, tariff_payroll_trace};
use luna_engine::rules::RuleResolver;
use serde_json::{Value, json};

fn canonical_numbers(value: &mut Value) {
    match value {
        Value::Number(number) if number.is_f64() => {
            let numeric = number.as_f64().expect("number");
            if numeric.fract() == 0.0
                && numeric.abs() <= luna_engine::money::MAX_SAFE_INTEGER as f64
            {
                *value = json!(numeric as i64);
            }
        }
        Value::Object(object) => {
            for value in object.values_mut() {
                canonical_numbers(value);
            }
        }
        Value::Array(array) => {
            for value in array {
                canonical_numbers(value);
            }
        }
        _ => {}
    }
}

#[test]
fn universal_tariff_trace_matches_every_family_and_legacy_source() {
    let reference: Value =
        serde_json::from_str(include_str!("../../reference/payroll-trace-golden.json"))
            .expect("universaltracegolden");
    let resolver = RuleResolver::bundled().expect("frozenbundledrules");
    let cases = reference["cases"].as_array().expect("cases");
    assert_eq!(cases.len(), 216);
    let mut failures = vec![];
    for case in cases {
        let input = &case["input"];
        let options = TariffPayrollOptions {
            allowance_status: input["options"]["allowanceStatus"]
                .as_str()
                .expect("allowance")
                .into(),
            saturday_shift_work: input["options"]["saturdayShiftWork"]
                .as_bool()
                .expect("Saturday"),
            regular_shift_work: input["options"]["regularShiftWork"]
                .as_bool()
                .expect("regular"),
        };
        let mut actual =
            match tariff_payroll_trace(&input["shift"], &input["profile"], &options, &resolver) {
                Ok(value) => serde_json::to_value(value).expect("trace"),
                Err(error) => json!({"$error":error.to_string()}),
            };
        let mut expected = case["expected"].clone();
        canonical_numbers(&mut actual);
        canonical_numbers(&mut expected);
        if actual != expected {
            failures.push(format!(
                "{}\nactual:{actual}\nexpected:{expected}",
                case["id"]
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{}differences:\n{}",
        failures.len(),
        failures
            .into_iter()
            .take(4)
            .collect::<Vec<_>>()
            .join("\n\n")
    );
}
