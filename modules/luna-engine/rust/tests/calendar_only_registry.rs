#[path = "support/snapshot.rs"]
mod snapshot;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    contract::{
        self, ImmutableSnapshot, OwnerIdentity, RevisionFence, SourceState, ValidatedRequest,
        utility::{UtilityGuard, UtilityKind},
    },
    runtime::SnapshotRegistry,
};
use serde_json::{Value, json};
use std::sync::Arc;
fn ready(value: Value) -> SourceState {
    serde_json::from_value(json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":value}}})).unwrap()
}
fn empty() -> SourceState {
    ready(
        json!({"shiftRows":[],"appointmentRows":[],"templateRows":[],"platformCollationRanks":{}}),
    )
}
fn null() -> SourceState {
    serde_json::from_value(json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"NULL"}}})).unwrap()
}
fn setup() -> SnapshotRegistry {
    let r = SnapshotRegistry::default();
    r.reset_for_owner(&OwnerIdentity::new("calendar-owner", 1).unwrap())
        .unwrap();
    r
}
fn financial(r: &SnapshotRegistry, n: u64) -> ImmutableSnapshot {
    let raw = snapshot::raw_snapshot(n, "calendar-owner", 1);
    let input = json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}});
    let ValidatedRequest::RegisterSnapshot(s) =
        contract::parse_request(&serde_json::to_vec(&input).unwrap()).unwrap()
    else {
        panic!("snapshot")
    };
    r.register(s).unwrap()
}
#[test]
fn calendar_rows_clock_and_financial_generations_are_independent() {
    let r = setup();
    let f = financial(&r, 1);
    let guard:UtilityGuard=serde_json::from_value(json!({"ownerScope":"calendar-owner","ownerEpoch":1,"requestId":"financial-test","draftRevision":1,"snapshot":f.identity()})).unwrap();
    let finance = r
        .lease_utility(
            &r.utility_owner_marker().unwrap(),
            &guard,
            UtilityKind::MonthGrid,
        )
        .unwrap();
    let rows = r
        .start_calendar_rows(&r.calendar_rows_marker().unwrap(), 1)
        .unwrap();
    let row_id = r.register_calendar_rows(&rows, 1, &empty()).unwrap();
    let row_lease = r.lease_calendar_rows(&rows, &row_id).unwrap();
    assert!(finance.is_current().unwrap());
    assert_eq!(r.snapshot(f.identity()).unwrap().identity(), f.identity());
    assert!(row_lease.is_current().unwrap());
    let cm = r
        .start_calendar_clock(&r.calendar_clock_marker().unwrap(), 1)
        .unwrap();
    let clock_id = r
        .register_calendar_clock(&cm, 1, &null(), &SourceState::NotRequested, 1794480000000)
        .unwrap();
    let clock = r.lease_calendar_clock(&cm, &clock_id).unwrap();
    assert!(row_lease.is_current().unwrap());
    assert!(finance.is_current().unwrap());
    assert!(clock.is_current().unwrap());
    r.advance_revision(
        &RevisionFence::new(OwnerIdentity::new("calendar-owner", 1).unwrap(), 2).unwrap(),
    )
    .unwrap();
    financial(&r, 2);
    assert!(!finance.is_current().unwrap());
    assert!(row_lease.is_current().unwrap());
    assert!(clock.is_current().unwrap());
    let next_rows = r
        .start_calendar_rows(&r.calendar_rows_marker().unwrap(), 2)
        .unwrap();
    assert!(!row_lease.is_current().unwrap());
    assert!(clock.is_current().unwrap());
    r.register_calendar_rows(&next_rows, 2, &empty()).unwrap();
    assert!(clock.is_current().unwrap());
    let cm2 = r
        .start_calendar_clock(&r.calendar_clock_marker().unwrap(), 2)
        .unwrap();
    assert!(!clock.is_current().unwrap());
    let row2 = r
        .lease_calendar_rows(
            &next_rows,
            &r.register_calendar_rows(&next_rows, 2, &empty()).unwrap(),
        )
        .unwrap();
    assert!(row2.is_current().unwrap());
    r.register_calendar_clock(&cm2, 2, &null(), &SourceState::NotRequested, 1794480000001)
        .unwrap();
    assert!(row2.is_current().unwrap());
}
#[test]
fn same_owner_epoch_reset_invalidates_all_markers_and_retires_large_owners_for_worker_drop() {
    let r = setup();
    let rows = r
        .start_calendar_rows(&r.calendar_rows_marker().unwrap(), 1)
        .unwrap();
    let id = r.register_calendar_rows(&rows, 1, &empty()).unwrap();
    let lease = r.lease_calendar_rows(&rows, &id).unwrap();
    let weak = Arc::downgrade(lease.rows().unwrap());
    r.reset_for_owner(&OwnerIdentity::new("calendar-owner", 1).unwrap())
        .unwrap();
    assert!(!lease.is_current().unwrap());
    assert!(r.register_calendar_rows(&rows, 1, &empty()).is_err());
    assert!(r.lease_calendar_rows(&rows, &id).is_err());
    drop(lease);
    assert!(
        weak.upgrade().is_some(),
        "reset metadata must not be last large drop"
    );
    assert!(r.collect_retired().unwrap());
    assert!(weak.upgrade().is_none());
    assert!(!r.collect_retired().unwrap());
    let fresh = r
        .start_calendar_rows(&r.calendar_rows_marker().unwrap(), 1)
        .unwrap();
    let new = r.register_calendar_rows(&fresh, 1, &empty()).unwrap();
    let latest = r.lease_calendar_rows(&fresh, &new).unwrap();
    assert!(latest.is_current().unwrap());
    assert!(r.lease_calendar_rows(&rows, &new).is_err());
}
#[test]
fn unavailable_source_is_current_but_never_an_empty_ready_calendar_and_foreign_locators_fail() {
    let r = setup();
    let marker = r
        .start_calendar_rows(&r.calendar_rows_marker().unwrap(), 1)
        .unwrap();
    let id = r
        .register_calendar_rows(&marker, 1, &SourceState::Loading)
        .unwrap();
    let lease = r.lease_calendar_rows(&marker, &id).unwrap();
    assert!(lease.is_current().unwrap());
    assert_eq!(lease.rows().err().unwrap().code, "SOURCE_LOADING");
    let mut forged = serde_json::to_value(&id).unwrap();
    forged["ownerEpoch"] = json!(2);
    let forged = serde_json::from_value(forged).unwrap();
    assert!(r.lease_calendar_rows(&marker, &forged).is_err());
    assert!(r.start_calendar_rows(&marker, 0).is_err());
    assert!(r.start_calendar_rows(&marker, u64::MAX).is_err());
    let newer = r
        .start_calendar_rows(&r.calendar_rows_marker().unwrap(), 2)
        .unwrap();
    assert!(r.register_calendar_rows(&marker, 1, &empty()).is_err());
    assert!(r.register_calendar_rows(&newer, 1, &empty()).is_err());
    let id = r.register_calendar_rows(&newer, 2, &empty()).unwrap();
    assert!(
        r.lease_calendar_rows(&newer, &id)
            .unwrap()
            .rows()
            .unwrap()
            .index()
            .source_entries()
            .is_empty()
    );
}

