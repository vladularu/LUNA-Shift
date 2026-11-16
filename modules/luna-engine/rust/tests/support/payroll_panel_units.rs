use super::*;
fn assert_observation(actual: &Value, expected: &Value, id: &str) {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => assert_eq!(a.as_f64(), b.as_f64(), "{id}"),
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{id}");
            for (a, b) in a.iter().zip(b) {
                assert_observation(a, b, id)
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len(), "{id}");
            for (k, a) in a {
                assert_observation(
                    a,
                    b.get(k).unwrap_or_else(|| panic!("{id}: missing {k}")),
                    id,
                )
            }
        }
        _ => assert_eq!(actual, expected, "{id}"),
    }
}
#[path = "value_pool_source_numbers.rs"]
mod value_pool;
fn reference() -> Value {
    value_pool::decode(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../reference/payroll-panel-golden.json"
    )))
}
#[test]
fn positive_special_duties_are_native_priced_once_then_presented_like_original_jsx() {
    let source = reference();
    let resolver = crate::rules::RuleResolver::bundled().unwrap();
    let cases = source["specialCases"].as_array().unwrap();
    assert_eq!(cases.len(), 126);
    for c in cases {
        let i = &c["input"];
        let lines = crate::pay::special::calculate_special_duty_pay(
            i["month"].as_str().unwrap(),
            i["entries"].as_array().unwrap(),
            &i["profile"],
            &resolver,
        )
        .unwrap();
        let actual =
            Value::Array(special::present(&json!({"specialDutyBreakdowns":lines})).unwrap());
        assert_observation(&actual, &c["expected"], c["id"].as_str().unwrap());
    }
}
#[test]
fn basis_display_keeps_original_cross_year_pension_and_annual_notes() {
    let source = reference();
    let cases = source["basisCases"].as_array().unwrap();
    assert_eq!(cases.len(), 12);
    for c in cases {
        let a = &c["args"];
        let actual = Value::Array(
            basis::present_values(
                a["month"].as_str().unwrap(),
                &a["pay"],
                &c["annual"],
                Some(&a["forecast"]),
            )
            .unwrap(),
        );
        assert_observation(&actual, &c["expected"], c["id"].as_str().unwrap());
    }
}
#[test]
fn display_sign_and_panel_budget_are_explicit() {
    let d = euro(-0.0);
    assert_eq!(d["negativeZero"], true);
    let roundtrip: Value = serde_json::from_str(&serde_json::to_string(&d).unwrap()).unwrap();
    assert_eq!(roundtrip["negativeZero"], true);
    let error =
        special::present(&json!({"specialDutyBreakdowns":vec![Value::Null;2049]})).unwrap_err();
    assert_eq!(error.code, "PAYROLL_PANEL_LIMIT");
}
