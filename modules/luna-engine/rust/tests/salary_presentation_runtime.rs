mod common;
#[path = "support/salary_snapshot.rs"]
mod salary_snapshot;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    contract::{SalaryPerspective, SourceKind},
    runtime::financial_report::presentation,
};
use salary_snapshot::{facts, raw, set};
use serde_json::json;
#[test]
fn raw_sql_to_source_exact_salary_detail_dtos_without_repricing() {
    let golden = value_pool::decode(include_str!(
        "../../reference/salary-presentation-golden.json"
    ));
    let mut count = 0;
    for case in golden["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["operation"] == "runtime")
    {
        let facts = facts(raw(case));
        let input = &case["input"];
        let perspective: SalaryPerspective =
            serde_json::from_value(input["perspective"].clone()).unwrap();
        let details = || {
            presentation::details(
                &facts,
                input["month"].as_str().unwrap(),
                perspective,
                input["filter"].as_str(),
                input["includeSpecialDutyPay"].as_bool().unwrap(),
            )
            .unwrap()
        };
        let actual = details();
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        let before = facts
            .financial_context()
            .unwrap()
            .lock()
            .unwrap()
            .reuse_diagnostics();
        assert_eq!(details(), actual);
        let candidates = presentation::collation_candidates(
            &facts,
            input["month"].as_str().unwrap(),
            perspective,
        )
        .unwrap();
        assert!(candidates.contains(""));
        let after = facts
            .financial_context()
            .unwrap()
            .lock()
            .unwrap()
            .reuse_diagnostics();
        for key in ["raw", "actual", "annual"] {
            assert_eq!(
                before[key], after[key],
                "no repricing for repeated presentation/candidates"
            );
        }
        if actual["netState"]["value"]["status"] == "available" {
            assert_eq!(
                before["nativeNetPasses"], after["nativeNetPasses"],
                "available native net remains reused"
            );
        }
        assert!(facts.calculation_profile().is_err());
        count += 1;
    }
    assert_eq!(count, 72);
}
#[test]
fn unread_personal_net_stays_separate_from_paid_tariff_details() {
    let golden = value_pool::decode(include_str!(
        "../../reference/salary-presentation-golden.json"
    ));
    let case = golden["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            c["operation"] == "runtime"
                && c["expected"]["serviceSummary"]["totalCents"]
                    .as_f64()
                    .is_some_and(|v| v > 0.0)
        })
        .unwrap();
    let mut input = raw(case);
    set(
        &mut input,
        SourceKind::NetPaySettingsTimeline,
        json!({"state":"FAILED","code":"READ_FAILED"}),
    );
    let facts = facts(input);
    let perspective = serde_json::from_value(case["input"]["perspective"].clone()).unwrap();
    let actual = presentation::details(
        &facts,
        case["input"]["month"].as_str().unwrap(),
        perspective,
        None,
        false,
    )
    .unwrap();
    assert_eq!(actual["netState"]["state"], "UNAVAILABLE");
    assert_eq!(
        actual["netState"]["reason"]["source"],
        "NET_PAY_SETTINGS_TIMELINE"
    );
    assert!(
        actual["serviceSummary"]["totalCents"]
            .as_f64()
            .is_some_and(|n| n > 0.0)
    );
    assert!(actual["premiumSummary"].is_null() && actual["deductions"].is_null());
    for row in actual["serviceSummary"]["rows"].as_array().unwrap() {
        if let Some(shift) = row.get("shift") {
            assert!(
                shift.get("note").is_none()
                    && shift.get("specialDuty").is_none()
                    && shift.get("revision").is_none()
            );
        }
    }
}
