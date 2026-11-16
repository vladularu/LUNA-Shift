mod common;
#[path = "support/salary_snapshot.rs"]
mod salary_snapshot;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{self, CalculationRequest, ImmutableSnapshot, SourceKind, ValidatedRequest},
    runtime::{
        JobLane, SnapshotRegistry, dispatch,
        financial_report::payroll::{self, panels::PayrollPanel},
        jobs::JobScheduler,
    },
};
use serde_json::{Value, json};
fn request(snapshot: &ImmutableSnapshot, panel: Option<&str>, revision: u64) -> CalculationRequest {
    let mut raw = json!({"guard":{"snapshot":snapshot.identity(),"requestId":format!("panel-{revision}"),"requestRevision":revision},"periods":[{"kind":"MONTH","month":"2026-11"}],"sections":{"time":false,"gross":false,"net":false,"checks":false},"perspective":"PAYOUT","priority":"INTERACTIVE"});
    if let Some(panel) = panel {
        raw["payrollPanel"] = json!(panel)
    } else {
        raw["payrollPage"] = json!(true)
    }
    let bytes=serde_json::to_vec(&json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"CALCULATE","request":raw}})).unwrap();
    match contract::parse_request(&bytes).unwrap() {
        ValidatedRequest::Calculate(r) => *r,
        _ => panic!("calculation"),
    }
}
fn positive() -> Value {
    value_pool::decode(include_str!("../../reference/payroll-page-golden.json"))["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "services-ready-2026-11-PAYOUT-false")
        .unwrap()
        .clone()
}
#[test]
fn tariff_assessment_uses_no_net_payment_annual_test_or_target_sources() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/tariff-assessment-screen-golden.json"
    ));
    let mut count = 0;
    for c in fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c.get("raw").is_some())
    {
        count += 1;
        let seed =
            json!({"input":c["raw"],"platformCollationRanks":c["raw"]["platformCollationRanks"]});
        let mut raw = salary_snapshot::raw(&seed);
        for kind in [
            SourceKind::NetPaySettingsTimeline,
            SourceKind::SalaryPaymentPreferences,
            SourceKind::ActualAnnualPayments,
            SourceKind::TariffAnnualClaims,
            SourceKind::TestMonths,
            SourceKind::WorkingTimeTarget,
            SourceKind::YouthPreference,
        ] {
            salary_snapshot::set(
                &mut raw,
                kind,
                json!({"state":"FAILED","code":"READ_FAILED"}),
            );
        }
        let facts = salary_snapshot::facts(raw.clone());
        let value = payroll::calculate_panel(
            &facts,
            c["input"]["month"].as_str().unwrap(),
            PayrollPanel::TariffAssessment,
        )
        .unwrap();
        common::assert_json_eq(&value, &c["expected"], c["id"].as_str().unwrap());
        for kind in [
            SourceKind::WorkProfile,
            SourceKind::WorkPatternSettings,
            SourceKind::CalendarEntries,
            SourceKind::LegacyTariffDecisions,
        ] {
            let mut failed = raw.clone();
            salary_snapshot::set(
                &mut failed,
                kind,
                json!({"state":"FAILED","code":"READ_FAILED"}),
            );
            assert!(
                payroll::calculate_panel(
                    &salary_snapshot::facts(failed),
                    "2026-11",
                    PayrollPanel::TariffAssessment
                )
                .is_err()
            );
        }
    }
    assert_eq!(count, 4);
}
#[test]
fn exclusive_panel_slots_share_finance_without_displacing_main_or_other_panels() {
    let case = positive();
    let facts = salary_snapshot::facts(salary_snapshot::raw(&case));
    let registry = SnapshotRegistry::default();
    let snapshot = registry.register(facts.snapshot().clone()).unwrap();
    let scheduler = JobScheduler::new(registry.clone());
    let bad = request(&snapshot, Some("BASIS"), 1);
    assert!(scheduler.admit(bad, JobLane::Checks).is_err());
    assert_eq!(scheduler.counts().unwrap(), (0, 0));
    let mut jobs = vec![];
    for (index, panel) in [
        Some("COMPONENTS"),
        Some("BASIS"),
        Some("SPECIAL_DUTIES"),
        None,
    ]
    .iter()
    .enumerate()
    {
        jobs.push(
            scheduler
                .admit(
                    request(&snapshot, *panel, index as u64 + 2),
                    JobLane::Finance,
                )
                .unwrap(),
        );
    }
    assert_eq!(scheduler.counts().unwrap(), (4, 0));
    assert!(scheduler.next(JobLane::Checks).unwrap().is_none());
    let expected = value_pool::decode(include_str!("../../reference/payroll-panel-golden.json"));
    let expected = &expected["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == case["id"])
        .unwrap()["expected"];
    for (index, panel) in [
        Some("COMPONENTS"),
        Some("BASIS"),
        Some("SPECIAL_DUTIES"),
        None,
    ]
    .iter()
    .enumerate()
    {
        let work = scheduler.next(JobLane::Finance).unwrap().unwrap();
        assert_eq!(work.id(), jobs[index]);
        assert!(work.is_current().unwrap());
        let computed = dispatch::calculate(&work).unwrap().unwrap();
        let encoded = serde_json::to_value(&computed).unwrap();
        let report = &encoded["reports"][0];
        for section in ["time", "gross", "net", "checks"] {
            assert_eq!(
                report["sections"][section],
                json!({"state":"NOT_REQUESTED"})
            );
        }
        if let Some(panel) = panel {
            assert_eq!(report["views"]["payrollPanel"]["state"], "READY");
            assert_eq!(report["views"]["payrollPanel"]["value"]["month"], "2026-11");
            assert_eq!(report["views"]["payrollPanel"]["value"]["panel"], *panel);
            common::assert_json_eq(
                &report["views"]["payrollPanel"]["value"]["blocks"],
                &expected[*panel],
                panel,
            );
            assert!(report["views"].get("payrollPage").is_none());
            assert!(report["views"].get("payrollPageUi").is_none());
        } else {
            assert!(report["views"].get("payrollPanel").is_none());
            common::assert_json_eq(
                &report["views"]["payrollPage"]["value"],
                &case["expected"],
                "unchanged main page",
            );
        }
        assert!(work.finish().unwrap().is_some());
    }
    assert_eq!(scheduler.counts().unwrap(), (0, 0));
}
#[test]
fn special_duty_panel_does_not_request_personal_net_or_annual_tax_work() {
    let case = positive();
    let mut raw = salary_snapshot::raw(&case);
    salary_snapshot::set(
        &mut raw,
        SourceKind::NetPaySettingsTimeline,
        json!({"state":"FAILED","code":"READ_FAILED"}),
    );
    let facts = salary_snapshot::facts(raw);
    let actual = payroll::calculate_panel(&facts, "2026-11", PayrollPanel::SpecialDuties).unwrap();
    let expected = value_pool::decode(include_str!("../../reference/payroll-panel-golden.json"));
    let expected = &expected["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == case["id"])
        .unwrap()["expected"]["SPECIAL_DUTIES"];
    common::assert_json_eq(
        &actual,
        expected,
        "special duty display is independent of personal setup read",
    );
    let diagnostics = facts
        .financial_context()
        .unwrap()
        .lock()
        .unwrap()
        .reuse_diagnostics();
    assert_eq!(diagnostics["nativeNetPasses"], 0);
}
#[test]
fn cancellation_fences_new_panel_results() {
    let case = positive();
    let facts = salary_snapshot::facts(salary_snapshot::raw(&case));
    let registry = SnapshotRegistry::default();
    let snapshot = registry.register(facts.snapshot().clone()).unwrap();
    let scheduler = JobScheduler::new(registry.clone());
    let id = scheduler
        .admit(request(&snapshot, Some("BASIS"), 1), JobLane::Finance)
        .unwrap();
    let work = scheduler.next(JobLane::Finance).unwrap().unwrap();
    assert!(scheduler.cancel(id).unwrap());
    assert!(dispatch::calculate(&work).unwrap().is_none());
    assert!(work.finish().unwrap().is_none());
}
