use luna_engine::contract::{
    ALL_SOURCE_KINDS, CONTRACT_VERSION, ContractError, DataPresence, MAX_ID_BYTES, MAX_INPUT_BYTES,
    MAX_JSON_DEPTH, MAX_SAFE_REVISION, MAX_SOURCE_ITEMS, SCHEMA_VERSION, ValidatedRequest,
    parse_request, prepare_calculation, snapshot_digests_json,
};
use serde_json::{Value, json};

fn identity() -> Value {
    json!({
        "ownerScope":"local-owner-a", "ownerEpoch":1,
        "snapshotId":"snapshot-a", "snapshotRevision":2,
        "inputDigest":"a".repeat(64), "catalogDigest":"b".repeat(64)
    })
}

fn metadata(command: Value) -> Value {
    json!({
        "wireSchemaVersion":SCHEMA_VERSION,
        "expectedEngineVersion":luna_engine::ENGINE_VERSION,
        "calculationContractVersion":CONTRACT_VERSION,
        "command":command
    })
}

fn empty_catalog() -> Value {
    json!({
        "selectedPackageIds":{"tariff":[], "legal":[], "holiday":[]},
        "tariff":{"state":"NOT_REQUESTED"},
        "legal":{"state":"NOT_REQUESTED"},
        "holiday":{"state":"NOT_REQUESTED"}
    })
}

fn snapshot() -> Value {
    let sources: Vec<Value> = ALL_SOURCE_KINDS
        .iter()
        .map(|kind| json!({"kind":kind,"source":{"state":"NOT_REQUESTED"}}))
        .collect();
    let mut snapshot = json!({
        "identity":identity(),
        "referenceDate":"2026-11-12",
        "sources":sources,
        "catalogs":{"current":empty_catalog(),"history":[]},
        "completeness":{
            "entries":{"kind":"MISSING"},
            "history":{"kind":"MISSING"},
            "annexAEntries":{"kind":"MISSING"},
            "annexAPauseDetails":{"kind":"MISSING"}
        }
    });
    seal(&mut snapshot);
    snapshot
}

fn seal(snapshot: &mut Value) {
    let digests = snapshot_digests_json(&serde_json::to_vec(snapshot).unwrap()).unwrap();
    snapshot["identity"]["inputDigest"] = json!(digests.input_digest);
    snapshot["identity"]["catalogDigest"] = json!(digests.catalog_digest);
}

fn registration() -> Value {
    metadata(json!({"kind":"REGISTER_SNAPSHOT","snapshot":snapshot()}))
}

fn calculation() -> Value {
    metadata(json!({
        "kind":"CALCULATE",
        "request":{
            "guard":{"snapshot":snapshot()["identity"],"requestId":"request-a","requestRevision":0},
            "periods":[{"kind":"YEAR","year":2026}],
            "sections":{"time":false,"gross":true,"net":false,"checks":false},
            "perspective":"EARNED",
            "priority":"INTERACTIVE"
        }
    }))
}

fn parse(value: &Value) -> Result<ValidatedRequest, ContractError> {
    parse_request(&serde_json::to_vec(value).unwrap())
}

#[test]
fn valid_snapshot_has_one_explicit_state_for_every_source() {
    let parsed = parse(&registration()).unwrap();
    let snapshot = parsed.snapshot().unwrap();
    assert_eq!(snapshot.sources().len(), ALL_SOURCE_KINDS.len());
    let cloned = snapshot.clone();
    assert!(snapshot.shares_storage_with(&cloned));
}

#[test]
fn unsupported_versions_and_unknown_flags_are_rejected() {
    let mut request = registration();
    request["wireSchemaVersion"] = json!(2);
    assert_eq!(
        parse(&request).unwrap_err(),
        ContractError::UnsupportedSchema
    );
    request = registration();
    request["expectedEngineVersion"] = json!("unrecognized");
    assert_eq!(
        parse(&request).unwrap_err(),
        ContractError::UnsupportedEngine
    );
    request = registration();
    request["calculationContractVersion"] = json!("unrecognized");
    assert_eq!(
        parse(&request).unwrap_err(),
        ContractError::UnsupportedContract
    );
    request = calculation();
    request["command"]["request"]["sections"]["unsafeFast"] = json!(true);
    assert_eq!(
        parse(&request).unwrap_err(),
        ContractError::MalformedEnvelope
    );
    request = calculation();
    request["command"]["request"]["priority"] = json!("IGNORE_GUARDS");
    assert_eq!(
        parse(&request).unwrap_err(),
        ContractError::MalformedEnvelope
    );
}

