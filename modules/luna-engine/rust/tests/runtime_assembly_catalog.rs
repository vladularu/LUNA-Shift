use luna_engine::{
    contract::{self, OwnerIdentity},
    runtime::{
        SnapshotRegistry,
        assembly::{BuilderId, SnapshotAssemblyPool, SourceTarget},
        catalog,
        facts::SnapshotFacts,
    },
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
fn chunks(text: &str) -> Value {
    let mut parts = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if current.len() + ch.len_utf8() > 60_000 {
            parts.push(std::mem::take(&mut current));
        }
        current.push(ch);
    }
    parts.push(current);
    json!(parts)
}
fn add_external(pool: &SnapshotAssemblyPool, id: BuilderId, invalid_rules: bool) {
    let reference: Value = serde_json::from_str(include_str!(
        "../../reference/catalog-validation-golden.json"
    ))
    .unwrap();
    let input = &reference["cases"][0]["input"];
    let mut manifest = input["manifest"].clone();
    let mut parts = [Vec::new(), Vec::new(), Vec::new()];
    for original in input["packages"].as_array().unwrap() {
        let mut package = original.clone();
        if invalid_rules && package["kind"] == "TARIFF" {
            package["engineContractVersion"] = json!(999);
        }
        let raw = format!(" \n{}\r\n", serde_json::to_string(&package).unwrap());
        let descriptor = manifest["packages"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|d| {
                d["packageId"] == package["packageId"] && d["versionId"] == package["versionId"]
            })
            .unwrap();
        descriptor["sha256"] = json!(format!("{:x}", Sha256::digest(raw.as_bytes())));
        descriptor["sizeBytes"] = json!(raw.len());
        let index = match package["kind"].as_str().unwrap() {
            "TARIFF" => 0,
            "LEGAL" => 1,
            "HOLIDAY" => 2,
            _ => unreachable!(),
        };
        parts[index].push(chunks(&raw));
    }
    for (index, kind) in ["TARIFF", "LEGAL", "HOLIDAY"].into_iter().enumerate() {
        let mut value = json!({"mode":"EXTERNAL","packageJsonChunks":parts[index]});
        if index == 0 {
            value["manifestJsonChunks"] = chunks(&serde_json::to_string(&manifest).unwrap());
            value["historicalPolicy"] = json!("APP_COMPATIBILITY");
            value["collationRanks"] = json!({});
        }
        let header = json!({"kind":kind,"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}}});
        pool.source(
            id,
            SourceTarget::Catalog,
            &serde_json::to_vec(&header).unwrap(),
            &serde_json::to_vec(&value).unwrap(),
        )
        .unwrap();
    }
}
fn ranks(pool: &SnapshotAssemblyPool, id: BuilderId) -> Vec<u8> {
    let mut after = None;
    let mut ranks = serde_json::Map::new();
    let mut digest = None;
    loop {
        let reply = pool.catalog_candidates(id, after, 3).unwrap();
        assert_eq!(reply["state"], "CATALOG_CANDIDATES");
        if let Some(digest) = &digest {
            assert_eq!(digest, &reply["page"]["candidateDigest"]);
        } else {
            digest = Some(reply["page"]["candidateDigest"].clone());
        }
        for name in reply["page"]["candidates"].as_array().unwrap() {
            ranks.insert(name.as_str().unwrap().to_owned(), json!(0));
        }
        after = reply["page"]["nextAfter"].as_u64().map(|n| n as u32);
        if after.is_none() {
            break;
        }
    }
    serde_json::to_vec(&ranks).unwrap()
}
fn setup() -> (SnapshotRegistry, SnapshotAssemblyPool, BuilderId) {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("catalog-owner", 1).unwrap())
        .unwrap();
    let pool = SnapshotAssemblyPool::new(registry.clone());
    let id=pool.begin(br#"{"ownerScope":"catalog-owner","ownerEpoch":1,"snapshotId":"catalog-test","snapshotRevision":1,"referenceDate":"2026-11-13","selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}}"#).unwrap();
    (registry, pool, id)
}
fn add(pool: &SnapshotAssemblyPool, id: BuilderId, mode: &str) {
    for kind in ["TARIFF", "LEGAL", "HOLIDAY"] {
        let header = json!({"kind":kind,"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}}});
        pool.source(
            id,
            SourceTarget::Catalog,
            &serde_json::to_vec(&header).unwrap(),
            &serde_json::to_vec(&json!({"mode":mode})).unwrap(),
        )
        .unwrap();
    }
}
#[test]
fn compiled_defaults_are_derived_natively_from_empty_selection_without_calendar_dependency() {
    for mode in ["COMPILED_PREVIEW", "COMPILED_LEGACY"] {
        let (_, pool, id) = setup();
        add(&pool, id, mode);
        let page = pool.catalog_candidates(id, None, 1024).unwrap();
        assert_eq!(page["state"], "CATALOG_CANDIDATES");
        assert_eq!(page["page"]["total"], 0);
        let expected = if mode == "COMPILED_PREVIEW" {
            catalog::compiled_preview().unwrap()
        } else {
            catalog::compiled_legacy().unwrap()
        };
        let ids = expected.resolver().default_package_ids();
        assert_eq!(
            page["defaultPackageIds"],
            json!({"tariff":[ids.tariff],"legal":[ids.legal],"holiday":[ids.holiday]})
        );
        let finalized = pool.catalog_finalize(id, b"{}").unwrap();
        assert_eq!(finalized["state"], "CATALOG_FINALIZED");
        let sealed = pool.seal(id).unwrap();
        assert_eq!(
            sealed.current_catalog().selected_package_ids().tariff(),
            std::slice::from_ref(&ids.tariff)
        );
        let facts = SnapshotFacts::new(sealed);
        assert_eq!(facts.catalog().unwrap().origin(), expected.origin());
    }
}
#[test]
fn external_artifacts_paginate_once_bind_native_defaults_and_keep_external_origin() {
    let (_, pool, id) = setup();
    add_external(&pool, id, false);
    let values = ranks(&pool, id);
    let final_reply = pool.catalog_finalize(id, &values).unwrap();
    assert_eq!(final_reply["state"], "CATALOG_FINALIZED");
    let snapshot = pool.seal(id).unwrap();
    let facts = SnapshotFacts::new(snapshot);
    assert_eq!(
        facts.catalog().unwrap().origin(),
        catalog::CatalogOrigin::External
    );
    assert!(!facts.catalog().unwrap().resolver().is_bundled());
}
#[test]
fn semantic_rejection_keeps_calendar_sealable_and_never_fakes_ready_catalogs() {
    let (_, pool, id) = setup();
    add_external(&pool, id, true);
    let values = ranks(&pool, id);
    assert_eq!(
        pool.catalog_finalize(id, &values).unwrap()["state"],
        "CATALOG_UNAVAILABLE"
    );
    let snapshot = pool.seal(id).unwrap();
    assert!(
        !snapshot
            .current_catalog()
            .selected_package_ids()
            .tariff()
            .is_empty()
    );
    assert!(SnapshotFacts::new(snapshot).catalog().is_err());
}
#[test]
fn missing_noninteger_and_duplicate_locale_ranks_are_rejected_before_seal() {
    for raw in [
        b"{}".as_slice(),
        br#"{"NATIONWIDE":true}"#.as_slice(),
        br#"{"NATIONWIDE":0,"NATIONWIDE":0}"#.as_slice(),
    ] {
        let (_, pool, id) = setup();
        add_external(&pool, id, false);
        assert!(pool.catalog_finalize(id, raw).is_err());
        assert!(pool.seal(id).is_err());
    }
}
#[test]
fn failed_catalog_reads_remain_unavailable_and_never_prevent_unrelated_snapshot_seal() {
    let (_, pool, id) = setup();
    for kind in ["TARIFF", "LEGAL", "HOLIDAY"] {
        let header = json!({"kind":kind,"source":{"state":"FAILED","code":"READ_FAILED"}});
        pool.source(
            id,
            SourceTarget::Catalog,
            &serde_json::to_vec(&header).unwrap(),
            b"",
        )
        .unwrap();
    }
    assert_eq!(
        pool.catalog_candidates(id, None, 1024).unwrap()["state"],
        "CATALOG_UNAVAILABLE"
    );
    assert_eq!(
        pool.catalog_finalize(id, b"{}").unwrap()["state"],
        "CATALOG_UNAVAILABLE"
    );
    let snapshot = pool.seal(id).unwrap();
    assert!(
        snapshot
            .current_catalog()
            .selected_package_ids()
            .tariff()
            .is_empty()
    );
    assert!(matches!(
        snapshot.current_catalog().tariff(),
        contract::SourceState::Failed { .. }
    ));
    assert!(SnapshotFacts::new(snapshot).catalog().is_err());
}
#[test]
fn rank_finalization_and_owner_lifecycle_cannot_be_bypassed_by_sealing() {
    let (_, pool, id) = setup();
    add(&pool, id, "COMPILED_PREVIEW");
    pool.catalog_candidates(id, None, 8).unwrap();
    assert!(pool.seal(id).is_err());
    let (registry, pool, id) = setup();
    add(&pool, id, "COMPILED_LEGACY");
    pool.catalog_finalize(id, b"{}").unwrap();
    registry
        .reset_for_owner(&OwnerIdentity::new("catalog-owner", 1).unwrap())
        .unwrap();
    assert!(pool.seal(id).is_err());
    let (_, pool, id) = setup();
    add(&pool, id, "COMPILED_PREVIEW");
    assert!(pool.catalog_finalize(id, b"{\"invented\":0}").is_err());
}
