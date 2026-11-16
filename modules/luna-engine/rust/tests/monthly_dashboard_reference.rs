mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::report::financial::dashboard::{DashboardInput, present};
#[test]
fn original_ast_financial_dashboard_props_preserve_every_full_output() {
    let reference = value_pool::decode(include_str!(
        "../../reference/monthly-dashboard-golden.json"
    ));
    let cases = reference["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 576);
    for case in cases {
        let a = &case["args"];
        let input = DashboardInput {
            month: a["month"].as_str().unwrap(),
            profile: &a["profile"],
            pay: (a["pay"]["ok"] == true).then(|| &a["pay"]["value"]),
            projection: a.get("projection"),
            annual_payments: a
                .get("annualPayments")
                .and_then(|p| p.as_array())
                .map(Vec::as_slice),
            annual_issue: a.get("annualIssue"),
            additional_recurring_gross_cents: a["additionalRecurringGrossCents"].as_f64().unwrap(),
            projection_pending: a["projectionPending"].as_bool().unwrap(),
            salary_loading: a["salaryLoading"].as_bool().unwrap(),
            salary_error: a.get("salaryError").and_then(|v| v.as_str()),
        };
        let actual = present(&input).expect("original financial props");
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}

#[test]
fn large_ignored_target_tree_never_appears_in_financial_output() {
    let reference = value_pool::decode(include_str!(
        "../../reference/monthly-dashboard-golden.json"
    ));
    let a = &reference["cases"][0]["args"];
    let mut profile = a["profile"].clone();
    profile["workingTimeTarget"] = serde_json::json!({"privateMarker":"target-details-must-not-be-financial-output","context":{"calendarEntries":vec![serde_json::json!({"date":"2026-01-01","minutes":480});50000]}});
    let pointer = profile["workingTimeTarget"]["context"]["calendarEntries"]
        .as_array()
        .unwrap()
        .as_ptr();
    let input = DashboardInput {
        month: a["month"].as_str().unwrap(),
        profile: &profile,
        pay: Some(&a["pay"]["value"]),
        projection: a.get("projection"),
        annual_payments: a["annualPayments"].as_array().map(Vec::as_slice),
        annual_issue: a.get("annualIssue"),
        additional_recurring_gross_cents: a["additionalRecurringGrossCents"].as_f64().unwrap(),
        projection_pending: false,
        salary_loading: false,
        salary_error: None,
    };
    for _ in 0..24 {
        let actual = present(&input).unwrap();
        common::assert_json_eq(
            &actual,
            &reference["cases"][0]["expected"],
            "large target remains irrelevant",
        );
        let encoded = serde_json::to_string(&actual).unwrap();
        assert!(
            encoded.len() < 8192
                && !encoded.contains("target-details-must-not-be-financial-output")
        );
        assert_eq!(
            pointer,
            profile["workingTimeTarget"]["context"]["calendarEntries"]
                .as_array()
                .unwrap()
                .as_ptr()
        );
    }
}
