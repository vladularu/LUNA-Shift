mod common;
#[path = "support/snapshot.rs"]
mod snapshot_fixture;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    contract::{
        self, ContractError, ImmutableSnapshot, OwnerIdentity, SourceKind, ValidatedRequest,
    },
    runtime::{
        RegistryError, SnapshotRegistry,
        assembly::{AssemblyError, BuilderId, SnapshotAssemblyPool, SourceTarget},
        facts::SnapshotFacts,
    },
};
use serde_json::{Value, json};
fn data() -> Value {
    value_pool::decode(include_str!("../../reference/profile-clock-golden.json"))
}
fn begin(pool: &SnapshotAssemblyPool, reference: Option<&str>) -> BuilderId {
    let mut header = json!({"ownerScope":"clock-owner","ownerEpoch":1,"snapshotId":"clock-snapshot","snapshotRevision":1,"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}});
    if let Some(date) = reference {
        header["referenceDate"] = json!(date);
    }
    pool.begin(&serde_json::to_vec(&header).unwrap()).unwrap()
}
fn source(pool: &SnapshotAssemblyPool, id: BuilderId, kind: SourceKind, value: Option<&Value>) {
    source_revision(pool, id, kind, value, 1);
}
fn source_revision(
    pool: &SnapshotAssemblyPool,
    id: BuilderId,
    kind: SourceKind,
    value: Option<&Value>,
    revision: u64,
) {
    let header = json!({"kind":kind,"source":{"state":"READY","revision":revision,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":if value.is_some(){"VALUE"}else{"NULL"}}}}});
    let body = value
        .map(|v| serde_json::to_vec(v).unwrap())
        .unwrap_or_default();
    pool.source(
        id,
        SourceTarget::Source,
        &serde_json::to_vec(&header).unwrap(),
        &body,
    )
    .unwrap();
}
#[test]
fn semantic_clock_key_ignores_ephemeral_snapshot_and_source_revisions() {
    let b = data();
    let case = case_by_id(&b, "zone-0-instant-3-history-1");
    let (_, pool) = setup();
    let id = begin(&pool, None);
    populate(&pool, id, &case["input"]);
    let first = pool.profile_clock(id, instant(&case)).unwrap();
    let (_, other) = setup();
    let id = begin(&other, None);
    for (kind, value) in [
        (SourceKind::WorkProfile, &case["input"]["profile"]),
        (
            SourceKind::RemunerationProfiles,
            &case["input"]["historyRows"],
        ),
        (
            SourceKind::WorkPatternSettings,
            &case["input"]["patternRows"],
        ),
    ] {
        source_revision(&other, id, kind, Some(value), 2);
    }
    let second = other.profile_clock(id, instant(&case)).unwrap();
    assert_eq!(first["clock"], second["clock"]);
    assert_eq!(first["profiles"], second["profiles"]);
    assert_eq!(first["sourceClockKey"], second["sourceClockKey"]);
}
fn setup() -> (SnapshotRegistry, SnapshotAssemblyPool) {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("clock-owner", 1).unwrap())
        .unwrap();
    let pool = SnapshotAssemblyPool::new(registry.clone());
    (registry, pool)
}
fn populate(pool: &SnapshotAssemblyPool, id: BuilderId, i: &Value) {
    source(
        pool,
        id,
        SourceKind::WorkProfile,
        (!i["profile"].is_null()).then_some(&i["profile"]),
    );
    source(
        pool,
        id,
        SourceKind::RemunerationProfiles,
        Some(&i["historyRows"]),
    );
    source(
        pool,
        id,
        SourceKind::WorkPatternSettings,
        Some(&i["patternRows"]),
    );
}
fn case_by_id(b: &Value, id: &str) -> Value {
    b["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap()
        .clone()
}
fn state(pool: &SnapshotAssemblyPool, id: BuilderId, kind: SourceKind, state: Value) {
    pool.source(
        id,
        SourceTarget::Source,
        &serde_json::to_vec(&json!({"kind":kind,"source":state})).unwrap(),
        b"",
    )
    .unwrap();
}
fn ready_data(data: Value) -> Value {
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":data}})
}
fn instant(case: &Value) -> i64 {
    case["input"]["observedEpochMilliseconds"].as_i64().unwrap()
}
fn combined(frame: &Value) -> Value {
    let mut actual = frame["clock"].clone();
    for (key, value) in frame["profiles"]["value"].as_object().unwrap() {
        actual[key] = value.clone();
    }
    actual
}
fn set_raw(raw: &mut Value, kind: SourceKind, state: Value) {
    let kind = serde_json::to_value(kind).unwrap();
    raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|s| s["kind"] == kind)
        .unwrap()["source"] = state;
}
fn raw(case: &Value) -> Value {
    let mut v = snapshot_fixture::raw_snapshot(1, "clock-owner", 1);
    let i = &case["input"];
    for (kind, data) in [
        (
            SourceKind::WorkProfile,
            if i["profile"].is_null() {
                json!({"kind":"NULL"})
            } else {
                json!({"kind":"VALUE","value":i["profile"]})
            },
        ),
        (
            SourceKind::RemunerationProfiles,
            json!({"kind":"VALUE","value":i["historyRows"]}),
        ),
        (
            SourceKind::WorkPatternSettings,
            json!({"kind":"VALUE","value":i["patternRows"]}),
        ),
    ] {
        set_raw(&mut v, kind, ready_data(data));
    }
    v["clockContext"] = json!({"observedEpochMilliseconds":instant(case)});
    v["referenceDate"] = case["expected"]["value"]["referenceDate"].clone();
    v
}
fn parse(mut raw: Value) -> Result<ImmutableSnapshot, ContractError> {
    snapshot_fixture::seal(&mut raw);
    let request = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}});
    match contract::parse_request(&serde_json::to_vec(&request).unwrap())? {
        ValidatedRequest::RegisterSnapshot(snapshot) => Ok(snapshot),
        _ => panic!("register expected"),
    }
}
#[test]
fn raw_builder_clock_recreates_original_profile_metadata_and_sets_native_reference() {
    let b = data();
    let case = b["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "zone-0-instant-3-history-1")
        .unwrap();
    let (_, pool) = setup();
    let id = begin(&pool, Some("2026-11-13"));
    populate(&pool, id, &case["input"]);
    let frame = pool
        .profile_clock(
            id,
            case["input"]["observedEpochMilliseconds"].as_i64().unwrap(),
        )
        .unwrap();
    assert_eq!(frame["state"], "PROFILE_CLOCK_READY");
    let mut actual = frame["clock"].clone();
    assert_eq!(frame["profiles"]["state"], "READY");
    for (key, value) in frame["profiles"]["value"].as_object().unwrap() {
        actual[key] = value.clone();
    }
    common::assert_json_eq(
        &actual,
        &case["expected"]["value"],
        "original-pool-profile-clock",
    );
    assert_eq!(frame["sourceClockKey"].as_str().unwrap().len(), 64);
    let snapshot = pool.seal(id).unwrap();
    assert_eq!(
        snapshot.reference_date(),
        case["expected"]["value"]["referenceDate"].as_str().unwrap()
    );
    assert_eq!(
        snapshot
            .clock_context()
            .unwrap()
            .observed_epoch_milliseconds(),
        case["input"]["observedEpochMilliseconds"].as_i64().unwrap()
    );
}
#[test]
fn all_original_profile_clock_cases_pass_through_the_actual_raw_pool_boundary() {
    let b = data();
    let mut ready = 0;
    let mut unavailable = 0;
    for case in b["cases"].as_array().unwrap() {
        let (_, pool) = setup();
        let id = begin(&pool, None);
        populate(&pool, id, &case["input"]);
        let frame = pool.profile_clock(id, instant(case)).unwrap();
        if case["expected"]["value"].is_object() {
            assert_eq!(frame["state"], "PROFILE_CLOCK_READY", "{}", case["id"]);
            assert_eq!(frame["profiles"]["state"], "READY", "{}", case["id"]);
            common::assert_json_eq(
                &combined(&frame),
                &case["expected"]["value"],
                case["id"].as_str().unwrap(),
            );
            assert_eq!(frame["engineVersion"], luna_engine::ENGINE_VERSION);
            assert_eq!(frame["ownerScope"], "clock-owner");
            assert!(serde_json::to_vec(&frame).unwrap().len() < 4096);
            ready += 1;
        } else {
            assert_eq!(
                frame["state"], "PROFILE_CLOCK_UNAVAILABLE",
                "{}",
                case["id"]
            );
            assert!(frame.get("clock").is_none() && frame.get("profiles").is_none());
            unavailable += 1;
        }
        assert!(pool.abort(id).unwrap());
        assert_eq!(pool.collect_retired().unwrap(), 1);
    }
    assert_eq!((ready, unavailable), (239, 14));
}
#[test]
fn unavailable_sources_remain_typed_and_never_turn_into_onboarding_defaults() {
    let b = data();
    let case = case_by_id(&b, "zone-0-instant-3-history-1");
    let variants = [
        (json!({"state":"NOT_REQUESTED"}), "SOURCE_NOT_REQUESTED"),
        (json!({"state":"LOADING"}), "SOURCE_LOADING"),
        (
            json!({"state":"FAILED","code":"READ_FAILED"}),
            "SOURCE_READ_FAILED",
        ),
        (ready_data(json!({"kind":"MISSING"})), "SOURCE_MISSING"),
        (
            json!({"state":"READY","revision":1,"coverage":{"kind":"DATE_RANGES","ranges":[{"start":"2026-01-01","end":"2026-12-31"}]},"payload":{"schemaVersion":1,"data":{"kind":"NULL"}}}),
            "SOURCE_INCOMPLETE",
        ),
    ];
    for kind in [SourceKind::WorkProfile, SourceKind::RemunerationProfiles] {
        for (bad, code) in &variants {
            let (_, pool) = setup();
            let id = begin(&pool, None);
            if kind == SourceKind::RemunerationProfiles {
                source(
                    &pool,
                    id,
                    SourceKind::WorkProfile,
                    Some(&case["input"]["profile"]),
                );
            }
            state(&pool, id, kind, bad.clone());
            let frame = pool.profile_clock(id, instant(&case)).unwrap();
            assert_eq!(frame["state"], "PROFILE_CLOCK_UNAVAILABLE");
            assert_eq!(frame["reason"]["code"], *code);
            assert_eq!(
                frame["reason"]["source"],
                serde_json::to_value(kind).unwrap()
            );
        }
    }
    let (_, pool) = setup();
    let id = begin(&pool, None);
    source(
        &pool,
        id,
        SourceKind::WorkProfile,
        Some(&case["input"]["profile"]),
    );
    source(&pool, id, SourceKind::RemunerationProfiles, None);
    let frame = pool.profile_clock(id, instant(&case)).unwrap();
    assert_eq!(frame["reason"]["code"], "SOURCE_NULL");
    let onboarding = b["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["input"]["profile"].is_null() && c["expected"]["value"].is_object())
        .unwrap();
    let (_, pool) = setup();
    let id = begin(&pool, None);
    source(&pool, id, SourceKind::WorkProfile, None);
    state(
        &pool,
        id,
        SourceKind::RemunerationProfiles,
        json!({"state":"FAILED","code":"READ_FAILED"}),
    );
    state(
        &pool,
        id,
        SourceKind::WorkPatternSettings,
        json!({"state":"FAILED","code":"READ_FAILED"}),
    );
    let frame = pool.profile_clock(id, instant(onboarding)).unwrap();
    assert_eq!(frame["state"], "PROFILE_CLOCK_READY");
    assert_eq!(frame["clock"]["onboarding"], true);
    common::assert_json_eq(
        &combined(&frame),
        &onboarding["expected"]["value"],
        "onboarding-with-unconsumed-io-failures",
    );
}
#[test]
fn clock_readiness_is_independent_of_unconsumed_pattern_target_and_catalog_io() {
    let b = data();
    let case = case_by_id(&b, "zone-0-instant-3-history-0");
    let (_, pool) = setup();
    let id = begin(&pool, None);
    source(
        &pool,
        id,
        SourceKind::WorkProfile,
        Some(&case["input"]["profile"]),
    );
    source(
        &pool,
        id,
        SourceKind::RemunerationProfiles,
        Some(&case["input"]["historyRows"]),
    );
    let first = pool.profile_clock(id, instant(&case)).unwrap();
    assert_eq!(first["state"], "PROFILE_CLOCK_READY");
    assert_eq!(first["profiles"]["state"], "UNAVAILABLE");
    assert_eq!(
        first["profiles"]["reason"]["source"],
        "WORK_PATTERN_SETTINGS"
    );
    source(
        &pool,
        id,
        SourceKind::WorkPatternSettings,
        Some(&case["input"]["patternRows"]),
    );
    let second = pool.profile_clock(id, instant(&case)).unwrap();
    assert_eq!(second["profiles"]["state"], "READY");
    assert_eq!(first["clock"], second["clock"]);
    assert_eq!(first["sourceClockKey"], second["sourceClockKey"]);
    common::assert_json_eq(
        &combined(&second),
        &case["expected"]["value"],
        "pattern-recovery-without-reclock",
    );
    assert!(pool.profile_clock(id, instant(&case) + 1).is_err());
}
#[test]
fn semantic_clock_keys_survive_restarts_and_fresh_instants_only_inside_native_expiry() {
    let b = data();
    let mut count = 0;
    for case in b["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["expected"]["value"].is_object())
    {
        let (_, pool) = setup();
        let id = begin(&pool, None);
        populate(&pool, id, &case["input"]);
        let first = pool.profile_clock(id, instant(case)).unwrap();
        let until = first["clock"]["validUntilEpochMilliseconds"]
            .as_i64()
            .unwrap();
        let (_, other) = setup();
        let id = begin(&other, None);
        populate(&other, id, &case["input"]);
        let last = other.profile_clock(id, until - 1).unwrap();
        assert_eq!(
            first["sourceClockKey"], last["sourceClockKey"],
            "{}",
            case["id"]
        );
        assert_eq!(first["profiles"], last["profiles"], "{}", case["id"]);
        let (_, boundary) = setup();
        let id = begin(&boundary, None);
        populate(&boundary, id, &case["input"]);
        let next = boundary.profile_clock(id, until).unwrap();
        assert_eq!(next["state"], "PROFILE_CLOCK_READY");
        assert_ne!(
            first["sourceClockKey"], next["sourceClockKey"],
            "{}",
            case["id"]
        );
        count += 1;
    }
    assert_eq!(count, 239);
}
#[test]
fn pending_reference_and_raw_clock_context_are_checked_without_host_ready_flags() {
    let (_, pool) = setup();
    let id = begin(&pool, None);
    assert!(matches!(
        pool.seal(id),
        Err(AssemblyError::Contract(ContractError::InvalidDate))
    ));
    let mut header = json!({"ownerScope":"clock-owner","ownerEpoch":1,"snapshotId":"clock-snapshot","snapshotRevision":1,"referenceDate":null,"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}});
    assert!(pool.begin(&serde_json::to_vec(&header).unwrap()).is_err());
    header["referenceDate"] = json!("2026-11-13");
    let id = pool.begin(&serde_json::to_vec(&header).unwrap()).unwrap();
    let legacy = pool.seal(id).unwrap();
    assert!(legacy.clock_context().is_none());
    assert_eq!(legacy.reference_date(), "2026-11-13");
    for clock in [
        Value::Null,
        json!({"observedEpochMilliseconds":9007199254740992_i64}),
        json!({"observedEpochMilliseconds":0,"ready":true}),
        json!({"observedEpochMilliseconds":1.5}),
        json!({"observedEpochMilliseconds":i64::MAX}),
    ] {
        let mut raw = snapshot_fixture::raw_snapshot(1, "clock-owner", 1);
        raw["clockContext"] = clock;
        let request = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}});
        assert!(contract::parse_request(&serde_json::to_vec(&request).unwrap()).is_err());
    }
}
#[test]
fn direct_registration_recomputes_clock_and_rejects_a_known_false_reference() {
    let b = data();
    let case = case_by_id(&b, "zone-0-instant-3-history-1");
    let (registry, _) = setup();
    let snapshot = parse(raw(&case)).unwrap();
    registry.register(snapshot.clone()).unwrap();
    let facts = SnapshotFacts::new(snapshot);
    assert_eq!(
        facts.financial_profile().unwrap().unwrap()["timeZone"],
        case["expected"]["value"]["projectedBaseProfile"]["timeZone"]
    );
    let mut wrong = raw(&case);
    wrong["referenceDate"] = json!("2026-11-13");
    let (registry, _) = setup();
    assert_eq!(
        registry.register(parse(wrong).unwrap()).unwrap_err(),
        RegistryError::IdentityConflict
    );
    let mut unavailable = raw(&case);
    set_raw(
        &mut unavailable,
        SourceKind::WorkProfile,
        json!({"state":"FAILED","code":"READ_FAILED"}),
    );
    let (registry, _) = setup();
    let checked = registry.register(parse(unavailable).unwrap()).unwrap();
    assert!(SnapshotFacts::new(checked).financial_profile().is_err());
}
#[test]
fn abort_and_owner_reset_discard_private_clock_proofs_without_registering_ready_facts() {
    let b = data();
    let case = case_by_id(&b, "zone-0-instant-3-history-1");
    let (registry, pool) = setup();
    let id = begin(&pool, None);
    populate(&pool, id, &case["input"]);
    let expected = parse(raw(&case)).unwrap();
    pool.profile_clock(id, instant(&case)).unwrap();
    assert!(registry.snapshot(expected.identity()).is_err());
    assert!(pool.abort(id).unwrap());
    assert_eq!(pool.collect_retired().unwrap(), 1);
    assert!(pool.profile_clock(id, instant(&case)).is_err());
    assert!(pool.seal(id).is_err());
    assert_eq!(pool.collect_retired().unwrap(), 0);
    assert_eq!(pool.stats().unwrap().active_builders, 0);
    let id = begin(&pool, None);
    populate(&pool, id, &case["input"]);
    pool.profile_clock(id, instant(&case)).unwrap();
    registry
        .reset_for_owner(&OwnerIdentity::new("other-owner", 2).unwrap())
        .unwrap();
    assert!(pool.profile_clock(id, instant(&case)).is_err());
    assert!(pool.seal(id).is_err());
    pool.collect_retired().unwrap();
    assert_eq!(pool.stats().unwrap().active_builders, 0);
}
#[test]
fn settings_summary_uses_the_same_genuine_provider_role_and_original_row_expression() {
    let data = value_pool::decode(include_str!(
        "../../reference/profile-settings-summary-golden.json"
    ));
    assert_eq!(data["cases"].as_array().unwrap().len(), 519);
    let mut actual_frames = Vec::new();
    for case in data["cases"].as_array().unwrap() {
        let (_, pool) = setup();
        let id = begin(&pool, None);
        populate(&pool, id, &case["input"]);
        let frame = pool
            .profile_clock(
                id,
                case["input"]["observedEpochMilliseconds"].as_i64().unwrap(),
            )
            .unwrap();
        assert_eq!(
            frame["settingsSummary"],
            json!({"state":"READY","value":case["expected"]}),
            "{}",
            case["id"]
        );
        actual_frames.push(json!({"id":case["id"],"native":frame,"original":case["expected"]}));
    }
    if let Ok(file) = std::env::var("LUNA_PROFILE_SETTINGS_UI_DUMP") {
        let bytes=serde_json::to_vec(&json!({"producer":"ACTUAL_NATIVE_CLOCK_AFTER_ORIGINAL_519_ASSERTIONS","frames":actual_frames})).unwrap();
        assert!(bytes.len() < 16 * 1024 * 1024);
        std::fs::write(file, bytes).unwrap();
    }
}

#[test]
fn settings_summary_does_not_hide_profile_io_failure_or_block_a_ready_clock() {
    let b = data();
    let case = case_by_id(&b, "zone-0-instant-0-history-0");
    for pattern in [
        json!({"state":"NOT_REQUESTED"}),
        json!({"state":"LOADING"}),
        json!({"state":"FAILED","code":"READ_FAILED"}),
    ] {
        let (_, pool) = setup();
        let id2 = begin(&pool, None);
        source(
            &pool,
            id2,
            SourceKind::WorkProfile,
            Some(&case["input"]["profile"]),
        );
        source(
            &pool,
            id2,
            SourceKind::RemunerationProfiles,
            Some(&case["input"]["historyRows"]),
        );
        state(&pool, id2, SourceKind::WorkPatternSettings, pattern);
        let frame = pool.profile_clock(id2, instant(&case)).unwrap();
        assert_eq!(frame["state"], "PROFILE_CLOCK_READY");
        assert_eq!(frame["settingsSummary"], frame["profiles"]);
        assert_eq!(frame["settingsSummary"]["state"], "UNAVAILABLE");
        pool.abort(id2).unwrap();
    }
}
