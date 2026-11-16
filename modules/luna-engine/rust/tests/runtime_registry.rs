use luna_engine::{
    contract::{self, CalculationRequest, ImmutableSnapshot, ValidatedRequest},
    runtime::{JobLane, RegistryError, SnapshotRegistry},
};
use serde_json::{Value, json};
fn envelope(command: Value) -> Value {
    json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":command})
}
#[path = "support/snapshot.rs"]
mod snapshot_fixture;
use snapshot_fixture::{raw_snapshot, seal};
fn snapshot(value: Value) -> ImmutableSnapshot {
    match contract::parse_request(
        &serde_json::to_vec(&envelope(
            json!({"kind":"REGISTER_SNAPSHOT","snapshot":value}),
        ))
        .unwrap(),
    )
    .unwrap()
    {
        ValidatedRequest::RegisterSnapshot(snapshot) => snapshot,
        _ => panic!("Expected registration"),
    }
}
fn request(
    snapshot: &ImmutableSnapshot,
    revision: u64,
    sections: Value,
    period: &str,
) -> CalculationRequest {
    let command = json!({"kind":"CALCULATE","request":{"guard":{"snapshot":snapshot.identity(),"requestId":format!("request-{revision}"),"requestRevision":revision},"periods":[{"kind":"MONTH","month":period}],"sections":sections,"perspective":"EARNED","priority":"INTERACTIVE"}});
    match contract::parse_request(&serde_json::to_vec(&envelope(command)).unwrap()).unwrap() {
        ValidatedRequest::Calculate(request) => *request,
        _ => panic!("Expected calculation"),
    }
}
fn finance() -> Value {
    json!({"time":true,"gross":true,"net":true,"checks":false})
}
#[test]
fn parsing_started_before_same_owner_reset_cannot_register_after_that_reset() {
    let registry = SnapshotRegistry::default();
    let owner = contract::OwnerIdentity::new("owner-a", 1).unwrap();
    registry.reset_for_owner(&owner).unwrap();
    let marker = registry.preparation_marker().unwrap();
    assert!(marker.is_current().unwrap());
    // Models a module reload while the worker is still parsing old bytes.
    registry.reset_for_owner(&owner).unwrap();
    let parsed = snapshot(raw_snapshot(1, "owner-a", 1));
    assert!(!marker.is_current().unwrap());
    assert!(matches!(
        registry.register_prepared(&marker, parsed.clone()),
        Err(RegistryError::StaleSnapshot)
    ));
    assert!(matches!(
        registry.snapshot(parsed.identity()),
        Err(RegistryError::MissingSnapshot)
    ));
    let current = registry.preparation_marker().unwrap();
    assert!(registry.register_prepared(&current, parsed).is_ok());
    assert!(!current.is_current().unwrap());
}
#[test]
fn preparation_markers_are_registry_bound_weak_and_invalidated_by_source_fences() {
    let registry = SnapshotRegistry::default();
    let owner = contract::OwnerIdentity::new("owner-a", 1).unwrap();
    registry.reset_for_owner(&owner).unwrap();
    let marker = registry.preparation_marker().unwrap();
    let other = SnapshotRegistry::default();
    other.reset_for_owner(&owner).unwrap();
    assert!(matches!(
        other.register_prepared(&marker, snapshot(raw_snapshot(1, "owner-a", 1))),
        Err(RegistryError::OwnerMismatch)
    ));
    registry
        .advance_revision(&contract::RevisionFence::new(owner, 2).unwrap())
        .unwrap();
    assert!(!marker.is_current().unwrap());
    assert!(matches!(
        registry.register_prepared(&marker, snapshot(raw_snapshot(2, "owner-a", 1))),
        Err(RegistryError::StaleSnapshot)
    ));
    let weak = {
        let temporary = SnapshotRegistry::default();
        temporary.preparation_marker().unwrap()
    };
    assert!(!weak.is_current().unwrap());
}
#[test]
fn registration_reuses_storage_and_rejects_conflicting_or_older_snapshots() {
    let registry = SnapshotRegistry::default();
    let first = snapshot(raw_snapshot(2, "owner-a", 1));
    registry.register(first.clone()).unwrap();
    let duplicate = registry
        .register(snapshot(raw_snapshot(2, "owner-a", 1)))
        .unwrap();
    assert!(first.shares_storage_with(&duplicate));
    assert_eq!(
        registry
            .register(snapshot(raw_snapshot(1, "owner-a", 1)))
            .unwrap_err(),
        RegistryError::StaleSnapshot
    );
    let mut conflict = raw_snapshot(2, "owner-a", 1);
    conflict["referenceDate"] = json!("2026-11-13");
    seal(&mut conflict);
    assert_eq!(
        registry.register(snapshot(conflict)).unwrap_err(),
        RegistryError::IdentityConflict
    );
    assert_eq!(
        registry
            .register(snapshot(raw_snapshot(3, "owner-b", 1)))
            .unwrap_err(),
        RegistryError::OwnerMismatch
    );
    assert_eq!(
        registry
            .register(snapshot(raw_snapshot(3, "owner-a", 2)))
            .unwrap_err(),
        RegistryError::OwnerMismatch
    );
}
#[test]
fn financial_results_can_finish_while_independent_checks_remain_running() {
    let registry = SnapshotRegistry::default();
    let snapshot = registry
        .register(snapshot(raw_snapshot(1, "owner-a", 1)))
        .unwrap();
    let finance = registry
        .begin(
            request(&snapshot, 1, finance(), "2026-12"),
            JobLane::Finance,
        )
        .unwrap();
    let checks = registry
        .begin(
            request(
                &snapshot,
                2,
                json!({"time":false,"gross":false,"net":false,"checks":true}),
                "2026-12",
            ),
            JobLane::Checks,
        )
        .unwrap();
    let permit = registry.complete(&finance).unwrap().unwrap();
    assert_eq!(permit.lane(), JobLane::Finance);
    assert_eq!(permit.request(), finance.request());
    assert!(registry.is_current(&checks).unwrap());
    assert!(registry.complete(&finance).unwrap().is_none());
    assert!(registry.complete(&checks).unwrap().is_some());
}
#[test]
fn newer_requests_and_snapshot_revisions_prevent_stale_publication() {
    let registry = SnapshotRegistry::default();
    let first = registry
        .register(snapshot(raw_snapshot(1, "owner-a", 1)))
        .unwrap();
    let old = registry
        .begin(request(&first, 1, finance(), "2026-12"), JobLane::Finance)
        .unwrap();
    let new = registry
        .begin(request(&first, 2, finance(), "2026-12"), JobLane::Finance)
        .unwrap();
    assert!(!registry.is_current(&old).unwrap());
    assert!(registry.complete(&old).unwrap().is_none());
    assert!(registry.is_current(&new).unwrap());
    assert_eq!(
        registry
            .begin(request(&first, 1, finance(), "2026-12"), JobLane::Finance)
            .unwrap_err(),
        RegistryError::StaleRequest
    );
    registry
        .register(snapshot(raw_snapshot(2, "owner-a", 1)))
        .unwrap();
    assert!(registry.complete(&new).unwrap().is_none());
    assert_eq!(
        registry
            .begin(request(&first, 3, finance(), "2026-12"), JobLane::Finance)
            .unwrap_err(),
        RegistryError::MissingSnapshot
    );
}
#[test]
fn old_release_and_cross_registry_leases_cannot_cancel_current_work() {
    let a = SnapshotRegistry::default();
    let first = a.register(snapshot(raw_snapshot(1, "owner-a", 1))).unwrap();
    let second = a.register(snapshot(raw_snapshot(2, "owner-a", 1))).unwrap();
    let lease = a
        .begin(request(&second, 1, finance(), "2026-12"), JobLane::Finance)
        .unwrap();
    assert!(!a.release(first.identity()).unwrap());
    assert!(a.is_current(&lease).unwrap());
    let b = SnapshotRegistry::default();
    b.register(second.clone()).unwrap();
    let other = b
        .begin(request(&second, 1, finance(), "2026-12"), JobLane::Finance)
        .unwrap();
    assert!(b.complete(&lease).unwrap().is_none());
    assert!(b.is_current(&other).unwrap());
    assert!(a.complete(&lease).unwrap().is_some());
    assert!(a.release(second.identity()).unwrap());
    assert_eq!(a.register(first).unwrap_err(), RegistryError::StaleSnapshot);
    a.register(second).unwrap();
}
#[test]
fn account_reset_invalidates_old_leases_even_when_revisions_are_reused() {
    let registry = SnapshotRegistry::default();
    let old = registry
        .register(snapshot(raw_snapshot(1, "owner-a", 1)))
        .unwrap();
    let lease = registry
        .begin(request(&old, 1, finance(), "2026-12"), JobLane::Finance)
        .unwrap();
    registry.reset().unwrap();
    assert_eq!(
        registry.register(old.clone()).unwrap_err(),
        RegistryError::OwnerMismatch
    );
    let current = snapshot(raw_snapshot(1, "owner-b", 1));
    registry
        .reset_for_owner(&contract::OwnerIdentity::new("owner-b", 1).unwrap())
        .unwrap();
    assert_eq!(
        registry.register(old.clone()).unwrap_err(),
        RegistryError::OwnerMismatch
    );
    let current = registry.register(current).unwrap();
    assert!(registry.complete(&lease).unwrap().is_none());
    let lease = registry
        .begin(request(&current, 1, finance(), "2026-12"), JobLane::Finance)
        .unwrap();
    assert!(registry.complete(&lease).unwrap().is_some());
}
#[test]
fn cancelled_or_partly_superseded_jobs_release_only_their_own_slots() {
    let registry = SnapshotRegistry::default();
    let snapshot = registry
        .register(snapshot(raw_snapshot(1, "owner-a", 1)))
        .unwrap();
    let old = registry
        .begin(
            request(&snapshot, 1, finance(), "2026-12"),
            JobLane::Finance,
        )
        .unwrap();
    let time = registry
        .begin(
            request(
                &snapshot,
                2,
                json!({"time":true,"gross":false,"net":false,"checks":false}),
                "2026-12",
            ),
            JobLane::Finance,
        )
        .unwrap();
    drop(old);
    assert!(registry.is_current(&time).unwrap());
    let money = registry
        .begin(
            request(
                &snapshot,
                3,
                json!({"time":false,"gross":true,"net":true,"checks":false}),
                "2026-12",
            ),
            JobLane::Finance,
        )
        .unwrap();
    assert!(registry.complete(&money).unwrap().is_some());
    assert!(registry.complete(&time).unwrap().is_some());
}

