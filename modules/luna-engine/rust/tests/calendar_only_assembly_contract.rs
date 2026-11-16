use luna_engine::contract::{
    self, ContractError, SourceKind, SourceState,
    assembly::calendar_only::{CalendarInput, CalendarOnlyAssembly},
};
use serde_json::{Value, json};
fn bytes(v: Value) -> Vec<u8> {
    serde_json::to_vec(&v).unwrap()
}
fn begin(clock: bool) -> Vec<u8> {
    bytes(
        json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"ownerScope":"calendar-owner","ownerEpoch":1,"sourceRevision":7,"intent":if clock{json!({"kind":"CLOCK","observedEpochMilliseconds":1794480000000_i64})}else{json!({"kind":"ROWS"})}}),
    )
}
fn packet(kind: SourceKind, state: &Value) -> (Vec<u8>, Vec<u8>) {
    let mut state = state.clone();
    let body = if state["payload"]["data"]["kind"] == "VALUE" {
        serde_json::to_vec(
            &state["payload"]["data"]
                .as_object_mut()
                .unwrap()
                .remove("value")
                .unwrap(),
        )
        .unwrap()
    } else {
        vec![]
    };
    (bytes(json!({"kind":kind,"source":state})), body)
}
fn ready(data: Value) -> Value {
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":data}})
}
#[test]
fn original_raw_source_presence_and_number_values_survive_without_financial_inputs() {
    let states = [
        json!({"state":"NOT_REQUESTED"}),
        json!({"state":"LOADING"}),
        json!({"state":"FAILED","code":"READ_FAILED"}),
        ready(json!({"kind":"MISSING"})),
        ready(json!({"kind":"NULL"})),
        ready(json!({"kind":"VALUE","value":[]})),
        ready(
            json!({"kind":"VALUE","value":{"metadata":{"null":null,"empty":[],"zero":0,"fraction":1e-15,"unicode":"李ä"}}}),
        ),
    ];
    for state in &states {
        let mut a = CalendarOnlyAssembly::begin(&begin(false)).unwrap();
        assert_eq!(a.owner().scope(), "calendar-owner");
        assert_eq!(a.source_revision(), 7);
        let (h, b) = packet(SourceKind::CalendarEntries, state);
        a.source(&h, &b).unwrap();
        let CalendarInput::Rows {
            owner,
            source_revision,
            calendar,
        } = a.seal().unwrap()
        else {
            panic!("ROWS")
        };
        assert_eq!(owner.epoch(), 1);
        assert_eq!(source_revision, 7);
        assert_eq!(serde_json::to_value(calendar).unwrap(), *state);
    }
    let mut a = CalendarOnlyAssembly::begin(&begin(true)).unwrap();
    for (kind, state) in [
        (SourceKind::WorkProfile, ready(json!({"kind":"NULL"}))),
        (
            SourceKind::RemunerationProfiles,
            json!({"state":"FAILED","code":"READ_FAILED"}),
        ),
    ] {
        let (h, b) = packet(kind, &state);
        a.source(&h, &b).unwrap();
    }
    let CalendarInput::Clock {
        profile,
        history,
        observed_epoch_milliseconds,
        ..
    } = a.seal().unwrap()
    else {
        panic!("CLOCK")
    };
    assert_eq!(observed_epoch_milliseconds, 1794480000000);
    assert!(matches!(profile, SourceState::Ready { .. }));
    assert!(matches!(history, SourceState::Failed { .. }));
}
#[test]
fn purpose_version_owner_presence_and_shared_raw_limits_are_closed_before_admission() {
    assert!(CalendarOnlyAssembly::begin(&vec![b' '; 8193]).is_err());
    for (key, bad) in [
        ("wireSchemaVersion", json!(2)),
        ("expectedEngineVersion", json!("old")),
        ("ownerScope", json!("")),
        ("ownerEpoch", json!(0)),
        ("sourceRevision", json!(9007199254740992_u64)),
        ("readyProfile", json!({})),
    ] {
        let mut value: Value = serde_json::from_slice(&begin(false)).unwrap();
        value[key] = bad;
        assert!(CalendarOnlyAssembly::begin(&bytes(value)).is_err(), "{key}");
    }
    assert!(
        CalendarOnlyAssembly::begin(&begin(false))
            .unwrap()
            .seal()
            .is_err()
    );
    let mut a = CalendarOnlyAssembly::begin(&begin(false)).unwrap();
    let (h, b) = packet(
        SourceKind::WorkProfile,
        &ready(json!({"kind":"VALUE","value":{}})),
    );
    assert!(a.source(&h, &b).is_err());
    let (h, b) = packet(
        SourceKind::CalendarEntries,
        &ready(json!({"kind":"VALUE","value":[]})),
    );
    assert!(a.source(&h, b"{\"duplicate\":0,\"duplicate\":1}").is_err());
    assert!(a.source(&h, b"[] true").is_err());
    assert!(
        a.source(&h, &vec![b' '; contract::MAX_INPUT_BYTES as usize + 1])
            .is_err()
    );
    a.source(&h, &b).unwrap();
    assert!(a.source(&h, &b).is_err());
    assert!(a.seal().is_ok());
    let mut a = CalendarOnlyAssembly::begin(&begin(true)).unwrap();
    let (h, b) = packet(SourceKind::WorkProfile, &ready(json!({"kind":"NULL"})));
    assert!(a.source(&h, b"null").is_err());
    a.source(&h, &b).unwrap();
    assert!(a.seal().is_err());
    let mut a = CalendarOnlyAssembly::begin(&begin(false)).unwrap();
    let (h, _) = packet(
        SourceKind::CalendarEntries,
        &ready(json!({"kind":"VALUE","value":[]})),
    );
    let deep = format!("{}0{}", "[".repeat(50), "]".repeat(50));
    assert_eq!(
        a.source(&h, deep.as_bytes()).err(),
        Some(ContractError::JsonTooDeep)
    );
}