#[test]
fn abort_is_scoped_and_old_abort_cannot_cancel_a_newer_source_or_clock() {
    let r = setup();
    let first = r
        .start_calendar_rows(&r.calendar_rows_marker().unwrap(), 1)
        .unwrap();
    assert!(r.cancel_calendar_rows(&first).unwrap());
    assert!(!first.is_current().unwrap());
    let next = r
        .start_calendar_rows(&r.calendar_rows_marker().unwrap(), 2)
        .unwrap();
    assert!(!r.cancel_calendar_rows(&first).unwrap());
    assert!(next.is_current().unwrap());
    let cm = r
        .start_calendar_clock(&r.calendar_clock_marker().unwrap(), 1)
        .unwrap();
    assert!(r.cancel_calendar_clock(&cm).unwrap());
    let cm2 = r
        .start_calendar_clock(&r.calendar_clock_marker().unwrap(), 2)
        .unwrap();
    assert!(!r.cancel_calendar_clock(&cm).unwrap());
    assert!(cm2.is_current().unwrap());
    assert!(next.is_current().unwrap());
    r.cancel_calendar_rows(&next).unwrap();
    assert!(cm2.is_current().unwrap());
}

#[test]
fn native_clock_expiry_can_roll_the_day_without_a_database_revision_or_row_invalidation() {
    let r = setup();
    let rows = r
        .start_calendar_rows(&r.calendar_rows_marker().unwrap(), 1)
        .unwrap();
    let id = r.register_calendar_rows(&rows, 1, &empty()).unwrap();
    let row = r.lease_calendar_rows(&rows, &id).unwrap();
    let first = r
        .start_calendar_clock(&r.calendar_clock_marker().unwrap(), 1)
        .unwrap();
    let id = r
        .register_calendar_clock(
            &first,
            1,
            &null(),
            &SourceState::NotRequested,
            1794480000000,
        )
        .unwrap();
    let clock = r.lease_calendar_clock(&first, &id).unwrap();
    let until = clock
        .clock()
        .metadata()
        .valid_until_epoch_milliseconds
        .unwrap();
    assert!(clock.is_fresh_at(until - 1).unwrap());
    assert!(!clock.is_fresh_at(until).unwrap());
    let next = r
        .start_calendar_clock(&r.calendar_clock_marker().unwrap(), 1)
        .unwrap();
    let nextid = r
        .register_calendar_clock(&next, 1, &null(), &SourceState::NotRequested, until)
        .unwrap();
    assert_ne!(id.digest(), nextid.digest());
    let newclock = r.lease_calendar_clock(&next, &nextid).unwrap();
    assert!(newclock.is_fresh_at(until).unwrap());
    assert!(!clock.is_current().unwrap());
    assert!(row.is_current().unwrap());
    let degraded = r
        .register_calendar_clock(
            &next,
            1,
            &SourceState::Loading,
            &SourceState::NotRequested,
            until,
        )
        .unwrap();
    assert!(
        !r.lease_calendar_clock(&next, &degraded)
            .unwrap()
            .is_fresh_at(until)
            .unwrap()
    );
    r.register_calendar_clock(&next, 1, &null(), &SourceState::NotRequested, until)
        .unwrap();
}

