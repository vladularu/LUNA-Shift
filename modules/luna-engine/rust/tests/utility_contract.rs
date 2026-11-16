use luna_engine::contract::{self, ContractError, utility::*};
use serde_json::{Value, json};
fn envelope() -> Value {
    json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"owner-a","ownerEpoch":1,"requestId":"editor-a","draftRevision":0},"operation":{"kind":"MONTH_RANGE","month":"2026-11"}})
}
fn parse(value: &Value) -> Result<UtilityRequest, ContractError> {
    parse_utility_request(&serde_json::to_vec(value).unwrap())
}
#[test]
fn envelope_is_versioned_and_preserves_owner_only_missing_snapshot() {
    let value = envelope();
    let parsed = parse(&value).unwrap();
    assert_eq!(parsed.guard().draft_revision(), 0);
    assert!(parsed.guard().snapshot().is_none());
    assert!(
        serde_json::to_value(parsed.guard())
            .unwrap()
            .get("snapshot")
            .is_none()
    );
    for (field, expected) in [
        ("wireSchemaVersion", ContractError::UnsupportedSchema),
        ("expectedEngineVersion", ContractError::UnsupportedEngine),
        (
            "calculationContractVersion",
            ContractError::UnsupportedContract,
        ),
    ] {
        let mut bad = value.clone();
        bad[field] = if field == "wireSchemaVersion" {
            json!(999)
        } else {
            json!("unknown")
        };
        assert_eq!(parse(&bad).unwrap_err(), expected);
    }
    for path in ["snapshot", "ready"] {
        let mut bad = value.clone();
        bad["guard"][path] = Value::Null;
        assert_eq!(parse(&bad).unwrap_err(), ContractError::MalformedEnvelope);
    }
    for key in ["ownerScope", "ownerEpoch", "requestId", "draftRevision"] {
        let mut bad = value.clone();
        bad["guard"].as_object_mut().unwrap().remove(key);
        assert!(parse(&bad).is_err(), "missing {key}");
    }
    let mut mismatch = value.clone();
    mismatch["guard"]["snapshot"] = json!({"ownerScope":"other-owner","ownerEpoch":1,"snapshotId":"snapshot-1","snapshotRevision":1,"inputDigest":"a".repeat(64),"catalogDigest":"b".repeat(64)});
    assert_eq!(
        parse(&mismatch).unwrap_err(),
        ContractError::IdentityMismatch
    );
    for (field, bad) in [
        ("ownerEpoch", json!(0)),
        ("draftRevision", json!(-1)),
        ("draftRevision", json!(9_007_199_254_740_992_u64)),
    ] {
        let mut bad_envelope = value.clone();
        bad_envelope["guard"][field] = bad;
        assert!(parse(&bad_envelope).is_err());
    }
    for bad in [
        json!({"kind":"CALCULATE"}),
        json!({"kind":"MONTH_RANGE","month":"2026-11","ready":true}),
        json!({"kind":"VALIDATE_INPUT","validator":"UNKNOWN","input":{}}),
    ] {
        let mut value = value.clone();
        value["operation"] = bad;
        assert_eq!(parse(&value).unwrap_err(), ContractError::MalformedEnvelope);
    }
}
#[test]
fn utility_limits_precede_parsing_and_duplicate_keys_never_disappear() {
    assert_eq!(
        parse_utility_request(&vec![b' '; MAX_UTILITY_INPUT_BYTES + 1]).unwrap_err(),
        ContractError::InputTooLarge
    );
    let bytes = serde_json::to_string(&envelope()).unwrap().replace(
        "\"draftRevision\":0",
        "\"draftRevision\":0,\"draftRevision\":1",
    );
    assert!(parse_utility_request(bytes.as_bytes()).is_err());
    let mut value = envelope();
    value["operation"] = json!({"kind":"VALIDATE_INPUT","validator":"USER_PROFILE","input":vec![Value::Null;MAX_UTILITY_NODES as usize]});
    assert!(parse(&value).is_err());
    let mut deep = Value::Null;
    for _ in 0..MAX_UTILITY_DEPTH {
        deep = json!([deep]);
    }
    value["operation"]["input"] = deep;
    assert!(parse(&value).is_err());
    value = envelope();
    value["guard"]["requestId"] = json!("secret@example.com");
    let error = parse(&value).unwrap_err();
    assert!(!serde_json::to_string(&error).unwrap().contains("secret"));
}