#[test]
fn completed_request_watermarks_reject_late_or_duplicate_arrivals() {
    let registry = SnapshotRegistry::default();
    let snapshot = registry
        .register(snapshot(raw_snapshot(1, "owner-a", 1)))
        .unwrap();
    let lease = registry
        .begin(
            request(&snapshot, 2, finance(), "2026-12"),
            JobLane::Finance,
        )
        .unwrap();
    assert!(registry.complete(&lease).unwrap().is_some());
    assert_eq!(
        registry
            .begin(
                request(&snapshot, 1, finance(), "2026-12"),
                JobLane::Finance
            )
            .unwrap_err(),
        RegistryError::StaleRequest
    );
    assert_eq!(
        registry
            .begin(
                request(&snapshot, 2, finance(), "2026-12"),
                JobLane::Finance
            )
            .unwrap_err(),
        RegistryError::DuplicateRequest
    );
    assert_eq!(registry.stats().unwrap().active_writer_slots, 0);
}
#[test]
fn completed_writer_history_stays_bounded_during_long_month_navigation() {
    let registry = SnapshotRegistry::default();
    let snapshot = registry
        .register(snapshot(raw_snapshot(1, "owner-a", 1)))
        .unwrap();
    for i in 0..700 {
        let month = format!("{:04}-{:02}", 1900 + i / 12, i % 12 + 1);
        let lease = registry
            .begin(
                request(
                    &snapshot,
                    i + 1,
                    json!({"time":true,"gross":false,"net":false,"checks":false}),
                    &month,
                ),
                JobLane::Finance,
            )
            .unwrap();
        assert!(registry.complete(&lease).unwrap().is_some());
    }
    assert_eq!(registry.stats().unwrap().writer_slots, 512);
    assert_eq!(registry.stats().unwrap().active_writer_slots, 0);
}
#[test]
fn owner_binding_needs_no_snapshot_payload_and_rejects_invalid_lifecycle_ids() {
    assert!(contract::OwnerIdentity::new("", 1).is_err());
    assert!(contract::OwnerIdentity::new("owner-a", 0).is_err());
    assert!(contract::OwnerIdentity::new("owner-a", contract::MAX_SAFE_REVISION + 1).is_err());
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&contract::OwnerIdentity::new("owner-b", 2).unwrap())
        .unwrap();
    assert_eq!(
        registry
            .register(snapshot(raw_snapshot(1, "owner-a", 1)))
            .unwrap_err(),
        RegistryError::OwnerMismatch
    );
    registry
        .register(snapshot(raw_snapshot(1, "owner-b", 2)))
        .unwrap();
}