#[test]
fn read_state_recovery_at_same_database_revision_does_not_erase_successful_content_guard() {
    let r = setup();
    let marker = r
        .start_calendar_rows(&r.calendar_rows_marker().unwrap(), 1)
        .unwrap();
    r.register_calendar_rows(&marker, 1, &SourceState::Loading)
        .unwrap();
    let first = r.register_calendar_rows(&marker, 1, &empty()).unwrap();
    r.register_calendar_rows(&marker, 1, &SourceState::Loading)
        .unwrap();
    let recovered = r.register_calendar_rows(&marker, 1, &empty()).unwrap();
    assert_eq!(first, recovered);
    let changed = ready(
        json!({"shiftRows":[],"appointmentRows":[],"templateRows":[{"id":"added","name":"Original SQL name","color":"#abcdef","symbol":"F"}],"platformCollationRanks":{}}),
    );
    assert!(r.register_calendar_rows(&marker, 1, &changed).is_err());
    let clock = r
        .start_calendar_clock(&r.calendar_clock_marker().unwrap(), 1)
        .unwrap();
    r.register_calendar_clock(
        &clock,
        1,
        &SourceState::Loading,
        &SourceState::NotRequested,
        1794480000000,
    )
    .unwrap();
    let id = r
        .register_calendar_clock(
            &clock,
            1,
            &null(),
            &SourceState::NotRequested,
            1794480000000,
        )
        .unwrap();
    assert!(
        r.lease_calendar_clock(&clock, &id)
            .unwrap()
            .is_fresh_at(1794480000000)
            .unwrap()
    );
}

#[test]
fn changed_ready_clock_inputs_need_a_new_source_cas_after_io_recovery() {
    let data = value_pool::decode(include_str!("../../reference/profile-clock-golden.json"));
    let input = &data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "zone-1-instant-0-history-0")
        .unwrap()["input"];
    let r = setup();
    let marker = r
        .start_calendar_clock(&r.calendar_clock_marker().unwrap(), 1)
        .unwrap();
    r.register_calendar_clock(
        &marker,
        1,
        &null(),
        &SourceState::NotRequested,
        1794480000000,
    )
    .unwrap();
    r.register_calendar_clock(
        &marker,
        1,
        &SourceState::Loading,
        &SourceState::NotRequested,
        1794480000000,
    )
    .unwrap();
    assert!(
        r.register_calendar_clock(
            &marker,
            1,
            &ready(input["profile"].clone()),
            &ready(input["historyRows"].clone()),
            1794480000000
        )
        .is_err()
    );
    let marker = r
        .start_calendar_clock(&r.calendar_clock_marker().unwrap(), 2)
        .unwrap();
    let id = r
        .register_calendar_clock(
            &marker,
            2,
            &ready(input["profile"].clone()),
            &ready(input["historyRows"].clone()),
            1794480000000,
        )
        .unwrap();
    let lease = r.lease_calendar_clock(&marker, &id).unwrap();
    assert_eq!(lease.clock().metadata().time_zone, "America/Los_Angeles");
    assert!(lease.is_fresh_at(1794480000000).unwrap());
}

#[test]
fn no_saved_profile_does_not_make_unused_history_io_a_clock_dependency() {
    let r = setup();
    let marker = r
        .start_calendar_clock(&r.calendar_clock_marker().unwrap(), 1)
        .unwrap();
    let first = r
        .register_calendar_clock(
            &marker,
            1,
            &null(),
            &SourceState::NotRequested,
            1794480000000,
        )
        .unwrap();
    let id = r
        .register_calendar_clock(&marker, 1, &null(), &SourceState::Loading, 1794480000000)
        .unwrap();
    assert_eq!(first, id);
    assert!(
        r.lease_calendar_clock(&marker, &id)
            .unwrap()
            .is_fresh_at(1794480000000)
            .unwrap()
    );
}
