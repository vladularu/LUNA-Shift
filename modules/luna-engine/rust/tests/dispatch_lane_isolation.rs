#[path = "support/salary_snapshot.rs"]
mod salary_snapshot;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{self, CalculationRequest, ImmutableSnapshot, ValidatedRequest},
    runtime::{JobLane, SnapshotRegistry, dispatch, jobs::JobScheduler},
};
use serde_json::json;
fn setup() -> (SnapshotRegistry, ImmutableSnapshot) {
    let fixture = value_pool::decode(include_str!(
        "../../reference/financial-candidates-golden.json"
    ));
    let case = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| !c["expected"]["deductions"].is_null())
        .unwrap();
    let s = salary_snapshot::facts(salary_snapshot::raw(case))
        .snapshot()
        .clone();
    let registry = SnapshotRegistry::default();
    registry.register(s.clone()).unwrap();
    (registry, s)
}
fn request(s: &ImmutableSnapshot) -> CalculationRequest {
    let input = json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"CALCULATE","request":{"guard":{"snapshot":s.identity(),"requestId":"mixed-native-lanes","requestRevision":1},"periods":[{"kind":"MONTH","month":"2026-01"}],"sections":{"time":false,"gross":true,"net":true,"checks":true},"perspective":"EARNED","priority":"INTERACTIVE"}}});
    match contract::parse_request(&serde_json::to_vec(&input).unwrap()).unwrap() {
        ValidatedRequest::Calculate(r) => *r,
        _ => panic!("request"),
    }
}
#[test]
fn checks_writer_with_mixed_request_never_runs_financial_math_or_finance_views() {
    let (registry, s) = setup();
    let jobs = JobScheduler::new(registry.clone());
    jobs.admit(request(&s), JobLane::Checks).unwrap();
    assert_eq!(registry.stats().unwrap().active_writer_slots, 1);
    let work = jobs.next(JobLane::Checks).unwrap().unwrap();
    let result = dispatch::calculate(&work).unwrap().unwrap();
    let passes = work
        .lease()
        .facts()
        .financial_context()
        .unwrap()
        .lock()
        .unwrap()
        .reuse_diagnostics();
    assert_eq!(
        passes["nativeNetPasses"], 0,
        "checks lane never enters real native net preparation"
    );
    let output = serde_json::to_value(result).unwrap();
    let report = &output["reports"][0];
    for key in ["time", "gross", "net"] {
        assert_eq!(report["sections"][key]["state"], "NOT_REQUESTED");
        assert_eq!(report["views"][key]["state"], "NOT_REQUESTED");
    }
    assert_ne!(report["sections"]["checks"]["state"], "NOT_REQUESTED");
    assert!(work.finish().unwrap().is_some());
}
#[test]
fn finance_writer_with_mixed_request_produces_money_without_checks_execution() {
    let (registry, s) = setup();
    let jobs = JobScheduler::new(registry.clone());
    jobs.admit(request(&s), JobLane::Finance).unwrap();
    assert_eq!(registry.stats().unwrap().active_writer_slots, 2);
    let work = jobs.next(JobLane::Finance).unwrap().unwrap();
    let output = serde_json::to_value(dispatch::calculate(&work).unwrap().unwrap()).unwrap();
    let report = &output["reports"][0];
    assert_eq!(report["sections"]["checks"]["state"], "NOT_REQUESTED");
    assert_eq!(report["views"]["checks"]["state"], "NOT_REQUESTED");
    for key in ["gross", "net"] {
        assert_eq!(report["sections"][key]["state"], "READY");
    }
    assert!(
        work.lease()
            .facts()
            .financial_context()
            .unwrap()
            .lock()
            .unwrap()
            .reuse_diagnostics()["nativeNetPasses"]
            .as_u64()
            .unwrap()
            > 0
    );
    assert!(work.finish().unwrap().is_some());
}
