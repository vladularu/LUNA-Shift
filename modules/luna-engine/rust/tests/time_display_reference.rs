mod common;
use luna_engine::report::time_display::present;
use serde_json::Value;
#[test]
fn all_original_time_card_and_shift_row_properties_are_preserved() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/time-display-golden.json")).unwrap();
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 439);
    for case in cases {
        let result = present(&case["input"]["summary"], &case["input"]["analysis"])
            .unwrap_or_else(|error| panic!("{}:{error:?}", case["id"]));
        common::assert_json_eq(&result, &case["expected"], case["id"].as_str().unwrap());
    }
}

#[test]
fn minimal_fact_only_records_are_not_admitted_as_complete_monthly_display_values() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/time-display-golden.json")).unwrap();
    let boundaries = fixture["boundaries"].as_array().unwrap();
    assert_eq!(boundaries.len(), 292);
    for case in boundaries {
        assert!(
            present(&case["input"]["summary"], &case["input"]["analysis"]).is_err(),
            "{}",
            case["id"]
        );
    }
}

#[test]
fn original_month_dashboard_card_properties_remain_exact() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../reference/month-time-display-golden.json"
    ))
    .unwrap();
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 439);
    for case in fixture["cases"].as_array().unwrap() {
        let input = &case["input"];
        let actual = luna_engine::report::time_display::present_dashboard(
            &input["summary"],
            &input["analysis"],
        )
        .unwrap();
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
