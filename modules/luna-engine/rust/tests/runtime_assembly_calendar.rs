#[path = "support/snapshot.rs"]
mod snapshot;
use luna_engine::{
    contract::OwnerIdentity,
    runtime::{
        SnapshotRegistry,
        assembly::{BuilderId, SnapshotAssemblyPool, SourceTarget},
    },
};
use serde_json::{Value, json};
use std::collections::BTreeSet;
fn setup(calendar: &Value) -> (SnapshotRegistry, SnapshotAssemblyPool, BuilderId, Value) {
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("owner", 1).unwrap())
        .unwrap();
    let pool = SnapshotAssemblyPool::new(registry.clone());
    let mut raw = snapshot::raw_snapshot(1, "owner", 1);
    let group = raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|g| g["kind"] == "CALENDAR_ENTRIES")
        .unwrap();
    group["source"] = json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":calendar}}});
    snapshot::seal(&mut raw);
    let header = json!({"ownerScope":"owner","ownerEpoch":1,"snapshotId":raw["identity"]["snapshotId"],"snapshotRevision":1,"referenceDate":raw["referenceDate"],"selectedPackageIds":raw["catalogs"]["current"]["selectedPackageIds"],"completeness":raw["completeness"]});
    let id = pool.begin(&serde_json::to_vec(&header).unwrap()).unwrap();
    let metadata = json!({"kind":"CALENDAR_ENTRIES","source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}}});
    pool.source(
        id,
        SourceTarget::Source,
        &serde_json::to_vec(&metadata).unwrap(),
        &serde_json::to_vec(calendar).unwrap(),
    )
    .unwrap();
    (registry, pool, id, raw)
}
#[test]
fn candidate_pages_include_native_check_codes_and_bind_the_same_snapshot_digest() {
    let (_registry, pool, id, mut raw) = setup(
        &json!({"shiftRows":[],"appointmentRows":[],"templateRows":[],"platformCollationRanks":{}}),
    );
    let first = pool.calendar_candidates(id, None, 7).unwrap();
    assert_eq!(first["candidates"].as_array().unwrap().len(), 7);
    assert_eq!(first["total"], 64);
    let mut ranks = serde_json::Map::new();
    let mut cursor = None;
    loop {
        let page = pool.calendar_candidates(id, cursor, 7).unwrap();
        for candidate in page["candidates"].as_array().unwrap() {
            ranks.insert(candidate.as_str().unwrap().into(), json!(0));
        }
        cursor = page["nextAfter"].as_u64().map(|n| n as u32);
        if cursor.is_none() {
            break;
        }
    }
    pool.calendar_ranks(id, &serde_json::to_vec(&ranks).unwrap())
        .unwrap();
    let group = raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|g| g["kind"] == "CALENDAR_ENTRIES")
        .unwrap();
    group["source"]["payload"]["data"]["value"]["platformCollationRanks"] = json!(ranks);
    snapshot::seal(&mut raw);
    assert_eq!(
        serde_json::to_value(pool.seal(id).unwrap().identity()).unwrap(),
        raw["identity"]
    );
}

