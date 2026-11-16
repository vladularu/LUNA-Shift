use luna_engine::{
    contract::{self, CalculationRequest, ImmutableSnapshot, ValidatedRequest},
    runtime::{
        JobLane, SnapshotRegistry,
        jobs::{JobError, JobScheduler, MAX_PENDING_JOBS},
    },
};
use serde_json::{Value, json};
#[path = "support/snapshot.rs"]
mod snapshot_fixture;
fn envelope(command: Value) -> Value {
    json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":command})
}
fn snapshot(revision: u64) -> ImmutableSnapshot {
    let command = envelope(
        json!({"kind":"REGISTER_SNAPSHOT","snapshot":snapshot_fixture::raw_snapshot(revision,"owner-a",1)}),
    );
    match contract::parse_request(&serde_json::to_vec(&command).unwrap()).unwrap() {
        ValidatedRequest::RegisterSnapshot(s) => s,
        _ => panic!("snapshot"),
    }
}
fn request(
    s: &ImmutableSnapshot,
    revision: u64,
    month: &str,
    lane: JobLane,
    background: bool,
) -> CalculationRequest {
    let command = envelope(
        json!({"kind":"CALCULATE","request":{"guard":{"snapshot":s.identity(),"requestId":format!("request-{revision}-{month}"),"requestRevision":revision},"periods":[{"kind":"MONTH","month":month}],"sections":{"time":lane==JobLane::Finance,"gross":false,"net":false,"checks":lane==JobLane::Checks},"perspective":"EARNED","priority":if background{"BACKGROUND"}else{"INTERACTIVE"}}}),
    );
    match contract::parse_request(&serde_json::to_vec(&command).unwrap()).unwrap() {
        ValidatedRequest::Calculate(r) => *r,
        _ => panic!("request"),
    }
}
#[test]
fn interactive_arrivals_precede_background_work_and_cancel_running_background_cooperatively() {
    let registry = SnapshotRegistry::default();
    let s = registry.register(snapshot(1)).unwrap();
    let jobs = JobScheduler::new(registry.clone());
    let background = jobs
        .admit(
            request(&s, 1, "2026-01", JobLane::Finance, true),
            JobLane::Finance,
        )
        .unwrap();
    let interactive = jobs
        .admit(
            request(&s, 2, "2026-02", JobLane::Finance, false),
            JobLane::Finance,
        )
        .unwrap();
    let work = jobs.next(JobLane::Finance).unwrap().unwrap();
    assert_eq!(work.id(), interactive);
    assert!(jobs.next(JobLane::Finance).unwrap().is_none());
    assert!(work.finish().unwrap().is_some());
    let work = jobs.next(JobLane::Finance).unwrap().unwrap();
    assert_eq!(work.id(), background);
    jobs.admit(
        request(&s, 3, "2026-03", JobLane::Finance, false),
        JobLane::Finance,
    )
    .unwrap();
    assert!(!work.is_current().unwrap());
    assert!(work.finish().unwrap().is_none());
    assert!(
        jobs.next(JobLane::Finance)
            .unwrap()
            .unwrap()
            .finish()
            .unwrap()
            .is_some()
    );
    assert_eq!(jobs.counts().unwrap(), (0, 0));
}
#[test]
fn a_full_queue_does_not_supersede_accepted_writers_and_owner_reset_cancels_old_leases() {
    let registry = SnapshotRegistry::default();
    let s = registry.register(snapshot(1)).unwrap();
    let jobs = JobScheduler::new(registry.clone());
    for n in 1..=MAX_PENDING_JOBS {
        jobs.admit(
            request(
                &s,
                n as u64,
                &format!("2026-{n:02}"),
                JobLane::Finance,
                true,
            ),
            JobLane::Finance,
        )
        .unwrap();
    }
    assert_eq!(
        jobs.admit(
            request(&s, 100, "2026-01", JobLane::Finance, false),
            JobLane::Finance
        ),
        Err(JobError::Capacity)
    );
    let work = jobs.next(JobLane::Finance).unwrap().unwrap();
    assert!(work.is_current().unwrap());
    assert!(work.finish().unwrap().is_some());
    registry.reset().unwrap();
    assert!(jobs.next(JobLane::Finance).unwrap().is_none());
    assert_eq!(jobs.counts().unwrap(), (0, 0));
}
#[test]
fn superseded_arrivals_are_never_computed_and_cancellation_preserves_the_other_lane() {
    let registry = SnapshotRegistry::default();
    let s = registry.register(snapshot(1)).unwrap();
    let jobs = JobScheduler::new(registry.clone());
    jobs.admit(
        request(&s, 1, "2026-01", JobLane::Finance, false),
        JobLane::Finance,
    )
    .unwrap();
    let latest = jobs
        .admit(
            request(&s, 2, "2026-01", JobLane::Finance, false),
            JobLane::Finance,
        )
        .unwrap();
    let check = jobs
        .admit(
            request(&s, 3, "2026-01", JobLane::Checks, false),
            JobLane::Checks,
        )
        .unwrap();
    let finance = jobs.next(JobLane::Finance).unwrap().unwrap();
    assert_eq!(finance.id(), latest);
    let checks = jobs.next(JobLane::Checks).unwrap().unwrap();
    assert_eq!(checks.id(), check);
    assert_eq!(jobs.counts().unwrap(), (0, 2));
    assert!(jobs.cancel(latest).unwrap());
    assert!(!jobs.cancel(latest).unwrap());
    assert!(finance.finish().unwrap().is_none());
    assert!(checks.finish().unwrap().is_some());
    assert!(!jobs.cancel(check).unwrap());
    assert_eq!(jobs.counts().unwrap(), (0, 0));
}
#[test]
fn dropped_worker_releases_its_lane_and_revision_changes_block_old_completion() {
    let registry = SnapshotRegistry::default();
    let s = registry.register(snapshot(1)).unwrap();
    let jobs = JobScheduler::new(registry.clone());
    jobs.admit(
        request(&s, 1, "2026-01", JobLane::Finance, false),
        JobLane::Finance,
    )
    .unwrap();
    let old = jobs.next(JobLane::Finance).unwrap().unwrap();
    registry.register(snapshot(2)).unwrap();
    assert!(!old.is_current().unwrap());
    drop(old);
    let s = registry.snapshot(snapshot(2).identity()).unwrap();
    let id = jobs
        .admit(
            request(&s, 2, "2026-01", JobLane::Finance, false),
            JobLane::Finance,
        )
        .unwrap();
    assert!(jobs.cancel(id).unwrap());
    assert!(jobs.next(JobLane::Finance).unwrap().is_none());
    jobs.admit(
        request(&s, 3, "2026-01", JobLane::Finance, false),
        JobLane::Finance,
    )
    .unwrap();
    assert!(
        jobs.next(JobLane::Finance)
            .unwrap()
            .unwrap()
            .finish()
            .unwrap()
            .is_some()
    );
}

