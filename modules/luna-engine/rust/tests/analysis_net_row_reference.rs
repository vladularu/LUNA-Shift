mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::runtime::financial_report::analysis_net_row;
use serde_json::{Value, json};

#[test]
fn unchanged_original_jsx_and_formatter_match_all_native_projection_outputs() {
    let fixture = value_pool::decode(include_str!("../../reference/analysis-net-row-golden.json"));
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 390);
    for case in cases {
        let mut forecast = case["input"]["forecast"].clone();
        if case["input"]["inputNegativeZero"] == true {
            forecast["result"]["pay"]["netCents"] = json!(-0.0);
        }
        let actual = analysis_net_row::present(
            case["input"]["month"].as_str().unwrap(),
            (!forecast.is_null()).then_some(&forecast),
        )
        .unwrap();
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        if let Some(amount) = actual["amount"]["euros"].as_f64() {
            assert_eq!(
                amount == 0.0 && amount.is_sign_negative(),
                actual["amount"]["negativeZero"].as_bool().unwrap(),
                "{}",
                case["id"]
            );
        }
    }
}

#[test]
fn malformed_native_presenter_input_is_unavailable_without_inventing_zero() {
    for forecast in [
        json!({}),
        json!({"result":{"status":"available","pay":{"netCents":null}}}),
        json!({"result":{"status":"unavailable"}}),
        json!({"result":{"status":"OTHER"}}),
    ] {
        assert!(analysis_net_row::present("2026-11", Some(&forecast)).is_err());
    }
    assert!(analysis_net_row::present("invalid", None).is_err());
    // An absent forecast is a real original row state, not an available zero.
    let absent = analysis_net_row::present("2026-11", None).unwrap();
    assert_eq!(absent["amount"], Value::Null);
    assert_eq!(absent["forecastStatus"], "NONE");
}
