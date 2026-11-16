use luna_engine::{
    contract::{self, OwnerIdentity},
    runtime::{
        SnapshotRegistry,
        calendar_only::{
            CalendarRowIdentity,
            assembly::{CalendarAssemblyError, CalendarAssemblyPool},
        },
    },
};
use serde_json::{Value, json};
fn bytes(v: Value) -> Vec<u8> {
    serde_json::to_vec(&v).unwrap()
}
fn header(clock: bool, rev: u64) -> Vec<u8> {
    bytes(
        json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"ownerScope":"calendar-owner","ownerEpoch":1,"sourceRevision":rev,"intent":if clock{json!({"kind":"CLOCK","observedEpochMilliseconds":1794480000000_i64})}else{json!({"kind":"ROWS"})}}),
    )
}
fn packet(kind: &str, data: Value) -> (Vec<u8>, Vec<u8>) {
    let mut source = json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":data}});
    let body = if source["payload"]["data"]["kind"] == "VALUE" {
        serde_json::to_vec(
            &source["payload"]["data"]
                .as_object_mut()
                .unwrap()
                .remove("value")
                .unwrap(),
        )
        .unwrap()
    } else {
        vec![]
    };
    (bytes(json!({"kind":kind,"source":source})), body)
}
fn rows() -> (Vec<u8>, Vec<u8>) {
    packet(
        "CALENDAR_ENTRIES",
        json!({"kind":"VALUE","value":{"shiftRows":[],"appointmentRows":[],"templateRows":[],"platformCollationRanks":{}}}),
    )
}
fn setup() -> (SnapshotRegistry, CalendarAssemblyPool) {
    let r = SnapshotRegistry::default();
    r.reset_for_owner(&OwnerIdentity::new("calendar-owner", 1).unwrap())
        .unwrap();
    let pool = CalendarAssemblyPool::new(r.clone());
    (r, pool)
}
#[test]
fn row_and_clock_builders_are_independent_and_publish_only_native_current_typed_receipts() {
    let (r, p) = setup();
    let row = p.begin(&header(false, 1)).unwrap();
    let (h, b) = rows();
    p.source(row, &h, &b).unwrap();
    let clock = p.begin(&header(true, 1)).unwrap();
    let (h, b) = packet("WORK_PROFILE", json!({"kind":"NULL"}));
    p.source(clock, &h, &b).unwrap();
    p.source(clock,&bytes(json!({"kind":"REMUNERATION_PROFILES","source":{"state":"FAILED","code":"READ_FAILED"}})),b"").unwrap();
    let rows = p.seal(row).unwrap();
    let clock = p.seal(clock).unwrap();
    let output: Value = serde_json::from_slice(&rows.serialize_current().unwrap()).unwrap();
    assert_eq!(output["state"], "CALENDAR_ROWS_REGISTERED");
    assert_eq!(output["availability"]["state"], "READY");
    assert!(output.get("snapshot").is_none());
    let id: CalendarRowIdentity = serde_json::from_value(output["identity"].clone()).unwrap();
    let lease = r
        .lease_calendar_rows(&r.calendar_rows_marker().unwrap(), &id)
        .unwrap();
    assert!(lease.rows().unwrap().index().source_entries().is_empty());
    let meta: Value = serde_json::from_slice(&clock.serialize_current().unwrap()).unwrap();
    assert_eq!(meta["state"], "CALENDAR_CLOCK_REGISTERED");
    assert_eq!(meta["clock"]["timeZone"], "Europe/Berlin");
    assert_eq!(meta["clock"]["cacheable"], true);
    assert!(meta.get("profile").is_none());
    assert_eq!(p.stats().unwrap().retained_input_bytes, 0);
    let next = p.begin(&header(true, 2)).unwrap();
    assert!(rows.is_current().unwrap());
    assert!(!clock.is_current().unwrap());
    assert!(p.abort(next).unwrap());
    assert!(rows.is_current().unwrap());
}
#[test]
fn failed_missing_and_empty_sources_never_share_ready_receipts() {
    let (_, p) = setup();
    for (n, source, expected) in [
        (
            1,
            json!({"state":"FAILED","code":"READ_FAILED"}),
            "SOURCE_READ_FAILED",
        ),
        (2, json!({"state":"LOADING"}), "SOURCE_LOADING"),
        (3, json!({"state":"NOT_REQUESTED"}), "SOURCE_NOT_REQUESTED"),
    ] {
        let id = p.begin(&header(false, n)).unwrap();
        p.source(
            id,
            &bytes(json!({"kind":"CALENDAR_ENTRIES","source":source})),
            b"",
        )
        .unwrap();
        let output: Value =
            serde_json::from_slice(&p.seal(id).unwrap().serialize_current().unwrap()).unwrap();
        assert_eq!(output["availability"]["state"], "UNAVAILABLE");
        assert_eq!(output["availability"]["reason"]["code"], expected);
    }
}
#[test]
fn same_epoch_reset_and_old_abort_cannot_publish_or_cancel_new_builder() {
    let (r, p) = setup();
    let first = p.begin(&header(false, 1)).unwrap();
    let (h, b) = rows();
    p.source(first, &h, &b).unwrap();
    r.reset_for_owner(&OwnerIdentity::new("calendar-owner", 1).unwrap())
        .unwrap();
    assert!(p.seal(first).is_err());
    let next = p.begin(&header(false, 1)).unwrap();
    assert_ne!(first, next);
    assert!(!p.abort(first).unwrap());
    p.source(next, &h, &b).unwrap();
    let output = p.seal(next).unwrap();
    assert!(output.is_current().unwrap());
    r.reset_for_owner(&OwnerIdentity::new("calendar-owner", 1).unwrap())
        .unwrap();
    assert!(!output.is_current().unwrap());
    assert!(output.serialize_current().is_err());
}
#[test]
fn bad_or_incomplete_source_closes_only_its_own_preparation() {
    let (_, p) = setup();
    let row = p.begin(&header(false, 1)).unwrap();
    let clock = p.begin(&header(true, 1)).unwrap();
    let (h, _) = rows();
    assert!(p.source(row, &h, b"{\"bad\":0,\"bad\":1}").is_err());
    assert!(p.seal(row).is_err());
    assert!(p.seal(clock).is_err());
    assert_eq!(p.stats().unwrap().retained_input_bytes, 0);
    assert!(!p.stats().unwrap().raw_operation);
    let row = p.begin(&header(false, 2)).unwrap();
    let (h, b) = rows();
    p.source(row, &h, &b).unwrap();
    assert!(p.seal(row).is_ok());
    let mut bad: Value = serde_json::from_slice(&header(false, 3)).unwrap();
    bad["ownerScope"] = json!("someone-else");
    assert!(matches!(
        p.begin(&bytes(bad)),
        Err(CalendarAssemblyError::Registry(_))
    ));
}