#[test]
fn queued_reservations_do_not_retain_large_old_native_fact_owners() {
    let registry = SnapshotRegistry::default();
    let s = registry.register(snapshot(1)).unwrap();
    let observation = registry
        .begin(
            request(&s, 2, "2026-02", JobLane::Finance, false),
            JobLane::Finance,
        )
        .unwrap();
    let weak = std::sync::Arc::downgrade(observation.facts());
    drop(observation);
    let jobs = JobScheduler::new(registry.clone());
    jobs.admit(
        request(&s, 1, "2026-01", JobLane::Finance, false),
        JobLane::Finance,
    )
    .unwrap();
    assert_eq!(jobs.counts().unwrap(), (1, 0));
    registry.reset().unwrap();
    registry.collect_retired().unwrap();
    assert!(
        weak.upgrade().is_none(),
        "Waiting metadata must not retain old source ownership"
    );
    assert_eq!(jobs.counts().unwrap(), (1, 0));
    assert!(jobs.next(JobLane::Finance).unwrap().is_none());
}

#[test]
fn checks_can_finish_on_another_worker_while_a_finance_worker_is_held() {
    let registry = SnapshotRegistry::default();
    let s = registry.register(snapshot(1)).unwrap();
    let jobs = JobScheduler::new(registry.clone());
    jobs.admit(
        request(&s, 1, "2026-01", JobLane::Finance, false),
        JobLane::Finance,
    )
    .unwrap();
    jobs.admit(
        request(&s, 2, "2026-01", JobLane::Checks, false),
        JobLane::Checks,
    )
    .unwrap();
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let finance_jobs = jobs.clone();
    let worker = std::thread::spawn(move || {
        let work = finance_jobs.next(JobLane::Finance).unwrap().unwrap();
        started_tx.send(()).unwrap();
        release_rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .unwrap();
        assert!(work.finish().unwrap().is_some());
    });
    started_rx
        .recv_timeout(std::time::Duration::from_secs(10))
        .unwrap();
    assert!(
        jobs.next(JobLane::Checks)
            .unwrap()
            .unwrap()
            .finish()
            .unwrap()
            .is_some()
    );
    assert_eq!(jobs.counts().unwrap(), (0, 1));
    release_tx.send(()).unwrap();
    worker.join().unwrap();
    assert_eq!(jobs.counts().unwrap(), (0, 0));
}

#[test]
fn foreign_scheduler_handles_cannot_cancel_a_different_owner_queue() {
    let a = SnapshotRegistry::default();
    let sa = a.register(snapshot(1)).unwrap();
    let ja = JobScheduler::new(a);
    let b = SnapshotRegistry::default();
    let sb = b.register(snapshot(1)).unwrap();
    let jb = JobScheduler::new(b);
    let first = ja
        .admit(
            request(&sa, 1, "2026-01", JobLane::Finance, false),
            JobLane::Finance,
        )
        .unwrap();
    let second = jb
        .admit(
            request(&sb, 1, "2026-01", JobLane::Finance, false),
            JobLane::Finance,
        )
        .unwrap();
    assert_ne!(first, second);
    assert!(!jb.cancel(first).unwrap());
    assert!(!ja.cancel(second).unwrap());
    assert!(
        jb.next(JobLane::Finance)
            .unwrap()
            .unwrap()
            .finish()
            .unwrap()
            .is_some()
    );
    assert!(
        ja.next(JobLane::Finance)
            .unwrap()
            .unwrap()
            .finish()
            .unwrap()
            .is_some()
    );
}
