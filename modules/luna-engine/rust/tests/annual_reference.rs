use luna_engine::net::annual_payment::{
    add_annual_salary_payment, estimate_cross_year_arrears_tax, validate_annual_salary_payments,
};
use luna_engine::net::{
    AvailableNetPay, CalculationMode, NetPayProfile, NetPayResult, calculate_monthly_net_pay,
};
use serde::Serialize;
use serde_json::{Value, json};

fn available(input: &Value) -> Box<AvailableNetPay> {
    match calculate_monthly_net_pay(input, CalculationMode::Forecast).expect("bounded frozen facts")
    {
        NetPayResult::Available(pay) => pay,
        other => panic!("unavailable fixture: {other:?}"),
    }
}
fn snapshot<T: Serialize, E: std::fmt::Display>(result: Result<T, E>) -> Value {
    match result {
        Ok(value) => serde_json::to_value(value).expect("JSON"),
        Err(error) => json!({"$error":error.to_string()}),
    }
}

#[test]
fn annual_caps_march_clause_cross_year_tax_and_validation_match_frozen_ts() {
    let reference: Value =
        serde_json::from_str(include_str!("../../reference/annual-payment-golden.json"))
            .expect("frozen annual facts");
    let mut count = 0;
    for case in reference["cases"].as_array().expect("cases") {
        let input = &case["input"];
        let actual = match case["operation"].as_str().expect("operation") {
            "annual" => {
                let base = available(&input["base"]);
                let profile = NetPayProfile::parse(&input["base"]["profile"])
                    .expect("validated fixture profile");
                snapshot(add_annual_salary_payment(
                    &base,
                    &profile,
                    &input["payments"],
                ))
            }
            "validate" => snapshot(validate_annual_salary_payments(&input["payments"])),
            "cross-year" => {
                let base = available(&input["base"]);
                let regular = available(&input["regular"]);
                let profile = NetPayProfile::parse(&input["base"]["profile"]).expect("profile");
                snapshot(estimate_cross_year_arrears_tax(
                    &base,
                    &regular,
                    &profile,
                    &input["payments"],
                    input["priorYearTaxableCents"].as_i64().expect("prior"),
                    input["includedAnnualGrossCents"].as_i64().expect("annual"),
                ))
            }
            "finalize" => continue,
            other => panic!("unexpected operation {other}"),
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
        count += 1;
    }
    assert_eq!(count, 413);
}
