mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::runtime::financial_report::annual_details;
use serde_json::{Value, json};

#[test]
fn original_salary_and_both_premium_jsx_states_match_every_frozen_case() {
    let corpus = value_pool::decode(include_str!(
        "../../reference/annual-financial-details-golden.json"
    ));
    let cases = corpus["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 135);
    for case in cases {
        let input = &case["input"];
        let actual = json!({
            "salary":annual_details::salary(input).unwrap(),
            "premium":annual_details::premium(input,false).unwrap(),
            "pending":annual_details::premium(input,true).unwrap()
        });
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}

#[test]
fn malformed_report_never_becomes_ready_zero_or_a_guessed_month() {
    for input in [
        Value::Null,
        json!({}),
        json!({"year":2026,"availablePayMonthCount":0,"salarySource":"TARIFF","months":[]}),
        json!({"year":2026,"availablePayMonthCount":13,"salarySource":"TARIFF","months":[]}),
    ] {
        assert!(annual_details::salary(&input).is_err());
        assert!(annual_details::premium(&input, false).is_err());
        assert!(annual_details::premium(&input, true).is_err());
    }
}
