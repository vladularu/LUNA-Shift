use luna_engine::pay::periods::payroll_employment_periods;
use serde_json::{Value, json};

#[test]
fn material_payroll_periods_and_metadata_coalescing_match_frozen_ts() {
    let reference: Value =
        serde_json::from_str(include_str!("../../reference/payroll-periods-golden.json"))
            .expect("periodfacts");
    let cases = reference["cases"].as_array().expect("cases");
    assert_eq!(cases.len(), 67);
    for case in cases {
        let input = &case["input"];
        let actual = payroll_employment_periods(
            &input["profile"],
            input["month"].as_str().expect("month"),
            input["lastDay"].as_str().expect("lastday"),
        )
        .unwrap_or_else(|error| json!({"$error":error.to_string()}));
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}
