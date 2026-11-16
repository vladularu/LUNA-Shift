use luna_engine::{
    contract::{self, OwnerIdentity},
    runtime::{
        SnapshotRegistry,
        assembly::{BuilderId, SnapshotAssemblyPool, SourceTarget},
    },
};
use serde_json::{Value, json};
#[path = "support/snapshot.rs"]
mod snapshot;
fn header(raw: &Value) -> Vec<u8> {
    let i = &raw["identity"];
    serde_json::to_vec(&json!({"ownerScope":i["ownerScope"],"ownerEpoch":i["ownerEpoch"],"snapshotId":i["snapshotId"],"snapshotRevision":i["snapshotRevision"],"referenceDate":raw["referenceDate"],"selectedPackageIds":raw["catalogs"]["current"]["selectedPackageIds"],"completeness":raw["completeness"]})).unwrap()
}
fn setup() -> (SnapshotRegistry, SnapshotAssemblyPool) {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("owner", 1).unwrap())
        .unwrap();
    let pool = SnapshotAssemblyPool::new(registry.clone());
    (registry, pool)
}
#[test]
fn native_pool_seals_the_identical_existing_snapshot_and_registers_it() {
    let (registry, pool) = setup();
    let mut raw = snapshot::raw_snapshot(1, "owner", 1);
    raw["sources"][0]["source"] = json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":{"zero":0,"text":"ä猫","nullable":null}}}});
    snapshot::seal(&mut raw);
    let id = pool.begin(&header(&raw)).unwrap();
    let mut group = raw["sources"][0].clone();
    let body = group["source"]["payload"]["data"]
        .as_object_mut()
        .unwrap()
        .remove("value")
        .unwrap();
    pool.source(
        id,
        SourceTarget::Source,
        &serde_json::to_vec(&group).unwrap(),
        &serde_json::to_vec(&body).unwrap(),
    )
    .unwrap();
    let actual = pool.seal(id).unwrap();
    assert_eq!(
        serde_json::to_value(actual.identity()).unwrap(),
        raw["identity"]
    );
    assert_eq!(
        serde_json::to_value(actual.sources()).unwrap(),
        raw["sources"]
    );
    assert_eq!(
        registry.snapshot(actual.identity()).unwrap().identity(),
        actual.identity()
    );
    assert!(!pool.abort(id).unwrap());
}
#[test]
fn new_begin_abort_and_same_owner_reset_never_register_old_assemblies() {
    let (registry, pool) = setup();
    let raw = snapshot::raw_snapshot(1, "owner", 1);
    let old = pool.begin(&header(&raw)).unwrap();
    let latest = pool.begin(&header(&raw)).unwrap();
    assert_ne!(old, latest);
    assert!(pool.seal(old).is_err());
    assert!(!pool.abort(old).unwrap());
    assert!(pool.seal(latest).is_ok());
    let mut next = snapshot::raw_snapshot(2, "owner", 1);
    snapshot::seal(&mut next);
    let aborted = pool.begin(&header(&next)).unwrap();
    assert!(pool.abort(aborted).unwrap());
    assert!(pool.seal(aborted).is_err());
    let reset = pool.begin(&header(&next)).unwrap();
    registry
        .reset_for_owner(&OwnerIdentity::new("owner", 1).unwrap())
        .unwrap();
    assert!(pool.seal(reset).is_err());
    pool.collect_retired().unwrap();
    let final_id = pool.begin(&header(&next)).unwrap();
    assert!(pool.seal(final_id).is_ok());
}
#[test]
fn numeric_ids_and_invalid_headers_are_bounded_without_owner_capture() {
    for value in [0, contract::MAX_SAFE_REVISION + 1, u64::MAX] {
        assert!(BuilderId::from_wire(value).is_none());
    }
    let (registry, pool) = setup();
    let mut raw = snapshot::raw_snapshot(1, "other-owner", 1);
    assert!(pool.begin(&header(&raw)).is_err());
    raw["identity"]["ownerScope"] = json!("owner");
    assert!(pool.begin(&vec![b' '; 128 * 1024 + 1]).is_err());
    assert!(pool.begin(b"{private").is_err());
    let id = pool.begin(&header(&raw)).unwrap();
    assert!(pool.seal(id).is_ok());
    assert!(!registry.collect_retired().unwrap());
}
#[test]
fn preparation_start_and_cancel_are_exact_and_preserve_newer_ownership() {
    let (registry, _) = setup();
    let body = contract::assembly::SnapshotAssembly::begin(&header(&snapshot::raw_snapshot(
        1, "owner", 1,
    )))
    .unwrap();
    let entry = registry.preparation_marker().unwrap();
    let first = registry.start_preparation(&entry, &body.fence()).unwrap();
    assert!(!entry.is_current().unwrap());
    let second = registry.start_preparation(&first, &body.fence()).unwrap();
    assert!(!first.is_current().unwrap());
    assert!(!registry.cancel_preparation(&first).unwrap());
    assert!(second.is_current().unwrap());
    assert!(registry.cancel_preparation(&second).unwrap());
    assert!(!second.is_current().unwrap());
    let foreign = SnapshotRegistry::default().preparation_marker().unwrap();
    assert!(registry.start_preparation(&foreign, &body.fence()).is_err());
    assert!(registry.cancel_preparation(&foreign).is_err());
}
