mod common;
#[path = "support/export_time_snapshot.rs"]
mod export_snapshot;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    contract::OwnerIdentity,
    runtime::{
        SnapshotRegistry,
        export_report::{
            NativeTimeExportSource, collation::ExportCollationDraft, prepare_time_document,
            structure::ExportStructureIndex,
        },
        facts::SnapshotFacts,
        write_resource::WriteContextStamp,
    },
};
use serde_json::{Value, json};
use std::sync::Arc;

#[test]
fn one_retained_native_source_shares_target_preparation_and_releases_raw_owners() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/export-source-time-golden.json"
    ));
    let case = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == "family-9-2026")
        .unwrap();
    let facts = facts(case);
    let weak = Arc::downgrade(facts.calendar().unwrap());
    let structure = Arc::new(ExportStructureIndex::from_facts(&facts).unwrap());
    let source = NativeTimeExportSource::with_structure(&facts, Arc::clone(&structure)).unwrap();
    assert!(Arc::ptr_eq(source.structure(), &structure));
    assert!(structure.shares_calendar(facts.calendar().unwrap()));
    let foreign_facts = self::facts(case);
    assert!(
        NativeTimeExportSource::with_structure(&foreign_facts, Arc::clone(&structure)).is_err()
    );
    drop(foreign_facts);
    let ranks = serde_json::from_value(case["platformCollationRanks"].clone()).unwrap();
    assert!(prepare_time_document(&facts, "bad-period", &ranks).is_err());
    assert_eq!(source.target_preparation_stats().input_parses, 0);
    for invalid in ["invalid", "1800", "2026-13", "2026-7"] {
        assert!(source.document(invalid, &ranks).is_err());
    }
    assert_eq!(source.target_preparation_stats().input_parses, 0);
    let annual = source.document("2026", &ranks).unwrap();
    let csv = annual.to_csv(16 * 1024 * 1024).unwrap();
    assert_eq!(csv, case["expected"]["csv"].as_str().unwrap());
    assert!(annual.to_csv(csv.len() - 1).is_err());
    assert_eq!(annual.to_csv(csv.len()).unwrap(), csv);
    for month in 1..=12 {
        source
            .document(&format!("2026-{month:02}"), &ranks)
            .unwrap();
    }
    assert_eq!(source.target_preparation_stats().input_parses, 1);
    assert_eq!(source.target_preparation_stats().context_preparations, 1);
    assert!(
        source
            .document("2026-07", &serde_json::from_value(json!({})).unwrap())
            .is_err()
    );
    drop(facts);
    assert!(weak.upgrade().is_some());
    drop(structure);
    drop(source);
    assert!(weak.upgrade().is_none());
    assert_eq!(annual.to_csv(csv.len()).unwrap(), csv);
}
#[test]
fn fifty_thousand_raw_sql_rows_are_borrowed_once_and_no_raw_source_survives_the_document() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/export-source-time-golden.json"
    ));
    let mut case = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == "family-9-2026-07")
        .unwrap()
        .clone();
    let base = case["input"]["shiftRows"][0].clone();
    let mut ranks: std::collections::BTreeMap<String, u32> =
        serde_json::from_value(case["platformCollationRanks"].clone()).unwrap();
    let offset = ranks.values().copied().max().unwrap() + 1;
    let rows = (0..50_000)
        .map(|index| {
            let mut row = base.clone();
            let id = format!("row-{index:05}");
            row["id"] = json!(id);
            ranks.insert(id, offset + index);
            row
        })
        .collect::<Vec<_>>();
    case["input"]["shiftRows"] = json!(rows);
    case["input"]["appointmentRows"] = json!([]);
    case["platformCollationRanks"] = serde_json::to_value(&ranks).unwrap();
    let facts = facts(&case);
    let weak = Arc::downgrade(facts.calendar().unwrap());
    let source = NativeTimeExportSource::from_facts(&facts).unwrap();
    assert_eq!(source.structure().scanned_entry_count(), 50_000);
    let candidates = source.structure().candidates("2026-07").unwrap();
    assert_eq!(candidates.readable_entry_count(), 50_000);
    assert!(candidates.reserved_bytes() < 32 * 1024 * 1024);
    // Declared synthetic platform order is a 50k ownership/budget guard;
    // original locale equality is separately proven by the 79-case oracle.
    let declared = candidates
        .strings()
        .iter()
        .enumerate()
        .map(|(index, text)| (text, index as u32))
        .collect::<std::collections::BTreeMap<_, _>>();
    let rank_json = serde_json::to_vec(&declared).unwrap();
    drop(declared);
    drop(candidates);
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("export", 1).unwrap())
        .unwrap();
    let marker = registry.utility_owner_marker().unwrap();
    let stamp=WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35})).unwrap();
    let proof = ExportCollationDraft::prepare(
        marker.clone(),
        stamp.clone(),
        Arc::clone(source.structure()),
        "2026-07",
    )
    .unwrap()
    .finalize(&rank_json)
    .unwrap();
    assert!(proof.retained_rank_bytes().unwrap() < 32 * 1024 * 1024);
    assert_eq!(source.target_preparation_stats().input_parses, 0);
    assert_eq!(source.target_preparation_stats().context_preparations, 0);
    assert_eq!(
        source
            .structure()
            .candidates("2026-08")
            .unwrap()
            .readable_entry_count(),
        0
    );
    assert_eq!(source.structure().scanned_entry_count(), 50_000);
    let ranks = serde_json::from_value(case["platformCollationRanks"].clone()).unwrap();
    let result = source
        .document(
            "2026-07",
            proof
                .ranks_for(&marker, &stamp, source.structure(), "2026-07")
                .unwrap(),
        )
        .unwrap();
    assert_eq!(result.entries().len(), 50_000);
    assert_eq!(result.entries()[49_999].duration_minutes, Some(450.0));
    let parsed = source.target_preparation_stats();
    source.document("2026-08", &ranks).unwrap();
    assert_eq!(
        source.target_preparation_stats().input_parses,
        parsed.input_parses
    );
    assert_eq!(
        source.target_preparation_stats().context_preparations,
        parsed.context_preparations
    );
    drop(facts);
    drop(source);
    assert!(weak.upgrade().is_some());
    drop(proof);
    assert!(weak.upgrade().is_none());
    let csv = result.to_csv(16 * 1024 * 1024).unwrap();
    assert!(csv.len() > 1_000_000);
    assert!(!csv.contains("settings_json"));
}

