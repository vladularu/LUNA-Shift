#[path = "support/snapshot.rs"]
mod snapshot;
use luna_engine::contract::{
    self, ContractError, SourceKind, ValidatedRequest,
    assembly::{CatalogKind, SnapshotAssembly},
};
use serde_json::{Value, json};

fn begin_header(raw: &Value) -> Vec<u8> {
    let identity = &raw["identity"];
    serde_json::to_vec(&json!({"ownerScope":identity["ownerScope"],"ownerEpoch":identity["ownerEpoch"],"snapshotId":identity["snapshotId"],"snapshotRevision":identity["snapshotRevision"],"referenceDate":raw["referenceDate"],"selectedPackageIds":raw["catalogs"]["current"]["selectedPackageIds"],"completeness":raw["completeness"]})).unwrap()
}
fn packet(kind: Value, source: &Value) -> (Vec<u8>, Vec<u8>) {
    let mut source = source.clone();
    let body = if source["payload"]["data"]["kind"] == "VALUE" {
        let value = source["payload"]["data"]
            .as_object_mut()
            .unwrap()
            .remove("value")
            .unwrap();
        serde_json::to_vec(&value).unwrap()
    } else {
        vec![]
    };
    (
        serde_json::to_vec(&json!({"kind":kind,"source":source})).unwrap(),
        body,
    )
}
fn ready(value: Value) -> Value {
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":value}})
}
fn wire(mut raw: Value) -> contract::ImmutableSnapshot {
    snapshot::seal(&mut raw);
    let bytes=serde_json::to_vec(&json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}})).unwrap();
    match contract::parse_request(&bytes).unwrap() {
        ValidatedRequest::RegisterSnapshot(v) => v,
        _ => panic!("snapshot"),
    }
}
#[test]
fn separate_original_raw_sources_have_exactly_the_existing_snapshot_hash_and_presence() {
    let mut raw = snapshot::raw_snapshot(3, "owner", 2);
    let states = [
        json!({"state":"LOADING"}),
        json!({"state":"FAILED","code":"READ_FAILED"}),
        ready(json!({"kind":"MISSING"})),
        ready(json!({"kind":"NULL"})),
        ready(json!({"kind":"VALUE","value":[]})),
        ready(json!({"kind":"VALUE","value":false})),
        ready(json!({"kind":"VALUE","value":0})),
        ready(
            json!({"kind":"VALUE","value":{"rows":[{"id":"李","note":"ä\\\n\"","amount":1.25}]}}),
        ),
    ];
    for (index, state) in states.into_iter().enumerate() {
        raw["sources"][index]["source"] = state;
    }
    for kind in ["tariff", "legal", "holiday"] {
        raw["catalogs"]["current"][kind] =
            ready(json!({"kind":"VALUE","value":{"mode":"COMPILED_PREVIEW"}}));
    }
    let expected = wire(raw.clone());
    let mut assembly = SnapshotAssembly::begin(&begin_header(&raw)).unwrap();
    assert_eq!(assembly.fence().owner().scope(), "owner");
    assert_eq!(assembly.fence().snapshot_revision(), 3);
    for group in raw["sources"].as_array().unwrap() {
        let (header, body) = packet(group["kind"].clone(), &group["source"]);
        assembly.source(&header, &body).unwrap();
    }
    for (name, kind) in [
        ("tariff", CatalogKind::Tariff),
        ("legal", CatalogKind::Legal),
        ("holiday", CatalogKind::Holiday),
    ] {
        let (header, body) = packet(json!(kind), &raw["catalogs"]["current"][name]);
        assembly.catalog(&header, &body).unwrap();
    }
    let actual = assembly.seal().unwrap();
    assert_eq!(actual.identity(), expected.identity());
    assert_eq!(actual.sources(), expected.sources());
    assert_eq!(actual.current_catalog(), expected.current_catalog());
}
#[test]
fn duplicate_injected_and_inconsistent_inputs_do_not_mutate_accepted_sources() {
    let raw = snapshot::raw_snapshot(1, "owner", 1);
    let mut assembly = SnapshotAssembly::begin(&begin_header(&raw)).unwrap();
    let (header, body) = packet(
        json!(SourceKind::CalendarEntries),
        &ready(json!({"kind":"VALUE","value":[]})),
    );
    assembly.source(&header, &body).unwrap();
    assert_eq!(
        assembly.source(&header, &body),
        Err(ContractError::DuplicateSource)
    );
    let (header, _) = packet(
        json!(SourceKind::PaidAbsences),
        &ready(json!({"kind":"VALUE","value":[]})),
    );
    assert_eq!(
        assembly.source(&header, b"{\"x\":1,\"x\":2}"),
        Err(ContractError::DuplicateJsonKey)
    );
    assert_eq!(
        assembly.source(&header, b"null"),
        Err(ContractError::InvalidPresence)
    );
    let mut injected: Value = serde_json::from_slice(&header).unwrap();
    injected["source"]["payload"]["data"]["value"] = json!({"ready":true});
    assert_eq!(
        assembly.source(&serde_json::to_vec(&injected).unwrap(), b"[]"),
        Err(ContractError::MalformedEnvelope)
    );
    assembly.source(&header, b"[]").unwrap();
    let actual = assembly.seal().unwrap();
    assert!(
        actual
            .sources()
            .iter()
            .filter(|g| matches!(
                g.kind(),
                SourceKind::CalendarEntries | SourceKind::PaidAbsences
            ))
            .all(|g| matches!(g.state(), contract::SourceState::Ready { .. }))
    );
}
#[test]
fn value_depth_counts_the_real_register_envelope_and_node_budget_is_shared() {
    let raw = snapshot::raw_snapshot(1, "owner", 1);
    let (header, _) = packet(
        json!(SourceKind::CalendarEntries),
        &ready(json!({"kind":"VALUE","value":[]})),
    );
    let mut depth = SnapshotAssembly::begin(&begin_header(&raw)).unwrap();
    let body = format!("{}0{}", "[".repeat(41), "]".repeat(41));
    assert_eq!(
        depth.source(&header, body.as_bytes()),
        Err(ContractError::JsonTooDeep)
    );
    let body = format!("{}0{}", "[".repeat(40), "]".repeat(40));
    depth.source(&header, body.as_bytes()).unwrap();
    let mut budget = SnapshotAssembly::begin(&begin_header(&raw)).unwrap();
    let body = format!("[{}]", vec!["0"; 100_000].join(","));
    for (index, kind) in contract::ALL_SOURCE_KINDS.iter().take(20).enumerate() {
        let (header, _) = packet(json!(kind), &ready(json!({"kind":"VALUE","value":[]})));
        let result = budget.source(&header, body.as_bytes());
        if index == 19 {
            assert_eq!(result, Err(ContractError::TooManyJsonNodes));
        } else {
            result.unwrap();
        }
    }
}
#[test]
fn nonvalue_read_states_reject_body_data_and_unsupported_schemas_stay_errors() {
    let raw = snapshot::raw_snapshot(1, "owner", 1);
    for state in [
        json!({"state":"LOADING"}),
        ready(json!({"kind":"NULL"})),
        ready(json!({"kind":"MISSING"})),
    ] {
        let (header, _) = packet(json!(SourceKind::WorkProfile), &state);
        let mut assembly = SnapshotAssembly::begin(&begin_header(&raw)).unwrap();
        assert_eq!(
            assembly.source(&header, b"[]"),
            Err(ContractError::InvalidPresence)
        );
        assembly.source(&header, b"").unwrap();
    }
    let mut state = ready(json!({"kind":"VALUE","value":[]}));
    state["payload"]["schemaVersion"] = json!(2);
    let (header, body) = packet(json!(SourceKind::WorkProfile), &state);
    let mut assembly = SnapshotAssembly::begin(&begin_header(&raw)).unwrap();
    assert_eq!(
        assembly.source(&header, &body),
        Err(ContractError::UnsupportedSourceSchema)
    );
}