#[test]
fn source_revision_fence_blocks_old_results_and_registrations_before_async_loading() {
    let registry = SnapshotRegistry::default();
    let owner = contract::OwnerIdentity::new("owner-a", 1).unwrap();
    registry.reset_for_owner(&owner).unwrap();
    let old = registry
        .register(snapshot(raw_snapshot(1, "owner-a", 1)))
        .unwrap();
    let lease = registry
        .begin(request(&old, 1, finance(), "2026-12"), JobLane::Finance)
        .unwrap();
    let next = contract::RevisionFence::new(owner.clone(), 2).unwrap();
    assert!(registry.advance_revision(&next).unwrap());
    assert!(!registry.is_current(&lease).unwrap());
    assert!(registry.complete(&lease).unwrap().is_none());
    assert_eq!(
        registry.snapshot(old.identity()).unwrap_err(),
        RegistryError::MissingSnapshot
    );
    assert_eq!(
        registry
            .begin(request(&old, 2, finance(), "2026-12"), JobLane::Finance)
            .unwrap_err(),
        RegistryError::MissingSnapshot
    );
    assert_eq!(
        registry.register(old.clone()).unwrap_err(),
        RegistryError::StaleSnapshot
    );
    assert!(!registry.advance_revision(&next).unwrap());
    let current = registry
        .register(snapshot(raw_snapshot(2, "owner-a", 1)))
        .unwrap();
    let current_job = registry
        .begin(request(&current, 1, finance(), "2026-12"), JobLane::Finance)
        .unwrap();
    assert!(!registry.advance_revision(&next).unwrap());
    assert!(registry.is_current(&current_job).unwrap());
    assert_eq!(
        registry.advance_revision(&contract::RevisionFence::new(owner, 1).unwrap()),
        Err(RegistryError::StaleSnapshot)
    );
    let foreign =
        contract::RevisionFence::new(contract::OwnerIdentity::new("owner-b", 2).unwrap(), 100)
            .unwrap();
    assert_eq!(
        registry.advance_revision(&foreign),
        Err(RegistryError::OwnerMismatch)
    );
    assert!(registry.is_current(&current_job).unwrap());
}
#[test]
fn revision_fence_survives_release_and_is_cleared_only_by_lifecycle_reset() {
    let registry = SnapshotRegistry::default();
    let owner = contract::OwnerIdentity::new("owner-a", 1).unwrap();
    registry.reset_for_owner(&owner).unwrap();
    let first = registry
        .register(snapshot(raw_snapshot(1, "owner-a", 1)))
        .unwrap();
    registry
        .advance_revision(&contract::RevisionFence::new(owner.clone(), 3).unwrap())
        .unwrap();
    assert!(registry.release(first.identity()).unwrap());
    assert_eq!(
        registry
            .register(snapshot(raw_snapshot(2, "owner-a", 1)))
            .unwrap_err(),
        RegistryError::StaleSnapshot
    );
    registry
        .register(snapshot(raw_snapshot(3, "owner-a", 1)))
        .unwrap();
    registry.reset().unwrap();
    assert_eq!(
        registry.advance_revision(&contract::RevisionFence::new(owner, 4).unwrap()),
        Err(RegistryError::OwnerMismatch)
    );
    registry
        .reset_for_owner(&contract::OwnerIdentity::new("owner-b", 2).unwrap())
        .unwrap();
    registry
        .register(snapshot(raw_snapshot(1, "owner-b", 2)))
        .unwrap();
}
#[test]
fn small_revision_messages_need_no_placeholder_digests_or_large_source_data() {
    let valid = br#"{"ownerScope":"owner-a","ownerEpoch":1,"snapshotRevision":2}"#;
    assert_eq!(
        contract::parse_revision_fence(valid)
            .unwrap()
            .snapshot_revision(),
        2
    );
    for invalid in [
        br#"{"ownerScope":"owner-a","ownerEpoch":1,"snapshotRevision":2,"ready":true}"#.as_slice(),
        br#"{"ownerScope":"owner-a","ownerEpoch":1,"snapshotRevision":1,"snapshotRevision":2}"#
            .as_slice(),
        br#"{"ownerScope":"owner-a","ownerEpoch":0,"snapshotRevision":2}"#.as_slice(),
        br#"{"ownerScope":"owner-a","ownerEpoch":1,"snapshotRevision":9007199254740992}"#
            .as_slice(),
    ] {
        assert!(contract::parse_revision_fence(invalid).is_err());
    }
    assert_eq!(
        contract::parse_revision_fence(&[b' '; 1025]).unwrap_err(),
        contract::ContractError::InputTooLarge
    );
}