fn facts(case: &Value) -> SnapshotFacts {
    let input = &case["input"];
    let source=input.get("rawSource").cloned().unwrap_or_else(||json!({
        "profile":input["work"],"historyRows":input["historyRows"],"patternRows":[],"epoch":1794657600000_i64,"targetState":"READY","targetRow":input["targetRow"],"youthPreference":{"value":"false"},
        "calendar":{"shiftRows":input["shiftRows"],"appointmentRows":input["appointmentRows"],"templateRows":input.get("templateRows").cloned().unwrap_or(json!([]))}
    }));
    export_snapshot::raw_facts(&source, &case["platformCollationRanks"])
}
#[test]
fn original_supplied_provider_role_pipeline_remains_unchanged_as_a_reference() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/export-source-time-golden.json"
    ));
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 79);
    for case in cases {
        let facts = facts(case);
        let ranks = serde_json::from_value(case["platformCollationRanks"].clone()).unwrap();
        let actual = NativeTimeExportSource::from_provider_profile_reference(&facts)
            .and_then(|source| source.document(case["input"]["period"].as_str().unwrap(), &ranks));
        if case["expected"].get("$error").is_some() {
            assert!(actual.is_err(), "{} must not be Ready", case["id"]);
            continue;
        }
        let result = actual.unwrap_or_else(|e| panic!("{}: {e}", case["id"]));
        common::assert_json_eq(
            &serde_json::to_value(result.entries()).unwrap(),
            &case["expected"]["entries"],
            case["id"].as_str().unwrap(),
        );
        common::assert_json_eq(
            &serde_json::to_value(result.targets()).unwrap(),
            &case["expected"]["targets"],
            case["id"].as_str().unwrap(),
        );
        assert_eq!(
            result.to_csv(16 * 1024 * 1024).unwrap(),
            case["expected"]["csv"].as_str().unwrap(),
            "{}",
            case["id"]
        );
    }
}
