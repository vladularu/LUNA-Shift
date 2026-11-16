mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    contract::{OwnerIdentity, SourceKind, assembly::SnapshotAssembly},
    runtime::{
        SnapshotRegistry,
        export_report::resource::{ExportResourceError, ExportSourceResource, MAX_CSV_BYTES},
        write_resource::WriteContextStamp,
    },
};
use serde_json::{Value, json};
use std::sync::Arc;
fn bytes(value: &Value) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}
fn stamp() -> WriteContextStamp {
    WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35})).unwrap()
}
fn registry() -> SnapshotRegistry {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("export-resource", 1).unwrap())
        .unwrap();
    registry
}
fn assembly(raw: &Value, ranks: &Value) -> SnapshotAssembly {
    let header = json!({"ownerScope":"export-resource","ownerEpoch":1,"snapshotId":"local-export","snapshotRevision":1,"selectedPackageIds":{"tariff":["tvoed-vka-bt-k"],"legal":["de-arbzg-care"],"holiday":["de-holidays"]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}});
    let mut source = SnapshotAssembly::begin(&bytes(&header)).unwrap();
    for (kind, key) in [
        (SourceKind::WorkProfile, "profile"),
        (SourceKind::RemunerationProfiles, "historyRows"),
        (SourceKind::WorkPatternSettings, "patternRows"),
        (SourceKind::WorkingTimeTarget, "targetRow"),
        (SourceKind::CalendarEntries, "calendar"),
        (SourceKind::YouthPreference, "youthPreference"),
    ] {
        if kind == SourceKind::WorkingTimeTarget && raw["targetState"] != "READY" {
            let state = if raw["targetState"] == "LOADING" {
                json!({"state":"LOADING"})
            } else {
                json!({"state":"FAILED","code":"READ_FAILED"})
            };
            source
                .source(&bytes(&json!({"kind":kind,"source":state})), &[])
                .unwrap();
            continue;
        }
        let mut body = raw[key].clone();
        if kind == SourceKind::CalendarEntries {
            body["platformCollationRanks"] = ranks.clone();
        }
        if kind == SourceKind::WorkingTimeTarget && !body.is_null() {
            let text = body
                .as_object_mut()
                .unwrap()
                .remove("settings_json")
                .unwrap();
            body["settings_json_chunks"] = json!([text]);
        }
        let state = json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":if body.is_null(){"NULL"}else{"VALUE"}}}});
        source
            .source(
                &bytes(&json!({"kind":kind,"source":state})),
                &if body.is_null() { vec![] } else { bytes(&body) },
            )
            .unwrap();
    }
    for kind in ["TARIFF", "LEGAL", "HOLIDAY"] {
        source.catalog(&bytes(&json!({"kind":kind,"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}}})),br#"{"mode":"COMPILED_PREVIEW"}"#).unwrap();
    }
    source
}
#[test]
fn genuine_raw_six_resources_reproduce_all_original_export_csv_outcomes() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/export-provider-join-golden.json"
    ));
    let platform = value_pool::decode(include_str!(
        "../../reference/export-resource-ranks-golden.json"
    ));
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 374);
    let registry = registry();
    let owner = registry.utility_owner_marker().unwrap();
    let stamp = stamp();
    let mut ready = 0;
    let mut unavailable = 0;
    for case in cases {
        let input = &case["input"];
        let raw = &input["rawSource"];
        let epoch = raw["epoch"].as_i64().unwrap();
        let period = input["period"].as_str().unwrap();
        let source = ExportSourceResource::prepare(
            owner.clone(),
            stamp.clone(),
            assembly(raw, &case["platformCollationRanks"]),
            epoch,
        );
        if case["expected"]["state"] == "DISABLED" {
            assert!(source.is_err());
            unavailable += 1;
            continue;
        }
        let source = source.unwrap_or_else(|e| panic!("{}: {e}", case["id"]));
        assert_eq!(source.initialization_count(), 0);
        let draft = source
            .collation_draft(&owner, &stamp, period, epoch)
            .unwrap();
        let expected_ranks = &platform["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["id"] == case["id"])
            .unwrap()["expected"];
        common::assert_json_eq(
            &json!(draft.candidates().unwrap()),
            &expected_ranks["candidates"],
            case["id"].as_str().unwrap(),
        );
        let proof = Arc::new(
            draft
                .finalize(
                    expected_ranks["exportRankJson"]
                        .as_str()
                        .unwrap()
                        .as_bytes(),
                )
                .unwrap(),
        );
        assert_eq!(source.initialization_count(), 0);
        assert!(source.target_preparation_stats().is_none());
        let artifact = source.produce_csv(&owner, &stamp, period, proof, epoch, 16 * 1024 * 1024);
        assert_eq!(source.initialization_count(), 1);
        if case["expected"]["state"] == "ERROR" {
            assert!(artifact.is_err(), "{}", case["id"]);
            unavailable += 1;
            continue;
        }
        let artifact = artifact.unwrap_or_else(|e| panic!("{}: {e}", case["id"]));
        assert_eq!(
            artifact.csv().unwrap(),
            case["expected"]["csv"].as_str().unwrap(),
            "{}",
            case["id"]
        );
        ready += 1;
    }
    assert_eq!((ready, unavailable), (344, 30));
}

fn ready_case() -> (Value, Value) {
    let fixture = value_pool::decode(include_str!(
        "../../reference/export-provider-join-golden.json"
    ));
    let platform = value_pool::decode(include_str!(
        "../../reference/export-resource-ranks-golden.json"
    ));
    let case = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| {
            row["expected"]["state"] == "READY"
                && row["input"]["rawSource"]["targetState"] == "READY"
                && row["input"]["rawSource"]["calendar"]["shiftRows"]
                    .as_array()
                    .is_some_and(|v| !v.is_empty())
        })
        .unwrap()
        .clone();
    let ranks = platform["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == case["id"])
        .unwrap()["expected"]
        .clone();
    (case, ranks)
}
#[test]
fn owner_stamp_clock_proof_and_extra_group_boundaries_precede_calculation() {
    let (case, ranks) = ready_case();
    let input = &case["input"];
    let raw = &input["rawSource"];
    let epoch = raw["epoch"].as_i64().unwrap();
    let period = input["period"].as_str().unwrap();
    let registry = registry();
    let owner = registry.utility_owner_marker().unwrap();
    let stamp = stamp();
    let source = ExportSourceResource::prepare(
        owner.clone(),
        stamp.clone(),
        assembly(raw, &case["platformCollationRanks"]),
        epoch,
    )
    .unwrap();
    let proof = Arc::new(
        source
            .collation_draft(&owner, &stamp, period, epoch)
            .unwrap()
            .finalize(ranks["exportRankJson"].as_str().unwrap().as_bytes())
            .unwrap(),
    );
    let other = self::registry();
    let foreign = other.utility_owner_marker().unwrap();
    let changed=WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"22222222222222222222222222222222","databaseSchemaVersion":35})).unwrap();
    assert!(matches!(
        source.collation_draft(&foreign, &stamp, period, epoch),
        Err(ExportResourceError::ForeignBinding)
    ));
    assert!(matches!(
        source.collation_draft(&owner, &changed, period, epoch),
        Err(ExportResourceError::ForeignBinding)
    ));
    assert!(matches!(
        source.collation_draft(&owner, &stamp, period, epoch - 1),
        Err(ExportResourceError::Expired)
    ));
    let until = source.valid_until_epoch_milliseconds().unwrap();
    assert!(matches!(
        source.collation_draft(&owner, &stamp, period, until),
        Err(ExportResourceError::Expired)
    ));
    assert!(
        source
            .produce_csv(
                &owner,
                &stamp,
                "2027-12",
                Arc::clone(&proof),
                epoch,
                MAX_CSV_BYTES
            )
            .is_err()
    );
    assert!(matches!(
        source.produce_csv(
            &owner,
            &stamp,
            period,
            Arc::clone(&proof),
            epoch,
            MAX_CSV_BYTES + 1
        ),
        Err(ExportResourceError::TooLarge)
    ));
    assert_eq!(source.initialization_count(), 0);
    let mut extra = assembly(raw, &case["platformCollationRanks"]);
    extra.source(&bytes(&json!({"kind":"NET_PAY_SETTINGS_TIMELINE","source":{"state":"FAILED","code":"READ_FAILED"}})),&[]).unwrap();
    assert!(matches!(
        ExportSourceResource::prepare(owner.clone(), stamp.clone(), extra, epoch),
        Err(ExportResourceError::InvalidSourceScope)
    ));
    let artifact = source
        .produce_csv(
            &owner,
            &stamp,
            period,
            Arc::clone(&proof),
            epoch,
            MAX_CSV_BYTES,
        )
        .unwrap();
    assert!(artifact.is_current_at(&owner, &stamp, epoch).unwrap());
    assert!(!artifact.is_current_at(&owner, &changed, epoch).unwrap());
    assert!(!artifact.is_current_at(&owner, &stamp, until).unwrap());
    let size = artifact.csv().unwrap().len();
    assert!(
        source
            .produce_csv(&owner, &stamp, period, Arc::clone(&proof), epoch, size - 1)
            .is_err()
    );
    assert_eq!(source.initialization_count(), 1);
    let weak = Arc::downgrade(source.structure());
    drop(source);
    drop(proof);
    assert!(weak.upgrade().is_some());
    registry
        .reset_for_owner(&OwnerIdentity::new("export-resource", 1).unwrap())
        .unwrap();
    assert!(artifact.csv().is_err());
    assert!(!artifact.is_current_at(&owner, &stamp, epoch).unwrap());
    drop(artifact);
    assert!(weak.upgrade().is_none());
}
#[test]
fn malformed_target_is_unparsed_during_preparation_and_failure_initializes_once() {
    let (mut case, ranks) = ready_case();
    let epoch = case["input"]["rawSource"]["epoch"].as_i64().unwrap();
    let period = case["input"]["period"].as_str().unwrap().to_owned();
    case["input"]["rawSource"]["targetRow"] = json!({"id":"singleton","settings_json":"{unparsed-private-target","revision":1,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"});
    let registry = registry();
    let owner = registry.utility_owner_marker().unwrap();
    let stamp = stamp();
    let source = ExportSourceResource::prepare(
        owner.clone(),
        stamp.clone(),
        assembly(&case["input"]["rawSource"], &case["platformCollationRanks"]),
        epoch,
    )
    .unwrap();
    let proof = Arc::new(
        source
            .collation_draft(&owner, &stamp, &period, epoch)
            .unwrap()
            .finalize(ranks["exportRankJson"].as_str().unwrap().as_bytes())
            .unwrap(),
    );
    assert_eq!(source.initialization_count(), 0);
    assert!(source.target_preparation_stats().is_none());
    let first = source
        .produce_csv(
            &owner,
            &stamp,
            &period,
            Arc::clone(&proof),
            epoch,
            MAX_CSV_BYTES,
        )
        .err()
        .unwrap();
    let second = source
        .produce_csv(&owner, &stamp, &period, proof, epoch, MAX_CSV_BYTES)
        .err()
        .unwrap();
    match (&first, &second) {
        (ExportResourceError::Time(a), ExportResourceError::Time(b)) => assert!(Arc::ptr_eq(a, b)),
        _ => panic!("typed cached target failure"),
    };
    assert_eq!(source.initialization_count(), 1);
    assert!(!first.to_string().contains("private-target"));
}
#[test]
fn fifty_thousand_raw_rows_share_one_index_without_target_context_preparation() {
    use std::collections::{BTreeMap, BTreeSet};
    let (mut case, _) = ready_case();
    let raw = &mut case["input"]["rawSource"];
    let mut base = raw["calendar"]["shiftRows"][0].clone();
    for (key, value) in [
        ("template_id", Value::Null),
        ("date", json!("2026-07-01")),
        ("title", json!("Dienst")),
        ("type", json!("DAY")),
        ("all_day", json!(0)),
        ("start_time", json!("08:00")),
        ("end_time", json!("16:00")),
        ("break_minutes", json!(30)),
        ("special_duty_json", Value::Null),
        ("deleted_at", Value::Null),
    ] {
        base[key] = value;
    }
    let mut names = BTreeSet::new();
    for key in ["date", "title", "start_time", "created_at"] {
        names.insert(base[key].as_str().unwrap().to_owned());
    }
    let rows = (0..50_000)
        .map(|i| {
            let mut row = base.clone();
            let id = format!("large-{i:05}");
            names.insert(id.clone());
            row["id"] = json!(id);
            row
        })
        .collect::<Vec<_>>();
    raw["calendar"]["shiftRows"] = json!(rows);
    raw["calendar"]["appointmentRows"] = json!([]);
    raw["calendar"]["templateRows"] = json!([]);
    let ranks = names
        .into_iter()
        .enumerate()
        .map(|(i, s)| (s, i as u32))
        .collect::<BTreeMap<_, _>>();
    let ranks = serde_json::to_value(ranks).unwrap();
    let registry = registry();
    let owner = registry.utility_owner_marker().unwrap();
    let stamp = stamp();
    let epoch = raw["epoch"].as_i64().unwrap();
    let source =
        ExportSourceResource::prepare(owner.clone(), stamp.clone(), assembly(raw, &ranks), epoch)
            .unwrap();
    assert_eq!(source.structure().scanned_entry_count(), 50_000);
    let proof = source
        .collation_draft(&owner, &stamp, "2026-07", epoch)
        .unwrap()
        .finalize(&bytes(&ranks))
        .unwrap();
    source
        .collation_draft(&owner, &stamp, "2026-08", epoch)
        .unwrap();
    assert_eq!(source.structure().scanned_entry_count(), 50_000);
    assert_eq!(source.initialization_count(), 0);
    assert!(source.target_preparation_stats().is_none());
    let weak = Arc::downgrade(source.structure());
    drop(source);
    assert!(weak.upgrade().is_some());
    drop(proof);
    assert!(weak.upgrade().is_none());
}
