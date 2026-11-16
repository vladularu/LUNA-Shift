mod common;
#[path = "support/salary_snapshot.rs"]
mod salary_snapshot;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::SourceKind,
    runtime::financial_report::payroll::{self, panels::PayrollPanel},
};
use serde_json::json;
#[test]
fn all_original_components_basis_and_special_duty_panel_observations_match() {
    let source = value_pool::decode(include_str!("../../reference/payroll-page-golden.json"));
    let panels = value_pool::decode(include_str!("../../reference/payroll-panel-golden.json"));
    assert_eq!(source["cases"].as_array().unwrap().len(), 305);
    for case in source["cases"].as_array().unwrap() {
        let mut raw = salary_snapshot::raw(case);
        if case["testMonth"] == true {
            salary_snapshot::set(
                &mut raw,
                SourceKind::TestMonths,
                json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":[{"month":case["input"]["month"]}]}}}),
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
        let facts = std::sync::Arc::new(salary_snapshot::facts(raw));
        let weak = std::sync::Arc::downgrade(&facts);
        let expected = &panels["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == case["id"])
            .unwrap()["expected"];
        let mut prepared = None;
        for (panel, key) in [
            (PayrollPanel::Components, "COMPONENTS"),
            (PayrollPanel::Basis, "BASIS"),
            (PayrollPanel::SpecialDuties, "SPECIAL_DUTIES"),
        ] {
            let actual =
                payroll::calculate_panel(&facts, case["input"]["month"].as_str().unwrap(), panel)
                    .unwrap_or_else(|e| panic!("{} {key}: {e:?}", case["id"]));
            common::assert_json_eq(&actual, &expected[key], &format!("{} {key}", case["id"]));
            assert!(
                !serde_json::to_string(&actual)
                    .unwrap()
                    .contains("payrollTrace")
            );
            let diagnostics = facts
                .financial_context()
                .unwrap()
                .lock()
                .unwrap()
                .reuse_diagnostics();
            if let Some(previous) = &prepared {
                assert_eq!(
                    previous, &diagnostics,
                    "{}: switching a presenter must not reprice gross or rerun native net",
                    case["id"]
                );
            }
            prepared = Some(diagnostics);
        }
        drop(facts);
        assert!(
            weak.upgrade().is_none(),
            "panel/cache must not retain its snapshot owner"
        );
    }
}
#[test]
fn panel_wire_enum_is_closed() {
    for raw in ["\"components\"", "\"ANNUAL\"", "{}", "null"] {
        assert!(serde_json::from_str::<PayrollPanel>(raw).is_err());
    }
    let panel: PayrollPanel = serde_json::from_value(json!("BASIS")).unwrap();
    assert_eq!(panel, PayrollPanel::Basis);
}
