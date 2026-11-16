mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    contract::OwnerIdentity,
    input::{
        InputError,
        calendar_rows::{PreparedCalendarRows, RawCalendarEntries},
    },
    runtime::{
        SnapshotRegistry,
        export_report::{
            collation::{ExportCollationDraft, ExportCollationError},
            structure::ExportStructureIndex,
        },
        write_resource::WriteContextStamp,
    },
};
use serde_json::{Value, json};
use std::sync::Arc;
fn registry() -> SnapshotRegistry {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("export", 1).unwrap())
        .unwrap();
    registry
}
fn stamp() -> WriteContextStamp {
    WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35})).unwrap()
}
fn calendar(input: &Value, raw_ranks: &str) -> Result<Arc<RawCalendarEntries>, InputError> {
    let prepared = PreparedCalendarRows::from_rows_with_templates(
        Arc::new(input["shiftRows"].as_array().unwrap().clone()),
        Arc::new(input["appointmentRows"].as_array().unwrap().clone()),
        input
            .get("templateRows")
            .and_then(Value::as_array)
            .map_or(&[], Vec::as_slice),
    )?;
    Ok(Arc::new(prepared.into_ranked_owned(
        serde_json::from_str(raw_ranks).unwrap(),
    )?))
}
#[test]
fn original_raw_sql_locale_ranks_produce_only_native_export_proofs() {
    let source = value_pool::decode(include_str!(
        "../../reference/export-source-time-golden.json"
    ));
    let fixture = value_pool::decode(include_str!("../../reference/export-collation-golden.json"));
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 79);
    let registry = registry();
    let owner = registry.utility_owner_marker().unwrap();
    let stamp = stamp();
    let mut valid = 0;
    let mut rejected = 0;
    for case in cases {
        let input = &source["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == case["id"])
            .unwrap()["input"];
        if case["expected"].get("error").is_some() {
            assert!(calendar(input, "{}").is_err());
            rejected += 1;
            continue;
        }
        let index = Arc::new(
            ExportStructureIndex::from_calendar(
                calendar(input, case["expected"]["baseRankJson"].as_str().unwrap()).unwrap(),
            )
            .unwrap(),
        );
        let period = input["period"].as_str().unwrap();
        let draft =
            ExportCollationDraft::prepare(owner.clone(), stamp.clone(), Arc::clone(&index), period)
                .unwrap();
        let digest = draft.candidate_digest().unwrap().to_owned();
        common::assert_json_eq(
            &json!(draft.candidates().unwrap()),
            &case["expected"]["candidates"],
            case["id"].as_str().unwrap(),
        );
        let proof = draft
            .finalize(
                case["expected"]["exportRankJson"]
                    .as_str()
                    .unwrap()
                    .as_bytes(),
            )
            .unwrap_or_else(|error| panic!("{}: {error}", case["id"]));
        proof.ranks_for(&owner, &stamp, &index, period).unwrap();
        assert_eq!(proof.candidate_digest().unwrap(), digest);
        assert_eq!(proof.rank_digest().unwrap().len(), 64);
        assert!(proof.retained_rank_bytes().unwrap() < 32 * 1024 * 1024);
        let expected: Value =
            serde_json::from_str(case["expected"]["exportRankJson"].as_str().unwrap()).unwrap();
        for (text, rank) in expected.as_object().unwrap() {
            assert_eq!(
                proof.verified_rank(text).unwrap() as u64,
                rank.as_u64().unwrap()
            );
        }
        valid += 1;
    }
    assert_eq!((valid, rejected), (76, 3));
}
fn ready_case() -> (Value, Value) {
    let source = value_pool::decode(include_str!(
        "../../reference/export-source-time-golden.json"
    ));
    let fixture = value_pool::decode(include_str!("../../reference/export-collation-golden.json"));
    let id = "locale-equal-order-and-absence-priority";
    (
        source["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == id)
            .unwrap()["input"]
            .clone(),
        fixture["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == id)
            .unwrap()["expected"]
            .clone(),
    )
}
#[test]
fn malformed_partial_duplicate_foreign_and_oversized_rank_json_never_mint_a_proof() {
    let (input, expected) = ready_case();
    let registry = registry();
    let owner = registry.utility_owner_marker().unwrap();
    let stamp = stamp();
    let index = Arc::new(
        ExportStructureIndex::from_calendar(
            calendar(&input, expected["baseRankJson"].as_str().unwrap()).unwrap(),
        )
        .unwrap(),
    );
    let period = input["period"].as_str().unwrap();
    let raw = expected["exportRankJson"].as_str().unwrap();
    let valid: Value = serde_json::from_str(raw).unwrap();
    let first = valid.as_object().unwrap().keys().next().unwrap();
    let mut malformed = vec![
        b"{}".to_vec(),
        format!(
            "{{{}:0,{}",
            serde_json::to_string(first).unwrap(),
            &raw[1..]
        )
        .into_bytes(),
        format!("{raw}{{}}").into_bytes(),
    ];
    let mut missing = valid.clone();
    missing.as_object_mut().unwrap().remove(first);
    malformed.push(serde_json::to_vec(&missing).unwrap());
    let mut foreign = valid.clone();
    foreign["outside-export-union-private"] = json!(0);
    malformed.push(serde_json::to_vec(&foreign).unwrap());
    for value in [
        json!(-1),
        json!(0.5),
        json!(valid.as_object().unwrap().len()),
        json!("0"),
        Value::Null,
    ] {
        let mut row = valid.clone();
        row[first] = value;
        malformed.push(serde_json::to_vec(&row).unwrap());
    }
    for raw in malformed {
        let draft =
            ExportCollationDraft::prepare(owner.clone(), stamp.clone(), Arc::clone(&index), period)
                .unwrap();
        let error = draft.finalize(&raw).err().unwrap();
        assert!(matches!(error, ExportCollationError::InvalidRanks));
        assert!(!error.to_string().contains("private"));
    }
    let draft =
        ExportCollationDraft::prepare(owner.clone(), stamp.clone(), Arc::clone(&index), period)
            .unwrap();
    assert!(matches!(
        draft.finalize(&vec![b' '; 32 * 1024 * 1024 + 1]),
        Err(ExportCollationError::TooLarge)
    ));
}
#[test]
fn proofs_bind_native_core_stamp_period_and_exact_index_and_release_calendar_after_reset() {
    let (input, expected) = ready_case();
    let registry = registry();
    let owner = registry.utility_owner_marker().unwrap();
    let stamp = stamp();
    let calendar = calendar(&input, expected["baseRankJson"].as_str().unwrap()).unwrap();
    let weak = Arc::downgrade(&calendar);
    let index = Arc::new(ExportStructureIndex::from_calendar(Arc::clone(&calendar)).unwrap());
    let period = input["period"].as_str().unwrap();
    let raw = expected["exportRankJson"].as_str().unwrap().as_bytes();
    let proof =
        ExportCollationDraft::prepare(owner.clone(), stamp.clone(), Arc::clone(&index), period)
            .unwrap()
            .finalize(raw)
            .unwrap();
    let other = self::registry();
    let other_owner = other.utility_owner_marker().unwrap();
    let foreign_index =
        Arc::new(ExportStructureIndex::from_calendar(Arc::clone(&calendar)).unwrap());
    let changed=WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"22222222222222222222222222222222","databaseSchemaVersion":35})).unwrap();
    for result in [
        proof.ranks_for(&other_owner, &stamp, &index, period),
        proof.ranks_for(&owner, &changed, &index, period),
        proof.ranks_for(&owner, &stamp, &foreign_index, period),
        proof.ranks_for(&owner, &stamp, &index, "2026"),
    ] {
        assert!(matches!(result, Err(ExportCollationError::ForeignBinding)));
    }
    assert!(proof.is_current().unwrap());
    drop(calendar);
    drop(foreign_index);
    drop(index);
    assert!(weak.upgrade().is_some());
    registry
        .reset_for_owner(&OwnerIdentity::new("export", 1).unwrap())
        .unwrap();
    assert!(!proof.is_current().unwrap());
    assert!(matches!(
        proof.verified_rank(""),
        Err(ExportCollationError::OwnerChanged)
    ));
    drop(proof);
    assert!(weak.upgrade().is_none());
}