#[test]
fn malformed_and_duplicate_keys_do_not_silently_normalize() {
    assert_eq!(
        parse_request(b"{invalid").unwrap_err(),
        ContractError::InvalidJson
    );
    assert_eq!(
        parse_request(b"{\"a\":1,\"a\":2}").unwrap_err(),
        ContractError::DuplicateJsonKey
    );
    let mut request = registration();
    request["command"]["snapshot"]["sources"][0]["source"] = json!({
        "state":"READY", "revision":0, "coverage":{"kind":"ALL_HISTORY"},
        "payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":{"secret":"ok"}}}
    });
    let text = serde_json::to_string(&request).unwrap().replace(
        "\"secret\":\"ok\"",
        "\"secret\":\"ok\",\"secret\":\"other\"",
    );
    assert_eq!(
        parse_request(text.as_bytes()).unwrap_err(),
        ContractError::DuplicateJsonKey
    );
}

#[test]
fn missing_null_empty_and_explicit_zero_round_trip_distinctly() {
    let values = [
        json!({"kind":"MISSING"}),
        json!({"kind":"NULL"}),
        json!({"kind":"VALUE","value":[]}),
        json!({"kind":"VALUE","value":0}),
    ];
    for value in values {
        let presence: DataPresence<Value> = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(presence).unwrap(), value);
    }
    let mut request = registration();
    request["command"]["snapshot"]["completeness"]["entries"] =
        json!({"kind":"VALUE","value":false});
    seal(&mut request["command"]["snapshot"]);
    assert!(parse(&request).is_ok());
    request["command"]["snapshot"]["completeness"]["entries"] = Value::Null;
    assert!(parse(&request).is_err());
    request["command"]["snapshot"]["completeness"]
        .as_object_mut()
        .unwrap()
        .remove("entries");
    assert!(parse(&request).is_err());
}

#[test]
fn required_source_registry_is_closed_and_complete() {
    let mut request = registration();
    request["command"]["snapshot"]["sources"]
        .as_array_mut()
        .unwrap()
        .pop();
    assert_eq!(parse(&request).unwrap_err(), ContractError::MissingSource);
    request = registration();
    let duplicate = request["command"]["snapshot"]["sources"][0].clone();
    request["command"]["snapshot"]["sources"][1] = duplicate;
    assert_eq!(parse(&request).unwrap_err(), ContractError::DuplicateSource);
    request = registration();
    request["command"]["snapshot"]["sources"][0]["kind"] = json!("UNREVIEWED_SOURCE");
    assert_eq!(
        parse(&request).unwrap_err(),
        ContractError::MalformedEnvelope
    );
}

#[test]
fn identities_are_opaque_bounded_and_losslessly_safe_in_javascript() {
    let mut request = registration();
    request["command"]["snapshot"]["identity"]["ownerScope"] = json!("private@example.com");
    let error = parse(&request).unwrap_err();
    assert_eq!(error, ContractError::InvalidIdentifier);
    assert!(!error.to_string().contains("private"));
    request = registration();
    request["command"]["snapshot"]["identity"]["snapshotId"] =
        json!("a".repeat(MAX_ID_BYTES as usize + 1));
    assert_eq!(
        parse(&request).unwrap_err(),
        ContractError::InvalidIdentifier
    );
    request = registration();
    request["command"]["snapshot"]["identity"]["snapshotRevision"] = json!(MAX_SAFE_REVISION + 1);
    assert_eq!(parse(&request).unwrap_err(), ContractError::InvalidRevision);
    request = registration();
    request["command"]["snapshot"]["identity"]["inputDigest"] = json!("B".repeat(64));
    assert_eq!(parse(&request).unwrap_err(), ContractError::InvalidDigest);
}

