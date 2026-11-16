use luna_engine::contract::{self, financial_collation::*};
use serde_json::{Value, json};

fn header() -> Value {
    json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"financial-owner","ownerEpoch":1,"requestId":"details-july","draftRevision":1,"snapshot":{"ownerScope":"financial-owner","ownerEpoch":1,"snapshotId":"snapshot","snapshotRevision":1,"inputDigest":"a".repeat(64),"catalogDigest":"b".repeat(64)}},"intent":{"month":"2026-07","perspective":"EARNED","filter":null,"includeSpecialDutyPay":false},"localeKey":"de-DE:source-collator"})
}
#[test]
fn strict_prepare_is_source_bound_versioned_and_cannot_contain_ready_evidence() {
    let valid = header();
    let parsed = parse_prepare(&serde_json::to_vec(&valid).unwrap()).unwrap();
    assert!(parsed.guard().snapshot().is_some());
    assert_eq!(parsed.intent().month(), "2026-07");
    assert_eq!(parsed.locale_key(), "de-DE:source-collator");
    let mut missing_filter = valid.clone();
    missing_filter["intent"]
        .as_object_mut()
        .unwrap()
        .remove("filter");
    assert!(parse_prepare(&serde_json::to_vec(&missing_filter).unwrap()).is_err());
    for key in [
        "wireSchemaVersion",
        "expectedEngineVersion",
        "calculationContractVersion",
        "localeKey",
        "intent",
        "guard",
    ] {
        let mut bad = valid.clone();
        bad.as_object_mut().unwrap().remove(key);
        assert!(parse_prepare(&serde_json::to_vec(&bad).unwrap()).is_err());
    }
    for path in ["snapshot", "ready"] {
        let mut bad = valid.clone();
        if path == "snapshot" {
            bad["guard"].as_object_mut().unwrap().remove(path);
        } else {
            bad["intent"][path] = json!(true);
        }
        assert!(parse_prepare(&serde_json::to_vec(&bad).unwrap()).is_err());
    }
    for month in ["2026-13", "2026-7", "0000-01"] {
        let mut bad = valid.clone();
        bad["intent"]["month"] = json!(month);
        assert!(parse_prepare(&serde_json::to_vec(&bad).unwrap()).is_err());
    }
    let mut bad = valid.clone();
    bad["intent"]["filter"] = json!("x".repeat(129));
    assert!(parse_prepare(&serde_json::to_vec(&bad).unwrap()).is_err());
    for (key, value, expected) in [
        (
            "wireSchemaVersion",
            json!(2),
            contract::ContractError::UnsupportedSchema,
        ),
        (
            "expectedEngineVersion",
            json!("stale"),
            contract::ContractError::UnsupportedEngine,
        ),
        (
            "calculationContractVersion",
            json!("stale"),
            contract::ContractError::UnsupportedContract,
        ),
    ] {
        let mut bad = valid.clone();
        bad[key] = value;
        assert!(
            matches!(parse_prepare(&serde_json::to_vec(&bad).unwrap()), Err(error) if error == expected)
        );
    }
    let duplicate = valid.to_string().replace(
        "\"draftRevision\":1",
        "\"draftRevision\":1,\"draftRevision\":2",
    );
    assert!(parse_prepare(duplicate.as_bytes()).is_err());
    assert!(parse_prepare(&vec![b' '; MAX_PREPARE_BYTES + 1]).is_err());
}
#[test]
fn small_locator_frames_are_closed_bounded_and_do_not_deserialize_an_admission_proof() {
    let value = json!({"draftId":1,"candidateDigest":"a".repeat(64),"after":null,"limit":1024});
    assert_eq!(
        parse_candidates(&serde_json::to_vec(&value).unwrap())
            .unwrap()
            .limit(),
        1024
    );
    for key in ["ready", "ranks", "proof"] {
        let mut bad = value.clone();
        bad[key] = json!(true);
        assert!(parse_candidates(&serde_json::to_vec(&bad).unwrap()).is_err());
    }
    for id in [0, 9_007_199_254_740_992u64] {
        let mut bad = value.clone();
        bad["draftId"] = json!(id);
        assert!(parse_candidates(&serde_json::to_vec(&bad).unwrap()).is_err());
    }
    for limit in [0, 1025] {
        let mut bad = value.clone();
        bad["limit"] = json!(limit);
        assert!(parse_candidates(&serde_json::to_vec(&bad).unwrap()).is_err());
    }
    let finalizer = parse_finalize(
        &serde_json::to_vec(
            &json!({"draftId":1,"candidateDigest":"a".repeat(64),"reuseCached":true}),
        )
        .unwrap(),
    )
    .unwrap();
    assert!(finalizer.reuse_cached());
    assert_eq!(parse_abort(br#"{"draftId":1}"#).unwrap().draft_id(), 1);
    assert!(parse_abort(br#"{"draftId":1,"draftId":2}"#).is_err());
    assert!(parse_finalize(&vec![b' '; MAX_CONTROL_BYTES + 1]).is_err());
}