#[test]
fn fifty_thousand_original_sql_rows_leave_only_one_native_index_and_zero_raw_input_reservation() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../reference/input-calendar-rows-golden.json"
    ))
    .unwrap();
    let seed = &corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "expandedStoredRows-395")
        .unwrap()["input"]["appointmentRows"][0];
    let input = (0..50_000)
        .map(|i| {
            let mut row = seed.clone();
            row["id"] = json!(format!("owned-{i:05}"));
            row["date"] = json!(if i % 2 == 0 {
                "2026-03-01"
            } else {
                "2026-03-02"
            });
            row["recurrence_frequency"] = Value::Null;
            row["recurrence_interval"] = Value::Null;
            row
        })
        .collect::<Vec<_>>();
    let (r, p) = setup();
    let id = p.begin(&header(false, 1)).unwrap();
    let (h, b) = packet(
        "CALENDAR_ENTRIES",
        json!({"kind":"VALUE","value":{"shiftRows":[],"appointmentRows":input,"templateRows":[],"platformCollationRanks":{}}}),
    );
    assert!(b.len() < contract::MAX_INPUT_BYTES as usize);
    p.source(id, &h, &b).unwrap();
    assert_eq!(
        p.stats().unwrap().retained_input_bytes,
        (header(false, 1).len() + h.len() + b.len()) as u64
    );
    drop(b);
    let completed = p.seal(id).unwrap();
    let value: Value = serde_json::from_slice(&completed.serialize_current().unwrap()).unwrap();
    assert_eq!(value["availability"]["state"], "READY");
    let identity = serde_json::from_value(value["identity"].clone()).unwrap();
    let first = r
        .lease_calendar_rows(&r.calendar_rows_marker().unwrap(), &identity)
        .unwrap();
    let second = r
        .lease_calendar_rows(&r.calendar_rows_marker().unwrap(), &identity)
        .unwrap();
    assert!(std::sync::Arc::ptr_eq(
        first.rows().unwrap().index(),
        second.rows().unwrap().index()
    ));
    assert_eq!(first.rows().unwrap().index().source_entries().len(), 50_000);
    assert_eq!(p.stats().unwrap().retained_input_bytes, 0);
}