fn all_candidates(pool: &SnapshotAssemblyPool, id: BuilderId, limit: u16) -> BTreeSet<String> {
    let mut result = BTreeSet::new();
    let mut cursor = None;
    let mut expected = 0;
    loop {
        let page = pool.calendar_candidates(id, cursor, limit).unwrap();
        let total = page["total"].as_u64().unwrap();
        if expected == 0 {
            expected = total;
        } else {
            assert_eq!(expected, total);
        }
        for text in page["candidates"].as_array().unwrap() {
            assert!(result.insert(text.as_str().unwrap().to_owned()));
        }
        cursor = page["nextAfter"].as_u64().map(|n| n as u32);
        if let Some(cursor) = cursor {
            assert_eq!(cursor as usize, result.len());
        } else {
            break;
        }
    }
    assert_eq!(result.len() as u64, expected);
    result
}
#[test]
fn all_original_template_sql_cases_keep_source_candidates_and_unjoined_rows() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/calendar-templates-golden.json"
    ))
    .unwrap();
    for case in data["cases"].as_array().unwrap() {
        let mut input = case["input"].clone();
        input["platformCollationRanks"] = json!({});
        let (_registry, pool, id, _raw) = setup(&input);
        let candidates = all_candidates(&pool, id, 3);
        let mut expected = case["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_owned())
            .collect::<BTreeSet<_>>();
        expected.extend(
            luna_engine::training::code_candidates()
                .iter()
                .map(|s| (*s).to_owned()),
        );
        assert_eq!(candidates, expected, "{}", case["id"]);
        let mut ranks = case["input"]["platformCollationRanks"]
            .as_object()
            .unwrap()
            .clone();
        for code in luna_engine::training::code_candidates() {
            ranks.entry((*code).to_owned()).or_insert(json!(0));
        }
        pool.calendar_ranks(id, &serde_json::to_vec(&ranks).unwrap())
            .unwrap();
        let snapshot = pool.seal(id).unwrap();
        let calendar = snapshot
            .sources()
            .iter()
            .find(|g| g.kind() == luna_engine::contract::SourceKind::CalendarEntries)
            .unwrap();
        let luna_engine::contract::SourceState::Ready { payload, .. } = calendar.state() else {
            panic!("ready")
        };
        let luna_engine::contract::DataPresence::Value { value } = payload.data() else {
            panic!("value")
        };
        let actual =
            luna_engine::runtime::calendar_source::PreparedCalendarSource::try_from_value(value)
                .unwrap()
                .into_ready()
                .unwrap();
        assert_eq!(
            json!(actual.entries().as_ref()),
            case["expected"],
            "{}",
            case["id"]
        );
        assert_eq!(
            actual.raw_shift_rows().as_ref(),
            case["input"]["shiftRows"].as_array().unwrap()
        );
    }
}
#[test]
fn incomplete_wrong_duplicate_ranks_and_cursor_limits_never_register_partial_inputs() {
    let empty = json!({"shiftRows":[],"appointmentRows":[],"platformCollationRanks":{}});
    for ranks in [
        b"{}".as_slice(),
        b"[]",
        b"{\"x\":-1}",
        b"{\"x\":1.5}",
        b"{\"x\":4294967296}",
        b"{\"x\":0,\"x\":1}",
    ] {
        let (_registry, pool, id, _) = setup(&empty);
        pool.calendar_candidates(id, None, 1).unwrap();
        assert!(pool.calendar_ranks(id, ranks).is_err());
        assert!(pool.seal(id).is_err());
    }
    for (cursor, limit) in [(None, 0), (None, 1025), (Some(65), 1)] {
        let (_, pool, id, _) = setup(&empty);
        assert!(pool.calendar_candidates(id, cursor, limit).is_err());
    }
    let (_, pool, id, _) = setup(&empty);
    pool.calendar_candidates(id, None, 1).unwrap();
    assert!(pool.seal(id).is_err());
    let (registry, pool, id, _) = setup(&empty);
    pool.calendar_candidates(id, None, 1).unwrap();
    registry
        .reset_for_owner(&OwnerIdentity::new("owner", 1).unwrap())
        .unwrap();
    assert!(pool.calendar_candidates(id, None, 1).is_err());
    assert!(pool.calendar_ranks(id, b"{}").is_err());
}
#[test]
fn fifty_thousand_raw_shifts_page_without_resending_or_cloning_raw_input() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/calendar-templates-golden.json"
    ))
    .unwrap();
    let mut row = data["cases"][0]["input"]["shiftRows"][0].clone();
    row["template_id"] = Value::Null;
    row["title"] = json!("D");
    row["note"] = json!("");
    let rows = (0..50_000)
        .map(|index| {
            let mut row = row.clone();
            row["id"] = json!(format!("e{index:05}"));
            row
        })
        .collect::<Vec<_>>();
    let input = json!({"shiftRows":rows,"appointmentRows":[],"platformCollationRanks":{}});
    assert!(serde_json::to_vec(&input).unwrap().len() < 32 * 1024 * 1024);
    let (_, pool, id, _) = setup(&input);
    let candidates = all_candidates(&pool, id, 512);
    assert!(candidates.len() > 50_000);
    assert!(candidates.contains("e00000") && candidates.contains("e49999"));
    let ranks = candidates
        .into_iter()
        .map(|text| (text, json!(0)))
        .collect::<serde_json::Map<_, _>>();
    pool.calendar_ranks(id, &serde_json::to_vec(&ranks).unwrap())
        .unwrap();
    assert!(pool.seal(id).is_ok());
}
#[test]
fn candidate_digest_reuses_for_end_time_changes_but_changes_with_comparison_strings() {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/calendar-templates-golden.json"
    ))
    .unwrap();
    let mut input = data["cases"][0]["input"].clone();
    input["platformCollationRanks"] = json!({});
    let (_, pool, id, _) = setup(&input);
    let first = pool.calendar_candidates(id, None, 1).unwrap();
    let digest = first["candidateDigest"]
        .as_str()
        .expect("candidate digest")
        .to_owned();
    assert_eq!(digest.len(), 64);
    let later = pool.calendar_candidates(id, Some(1), 7).unwrap();
    assert_eq!(later["candidateDigest"], digest);
    input["shiftRows"][0]["end_time"] = json!("14:30");
    let (_, changed, id, _) = setup(&input);
    assert_eq!(
        changed.calendar_candidates(id, None, 1).unwrap()["candidateDigest"],
        digest
    );
    input["templateRows"][7]["name"] = json!("Anderer Titel");
    let (_, renamed, id, _) = setup(&input);
    assert_ne!(
        renamed.calendar_candidates(id, None, 1).unwrap()["candidateDigest"],
        digest
    );
}
