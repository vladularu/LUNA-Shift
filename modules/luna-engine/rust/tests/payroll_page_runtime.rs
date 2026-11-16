mod common;
#[path = "support/salary_snapshot.rs"]
mod salary_snapshot;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{contract::SourceKind, runtime::financial_report};
use serde_json::json;
#[test]
fn payroll_page_from_original_raw_sources_matches_every_original_statement_fact() {
    let reference = value_pool::decode(include_str!("../../reference/payroll-page-golden.json"));
    let ui: serde_json::Value =
        serde_json::from_str(include_str!("../../reference/payroll-page-ui-golden.json")).unwrap();
    let mut count = 0;
    for case in reference["cases"].as_array().unwrap() {
        let input = &case["input"];
        let mut raw = salary_snapshot::raw(
            &json!({"input":input,"platformCollationRanks":case["platformCollationRanks"]}),
        );
        if case["testMonth"] == true {
            salary_snapshot::set(
                &mut raw,
                SourceKind::TestMonths,
                json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":[{"month":input["month"]}]}}}),
            );
        }
        if let Some(state) = case["settingsState"]
            .as_str()
            .filter(|s| matches!(*s, "FAILED" | "NOT_REQUESTED"))
        {
            salary_snapshot::set(
                &mut raw,
                SourceKind::NetPaySettingsTimeline,
                if state == "FAILED" {
                    json!({"state":"FAILED","code":"READ_FAILED"})
                } else {
                    json!({"state":"NOT_REQUESTED"})
                },
            );
        }
        let facts = salary_snapshot::facts(raw);
        let month = input["month"].as_str().unwrap();
        let output = financial_report::payroll::calculate_with_ui(&facts, month)
            .unwrap_or_else(|e| panic!("{} {e:?}", case["id"]));
        let expected_ui = &ui["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == case["id"])
            .unwrap()["expected"];
        common::assert_json_eq(&output.ui, expected_ui, case["id"].as_str().unwrap());
        let actual = output.page;
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        if case["id"].as_str().unwrap().starts_with("services-ready-")
            && case["settingsState"].is_null()
        {
            let owner = facts.financial_context().unwrap();
            let before = owner.lock().unwrap().reuse_diagnostics();
            let repeated = financial_report::payroll::calculate(&facts, month).unwrap();
            common::assert_json_eq(&repeated, &actual, "same snapshot payroll view is stable");
            let after = owner.lock().unwrap().reuse_diagnostics();
            assert_eq!(
                before, after,
                "repeat view must reuse all gross and native net passes"
            );
        }
        count += 1;
    }
    assert_eq!(count, 305);
}

#[test]
fn standard_report_views_keep_the_original_serialized_shape_without_payroll_intent() {
    use luna_engine::runtime::{dispatch::ReportViews, report::SectionOutput};
    let views = ReportViews {
        core: SectionOutput::NotRequested {},
        time: SectionOutput::NotRequested {},
        gross: SectionOutput::NotRequested {},
        net: SectionOutput::NotRequested {},
        checks: SectionOutput::NotRequested {},
        financial_details: None,
        payroll_page: None,
        payroll_page_ui: None,
        payroll_panel: None,
    };
    assert_eq!(
        serde_json::to_string(&views).unwrap(),
        "{\"core\":{\"state\":\"NOT_REQUESTED\"},\"time\":{\"state\":\"NOT_REQUESTED\"},\"gross\":{\"state\":\"NOT_REQUESTED\"},\"net\":{\"state\":\"NOT_REQUESTED\"},\"checks\":{\"state\":\"NOT_REQUESTED\"}}"
    );
}