#[test]
fn byte_depth_and_collection_budgets_are_enforced() {
    assert_eq!(
        parse_request(&vec![b' '; MAX_INPUT_BYTES as usize + 1]).unwrap_err(),
        ContractError::InputTooLarge
    );
    let nested = format!(
        "{}0{}",
        "[".repeat(MAX_JSON_DEPTH as usize + 1),
        "]".repeat(MAX_JSON_DEPTH as usize + 1)
    );
    assert_eq!(
        parse_request(nested.as_bytes()).unwrap_err(),
        ContractError::JsonTooDeep
    );
    let mut request = registration();
    request["command"]["snapshot"]["sources"][0]["source"] = json!({
        "state":"READY", "revision":0, "coverage":{"kind":"ALL_HISTORY"},
        "payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":vec![0; MAX_SOURCE_ITEMS as usize + 1]}}
    });
    assert_eq!(
        parse(&request).unwrap_err(),
        ContractError::CollectionTooLarge
    );
}

#[test]
fn invalid_dates_partial_coverage_and_payload_aliases_are_rejected() {
    let mut request = registration();
    request["command"]["snapshot"]["referenceDate"] = json!("2026-02-30");
    assert_eq!(parse(&request).unwrap_err(), ContractError::InvalidDate);
    request = registration();
    request["command"]["snapshot"]["sources"][0]["source"] = json!({
        "state":"READY", "revision":0,
        "coverage":{"kind":"DATE_RANGES","ranges":[{"start":"2026-12-31","end":"2026-01-01"}]},
        "payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":[]}}
    });
    assert_eq!(parse(&request).unwrap_err(), ContractError::InvalidCoverage);
    request["command"]["snapshot"]["sources"][0]["source"]["coverage"] =
        json!({"kind":"ALL_HISTORY"});
    request["command"]["snapshot"]["sources"][0]["source"]["payload"]["data"] =
        json!({"kind":"VALUE","value":null});
    assert_eq!(parse(&request).unwrap_err(), ContractError::InvalidPresence);
}

#[test]
fn financial_request_is_independent_of_unrequested_checks_and_never_fakes_ready() {
    let snapshot_request = parse(&registration()).unwrap();
    let snapshot = snapshot_request.snapshot().unwrap();
    let calculate_request = parse(&calculation()).unwrap();
    let request = calculate_request.calculation().unwrap();
    let reply = prepare_calculation(snapshot, request).unwrap();
    let json = serde_json::to_value(&reply).unwrap();
    assert_eq!(
        json["result"]["sections"]["gross"]["state"],
        "NOT_IMPLEMENTED"
    );
    assert_eq!(
        json["result"]["sections"]["checks"]["state"],
        "NOT_REQUESTED"
    );
    assert!(!serde_json::to_string(&reply).unwrap().contains("READY"));
    assert!(reply.matches_request(request));
}

#[test]
fn changed_owner_epoch_revision_request_or_digest_cannot_accept_stale_result() {
    let registered = parse(&registration()).unwrap();
    let snapshot = registered.snapshot().unwrap();
    let original = parse(&calculation()).unwrap();
    let original = original.calculation().unwrap();
    let reply = prepare_calculation(snapshot, original).unwrap();
    for field in [
        "ownerScope",
        "ownerEpoch",
        "snapshotId",
        "snapshotRevision",
        "inputDigest",
        "catalogDigest",
    ] {
        let mut changed = calculation();
        let replacement = match field {
            "ownerEpoch" | "snapshotRevision" => json!(9),
            "inputDigest" | "catalogDigest" => json!("c".repeat(64)),
            _ => json!("changed"),
        };
        changed["command"]["request"]["guard"]["snapshot"][field] = replacement;
        let parsed = parse(&changed).unwrap();
        let request = parsed.calculation().unwrap();
        assert_eq!(
            prepare_calculation(snapshot, request).unwrap_err(),
            ContractError::IdentityMismatch
        );
        assert!(!reply.matches_request(request));
    }
    for field in ["requestId", "requestRevision"] {
        let mut changed = calculation();
        changed["command"]["request"]["guard"][field] = if field == "requestId" {
            json!("request-b")
        } else {
            json!(1)
        };
        let parsed = parse(&changed).unwrap();
        assert!(!reply.matches_request(parsed.calculation().unwrap()));
    }
}

