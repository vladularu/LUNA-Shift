use luna_engine::net::{CalculationMode, calculate_monthly_net_pay};
use serde_json::Value;

#[test]
fn monthly_net_matches_every_frozen_full_output() {
    let reference: Value = serde_json::from_str(include_str!("../../reference/cases.json"))
        .expect("independent frozen TypeScript reference");
    let mut count = 0;
    for case in reference["cases"].as_array().expect("cases") {
        if case["operation"] != "net.calculateMonthlyNetPay" {
            continue;
        }
        let mode = if case["input"]["mode"] == "FORECAST" {
            CalculationMode::Forecast
        } else {
            CalculationMode::Verified
        };
        let actual = calculate_monthly_net_pay(&case["input"]["input"], mode)
            .expect("bounded payroll calculation");
        assert_eq!(
            serde_json::to_value(actual).expect("result"),
            case["expected"],
            "{}",
            case["id"]
        );
        count += 1;
    }
    assert_eq!(count, 41);
}

#[test]
fn pension_forecast_optional_values_and_unsupported_boundaries_match_frozen_ts() {
    let reference: Value =
        serde_json::from_str(include_str!("../../reference/net-2026-golden.json"))
            .expect("frozen TypeScript edge matrix");
    let cases = reference["cases"].as_array().expect("cases");
    assert_eq!(cases.len(), 756);
    for case in cases {
        let mode = if case["mode"] == "FORECAST" {
            CalculationMode::Forecast
        } else {
            CalculationMode::Verified
        };
        let original = case["input"].clone();
        let actual = calculate_monthly_net_pay(&case["input"], mode)
            .expect("validated payroll does not produce kernel failures");
        assert_eq!(
            serde_json::to_value(actual).expect("result"),
            case["expected"],
            "{}",
            case["id"]
        );
        assert_eq!(case["input"], original, "input mutation: {}", case["id"]);
    }
}
