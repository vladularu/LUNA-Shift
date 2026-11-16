use luna_engine::contract;
use serde_json::{Value, json};
pub fn raw_snapshot(revision: u64, owner: &str, epoch: u64) -> Value {
    let sources: Vec<_> = contract::ALL_SOURCE_KINDS
        .iter()
        .map(|kind| json!({"kind":kind,"source":{"state":"NOT_REQUESTED"}}))
        .collect();
    let mut value = json!({"identity":{"ownerScope":owner,"ownerEpoch":epoch,"snapshotId":format!("snapshot-{revision}"),"snapshotRevision":revision,"inputDigest":"a".repeat(64),"catalogDigest":"b".repeat(64)},"referenceDate":"2026-11-12","sources":sources,"catalogs":{"current":{"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"tariff":{"state":"NOT_REQUESTED"},"legal":{"state":"NOT_REQUESTED"},"holiday":{"state":"NOT_REQUESTED"}},"history":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}});
    seal(&mut value);
    value
}
pub fn seal(value: &mut Value) {
    let digests = contract::snapshot_digests_json(&serde_json::to_vec(value).unwrap()).unwrap();
    value["identity"]["inputDigest"] = json!(digests.input_digest);
    value["identity"]["catalogDigest"] = json!(digests.catalog_digest);
}