#[test]
fn historical_catalog_compatibility_is_explicit_and_fixed() {
    let mut request = registration();
    request["command"]["snapshot"]["catalogs"]["history"] = json!([{
        "catalog":empty_catalog(),
        "compatiblePackageIds":{"tariff":[],"legal":[],"holiday":[]},
        "validBefore":{"tariff":{"kind":"VALUE","value":"2026-01-01"},"legal":{"kind":"NULL"},"holiday":{"kind":"MISSING"}}
    }]);
    seal(&mut request["command"]["snapshot"]);
    assert!(parse(&request).is_ok());
    request["command"]["snapshot"]["catalogs"]["history"][0]
        .as_object_mut()
        .unwrap()
        .remove("validBefore");
    assert!(parse(&request).is_err());
}

#[test]
fn digests_bind_contents_and_owner_but_not_json_object_key_order() {
    let mut request = registration();
    request["command"]["snapshot"]["referenceDate"] = json!("2026-11-13");
    assert_eq!(parse(&request).unwrap_err(), ContractError::DigestMismatch);
    seal(&mut request["command"]["snapshot"]);
    assert!(parse(&request).is_ok());
    request["command"]["snapshot"]["identity"]["ownerScope"] = json!("owner-b");
    assert_eq!(parse(&request).unwrap_err(), ContractError::DigestMismatch);
    let snapshot = snapshot();
    let compact = serde_json::to_vec(&snapshot).unwrap();
    let pretty = serde_json::to_vec_pretty(&snapshot).unwrap();
    assert_eq!(
        snapshot_digests_json(&compact).unwrap(),
        snapshot_digests_json(&pretty).unwrap()
    );
}

#[test]
fn payload_missing_null_empty_and_array_order_have_different_hashes() {
    let mut hashes = std::collections::BTreeSet::new();
    for data in [
        json!({"kind":"MISSING"}),
        json!({"kind":"NULL"}),
        json!({"kind":"VALUE","value":[]}),
        json!({"kind":"VALUE","value":0}),
        json!({"kind":"VALUE","value":[1,2]}),
        json!({"kind":"VALUE","value":[2,1]}),
        json!({"kind":"VALUE","value":{"missing":null}}),
        json!({"kind":"VALUE","value":{}}),
    ] {
        let mut snapshot = snapshot();
        snapshot["sources"][0]["source"] = json!({
            "state":"READY", "revision":0, "coverage":{"kind":"ALL_HISTORY"},
            "payload":{"schemaVersion":1,"data":data}
        });
        let digest = snapshot_digests_json(&serde_json::to_vec(&snapshot).unwrap()).unwrap();
        assert!(hashes.insert(digest.input_digest));
    }
}

#[test]
fn legitimate_fifty_thousand_target_facts_fit_foundation_limits() {
    let mut snapshot = snapshot();
    snapshot["sources"][0]["source"] = json!({
        "state":"READY", "revision":0, "coverage":{"kind":"ALL_HISTORY"},
        "payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":vec![json!({
            "date":"2026-11-12","rosterStatus":"FINAL","disposition":"WORK_REQUIRED","lostMinutes":480
        });50_000]}}
    });
    seal(&mut snapshot);
    assert!(
        parse(&metadata(
            json!({"kind":"REGISTER_SNAPSHOT","snapshot":snapshot})
        ))
        .is_ok()
    );
}

#[test]
fn source_maximum_utf16_roster_bindings_fit_the_bounded_transport() {
    let mut raw = snapshot();
    let signature = "€".repeat(100_000);
    assert_eq!(signature.encode_utf16().count(), 100_000);
    assert_eq!(signature.len(), 300_000);
    raw["sources"][0]["source"] = json!({
        "state":"READY", "revision":0, "coverage":{"kind":"ALL_HISTORY"},
        "payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":{"signature":signature}}}
    });
    seal(&mut raw);
    assert!(
        parse(&metadata(
            json!({"kind":"REGISTER_SNAPSHOT","snapshot":raw})
        ))
        .is_ok()
    );
    raw["sources"][0]["source"]["payload"]["data"]["value"]["signature"] =
        json!("€".repeat(100_001));
    assert_eq!(
        snapshot_digests_json(&serde_json::to_vec(&raw).unwrap()).unwrap_err(),
        ContractError::StringTooLarge
    );
}
