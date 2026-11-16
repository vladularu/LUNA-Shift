mod common;
#[path = "support/salary_snapshot.rs"]
mod salary_snapshot;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{self, CalculationRequest, ImmutableSnapshot, ValidatedRequest},
    runtime::{
        JobLane, SnapshotRegistry, dispatch,
        jobs::{JobError, JobScheduler, MAX_PENDING_JOBS},
    },
};
use serde_json::{Value, json};
use std::sync::OnceLock;
fn reference() -> &'static Value {
    static VALUE: OnceLock<Value> = OnceLock::new();
    VALUE.get_or_init(|| {
        value_pool::decode(include_str!("../../reference/payroll-page-golden.json"))
    })
}
fn case() -> &'static Value {
    reference()["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["expected"]["statement"]["availableNet"] == true)
        .unwrap()
}
fn setup(case: &Value) -> (SnapshotRegistry, ImmutableSnapshot) {
    let input = &case["input"];
    let raw = salary_snapshot::raw(
        &json!({"input":input,"platformCollationRanks":case["platformCollationRanks"]}),
    );
    let s = salary_snapshot::facts(raw).snapshot().clone();
    let registry = SnapshotRegistry::default();
    registry.register(s.clone()).unwrap();
    (registry, s)
}
fn request(s: &ImmutableSnapshot, revision: u64, kind: &str, month: &str) -> CalculationRequest {
    let mut raw = json!({"guard":{"snapshot":s.identity(),"requestId":format!("{kind}-{revision}"),"requestRevision":revision},"periods":[{"kind":"MONTH","month":month}],"sections":{"time":false,"gross":kind=="gross","net":false,"checks":kind=="checks"},"perspective":"PAYOUT","priority":"INTERACTIVE"});
    if kind == "payroll" {
        raw["payrollPage"] = json!(true)
    }
    let input = json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"CALCULATE","request":raw}});
    match contract::parse_request(&serde_json::to_vec(&input).unwrap()).unwrap() {
        ValidatedRequest::Calculate(r) => *r,
        _ => panic!("request"),
    }
}
#[test]
fn payroll_writer_preserves_normal_gross_and_runs_on_the_same_single_finance_worker() {
    let c = case();
    let month = c["input"]["month"].as_str().unwrap();
    let (registry, s) = setup(c);
    let jobs = JobScheduler::new(registry.clone());
    let gross = jobs
        .admit(request(&s, 1, "gross", month), JobLane::Finance)
        .unwrap();
    let payroll = jobs
        .admit(request(&s, 2, "payroll", month), JobLane::Finance)
        .unwrap();
    assert_eq!(registry.stats().unwrap().active_writer_slots, 2);
    assert!(jobs.next(JobLane::Checks).unwrap().is_none());
    let first = jobs.next(JobLane::Finance).unwrap().unwrap();
    assert_eq!(first.id(), gross);
    assert!(first.is_current().unwrap());
    assert!(jobs.next(JobLane::Finance).unwrap().is_none());
    assert!(first.finish().unwrap().is_some());
    let work = jobs.next(JobLane::Finance).unwrap().unwrap();
    assert_eq!(work.id(), payroll);
    let result = serde_json::to_value(dispatch::calculate(&work).unwrap().unwrap()).unwrap();
    common::assert_json_eq(
        &result["reports"][0]["views"]["payrollPage"]["value"],
        &c["expected"],
        "full original payroll output",
    );
    assert_eq!(result["request"]["payrollPage"], true);
    for key in ["time", "gross", "net", "checks"] {
        assert_eq!(
            result["reports"][0]["sections"][key]["state"],
            "NOT_REQUESTED"
        );
        assert_eq!(result["reports"][0]["views"][key]["state"], "NOT_REQUESTED")
    }
    assert!(work.finish().unwrap().is_some());
}
#[test]
fn payroll_only_supersedes_older_payroll_and_never_borrows_checks_capacity() {
    let c = case();
    let month = c["input"]["month"].as_str().unwrap();
    let (registry, s) = setup(c);
    let jobs = JobScheduler::new(registry.clone());
    let old = jobs
        .admit(request(&s, 1, "payroll", month), JobLane::Finance)
        .unwrap();
    let current = jobs
        .admit(request(&s, 2, "payroll", month), JobLane::Finance)
        .unwrap();
    let gross = jobs
        .admit(request(&s, 1, "gross", month), JobLane::Finance)
        .unwrap();
    let checks = jobs
        .admit(request(&s, 1, "checks", month), JobLane::Checks)
        .unwrap();
    assert!(
        jobs.admit(request(&s, 3, "payroll", month), JobLane::Checks)
            .is_err()
    );
    let (work, skipped) = jobs.next_with_skipped(JobLane::Finance).unwrap();
    assert_eq!(skipped, vec![old]);
    let work = work.unwrap();
    assert_eq!(work.id(), current);
    let other = jobs.next(JobLane::Checks).unwrap().unwrap();
    assert_eq!(other.id(), checks);
    assert!(jobs.next(JobLane::Finance).unwrap().is_none());
    assert!(other.finish().unwrap().is_some());
    assert!(work.finish().unwrap().is_some());
    let work = jobs.next(JobLane::Finance).unwrap().unwrap();
    assert_eq!(work.id(), gross);
    assert!(work.is_current().unwrap());
    assert!(work.finish().unwrap().is_some());
}
#[test]
fn normal_report_bytes_and_net_callcount_are_unchanged_without_payroll_intent() {
    let c = case();
    let month = c["input"]["month"].as_str().unwrap();
    let (registry, s) = setup(c);
    let jobs = JobScheduler::new(registry);
    jobs.admit(request(&s, 1, "gross", month), JobLane::Finance)
        .unwrap();
    let work = jobs.next(JobLane::Finance).unwrap().unwrap();
    let result = serde_json::to_value(dispatch::calculate(&work).unwrap().unwrap()).unwrap();
    assert!(
        !result["request"]
            .as_object()
            .unwrap()
            .contains_key("payrollPage")
    );
    assert!(
        !result["reports"][0]["views"]
            .as_object()
            .unwrap()
            .contains_key("payrollPage")
    );
    assert_eq!(
        work.lease()
            .facts()
            .financial_context()
            .unwrap()
            .lock()
            .unwrap()
            .reuse_diagnostics()["nativeNetPasses"],
        0,
        "a standard gross report must not invoke personal net through hidden payroll work"
    );
    assert!(work.finish().unwrap().is_some());
}
#[test]
fn payroll_cancel_reset_and_full_queue_keep_the_existing_native_fences() {
    let c = case();
    let month = c["input"]["month"].as_str().unwrap();
    let (registry, s) = setup(c);
    let jobs = JobScheduler::new(registry.clone());
    let id = jobs
        .admit(request(&s, 1, "payroll", month), JobLane::Finance)
        .unwrap();
    let work = jobs.next(JobLane::Finance).unwrap().unwrap();
    assert!(jobs.cancel(id).unwrap());
    assert!(dispatch::calculate(&work).unwrap().is_none());
    assert_eq!(
        work.lease()
            .facts()
            .financial_context()
            .unwrap()
            .lock()
            .unwrap()
            .reuse_diagnostics()["nativeNetPasses"],
        0
    );
    assert!(work.finish().unwrap().is_none());
    jobs.admit(request(&s, 2, "payroll", month), JobLane::Finance)
        .unwrap();
    let work = jobs.next(JobLane::Finance).unwrap().unwrap();
    let result = dispatch::calculate(&work).unwrap().unwrap();
    registry.reset().unwrap();
    assert!(work.finish().unwrap().is_none());
    drop(result);
    let (registry, s) = setup(c);
    let jobs = JobScheduler::new(registry);
    for index in 0..MAX_PENDING_JOBS {
        jobs.admit(
            request(&s, 1, "payroll", &format!("2026-{:02}", index + 1)),
            JobLane::Finance,
        )
        .unwrap();
    }
    assert_eq!(
        jobs.admit(request(&s, 2, "payroll", "2026-01"), JobLane::Finance),
        Err(JobError::Capacity)
    );
    let work = jobs.next(JobLane::Finance).unwrap().unwrap();
    assert!(work.is_current().unwrap());
    assert!(work.finish().unwrap().is_some());
}
