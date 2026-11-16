#[path = "support/snapshot.rs"]
mod snapshot;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{
        self, ImmutableSnapshot, OwnerIdentity, SnapshotIdentity, SourceKind, ValidatedRequest,
        financial_collation::FinancialIntent,
    },
    runtime::{SnapshotRegistry, financial_collation::FinancialCollationPool},
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};

fn setup() -> (SnapshotRegistry, FinancialCollationPool, SnapshotIdentity) {
    setup_calendar(None)
}
fn setup_calendar(
    calendar_state: Option<Value>,
) -> (SnapshotRegistry, FinancialCollationPool, SnapshotIdentity) {
    let fixture = value_pool::decode(include_str!(
        "../../reference/financial-candidates-golden.json"
    ));
    let case = &fixture["cases"][0];
    let mut raw = snapshot::raw_snapshot(1, "financial-owner", 1);
    raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|s| s["kind"] == json!(SourceKind::CalendarEntries))
        .unwrap()["source"] = json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":{"shiftRows":case["input"]["shiftRows"],"appointmentRows":case["input"]["appointmentRows"],"platformCollationRanks":case["platformCollationRanks"]}}}});
    if let Some(state) = calendar_state {
        raw["sources"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|s| s["kind"] == json!(SourceKind::CalendarEntries))
            .unwrap()["source"] = state;
    }
    snapshot::seal(&mut raw);
    let parsed=contract::parse_request(&serde_json::to_vec(&json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}})).unwrap()).unwrap();
    let snapshot: ImmutableSnapshot = match parsed {
        ValidatedRequest::RegisterSnapshot(s) => s,
        _ => panic!("snapshot"),
    };
    let identity = snapshot.identity().clone();
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("financial-owner", 1).unwrap())
        .unwrap();
    registry.register(snapshot).unwrap();
    let pool = FinancialCollationPool::new(registry.clone());
    (registry, pool, identity)
}
fn header(identity: &SnapshotIdentity, month: &str, id: &str) -> Value {
    json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"financial-owner","ownerEpoch":1,"requestId":id,"draftRevision":1,"snapshot":identity},"intent":{"month":month,"perspective":"EARNED","filter":null,"includeSpecialDutyPay":false},"localeKey":"de-DE-test"})
}
fn bytes(value: &Value) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}
fn prepared(pool: &FinancialCollationPool, header: &Value) -> Value {
    let completion = pool.prepare(&bytes(header)).unwrap();
    let value = serde_json::from_slice(&completion.serialize_current().unwrap()).unwrap();
    assert!(completion.is_current().unwrap());
    value
}
fn ranks(pool: &FinancialCollationPool, prepared: &Value) -> String {
    let mut values = BTreeMap::new();
    let mut after = Value::Null;
    loop {
        let page=pool.candidates(&bytes(&json!({"draftId":prepared["draftId"],"candidateDigest":prepared["candidateDigest"],"after":after,"limit":7}))).unwrap();
        let value: Value = serde_json::from_slice(&page.serialize_current().unwrap()).unwrap();
        for text in value["page"]["candidates"].as_array().unwrap() {
            let next = values.len();
            assert!(
                values
                    .insert(text.as_str().unwrap().to_owned(), next)
                    .is_none()
            );
        }
        after = value["page"]["nextAfter"].clone();
        if after.is_null() {
            break;
        }
    }
    serde_json::to_string(&values).unwrap()
}
fn final_header(prepared: &Value, reuse: bool) -> Value {
    json!({"draftId":prepared["draftId"],"candidateDigest":prepared["candidateDigest"],"reuseCached":reuse})
}
#[test]
fn native_prepare_pages_finalize_and_neighbor_intents_share_one_structure_and_rank_owner() {
    let (_, pool, identity) = setup();
    let first = prepared(&pool, &header(&identity, "2026-07", "details-july"));
    assert_eq!(first["state"], "FINANCIAL_COLLATION_PREPARED");
    assert_eq!(first["cachedVerifiedRanks"], false);
    let raw = ranks(&pool, &first);
    let done = pool
        .finalize(&bytes(&final_header(&first, false)), raw.as_bytes())
        .unwrap();
    let result: Value = serde_json::from_slice(&done.serialize_current().unwrap()).unwrap();
    assert_eq!(result["state"], "FINANCIAL_COLLATION_READY");
    let intent: FinancialIntent =
        serde_json::from_value(result["scope"]["intent"].clone()).unwrap();
    let proof = pool
        .admission(
            result["token"].as_u64().unwrap(),
            result["digest"].as_str().unwrap(),
            &identity,
            &intent,
            "de-DE-test",
        )
        .unwrap();
    assert!(proof.is_current().unwrap());
    let next = prepared(&pool, &header(&identity, "2026-08", "details-august"));
    assert_eq!(next["cachedVerifiedRanks"], true);
    let done = pool
        .finalize(&bytes(&final_header(&next, true)), b"")
        .unwrap();
    let second: Value = serde_json::from_slice(&done.serialize_current().unwrap()).unwrap();
    let intent = serde_json::from_value(second["scope"]["intent"].clone()).unwrap();
    let next_proof = pool
        .admission(
            second["token"].as_u64().unwrap(),
            second["digest"].as_str().unwrap(),
            &identity,
            &intent,
            "de-DE-test",
        )
        .unwrap();
    assert!(Arc::ptr_eq(proof.ranks(), next_proof.ranks()));
    let stats = pool.stats().unwrap();
    assert_eq!(stats.structure_builds, 1);
    assert_eq!(stats.rank_parses, 1);
    assert_eq!(stats.shared_owners, 1);
    assert_eq!(stats.open_drafts, 0);
    assert_eq!(stats.intent_proofs, 2);
}
#[test]
fn abort_and_same_epoch_reset_fence_resources_and_proof_serialization() {
    let (registry, pool, identity) = setup();
    let first = prepared(&pool, &header(&identity, "2026-07", "details"));
    let page=pool.candidates(&bytes(&json!({"draftId":first["draftId"],"candidateDigest":first["candidateDigest"],"after":null,"limit":7}))).unwrap();
    assert!(
        pool.abort(&bytes(&json!({"draftId":first["draftId"]})))
            .unwrap()
    );
    assert!(page.serialize_current().is_err());
    pool.collect_retired().unwrap();
    let next = prepared(&pool, &header(&identity, "2026-07", "details-next"));
    let raw = ranks(&pool, &next);
    let done = pool
        .finalize(&bytes(&final_header(&next, false)), raw.as_bytes())
        .unwrap();
    registry
        .reset_for_owner(&OwnerIdentity::new("financial-owner", 1).unwrap())
        .unwrap();
    assert!(!done.is_current().unwrap());
    assert!(done.serialize_current().is_err());
}
#[test]
fn source_unavailable_remains_typed_without_a_draft_or_empty_success_pool() {
    for (state, code) in [
        (
            json!({"state":"FAILED","code":"READ_FAILED"}),
            "SOURCE_READ_FAILED",
        ),
        (json!({"state":"LOADING"}), "SOURCE_LOADING"),
        (json!({"state":"NOT_REQUESTED"}), "SOURCE_NOT_REQUESTED"),
    ] {
        let (_, pool, identity) = setup_calendar(Some(state));
        let value = prepared(&pool, &header(&identity, "2026-07", "unavailable"));
        assert_eq!(value["state"], "FINANCIAL_COLLATION_UNAVAILABLE");
        assert_eq!(value["reason"]["code"], code);
        assert_eq!(value["reason"]["source"], "CALENDAR_ENTRIES");
        assert!(value.get("draftId").is_none());
        assert_eq!(pool.stats().unwrap().shared_owners, 0);
    }
}
#[test]
fn raw_rank_shape_membership_budget_and_scope_are_checked_before_native_proof_creation() {
    let (_, pool, identity) = setup();
    let prep = prepared(&pool, &header(&identity, "2026-07", "validation"));
    let raw = ranks(&pool, &prep);
    let value: Value = serde_json::from_str(&raw).unwrap();
    let key = value.as_object().unwrap().keys().next().unwrap().clone();
    let mut invalid = vec![
        b"null".to_vec(),
        b"[]".to_vec(),
        b"{}".to_vec(),
        format!("{raw} trailing").into_bytes(),
    ];
    invalid.push(
        format!(
            "{},{}:0}}",
            &raw[..raw.len() - 1],
            serde_json::to_string(&key).unwrap()
        )
        .into_bytes(),
    );
    for rank in [
        json!(-1),
        json!(0.5),
        json!(100_001),
        json!("private-secret"),
        Value::Null,
        json!(true),
        json!({}),
    ] {
        let mut bad = value.clone();
        bad[&key] = rank;
        invalid.push(bytes(&bad));
    }
    let mut unknown = value.clone();
    unknown["private-secret"] = json!(0);
    invalid.push(bytes(&unknown));
    let mut missing = value.clone();
    missing.as_object_mut().unwrap().remove(&key);
    invalid.push(bytes(&missing));
    invalid.push(vec![
        b' ';
        contract::financial_collation::MAX_RANK_BYTES + 1
    ]);
    for data in invalid {
        let error = pool
            .finalize(&bytes(&final_header(&prep, false)), &data)
            .err()
            .unwrap();
        assert!(!error.to_string().contains("private-secret"));
        assert_eq!(pool.stats().unwrap().intent_proofs, 0);
        assert!(!pool.stats().unwrap().raw_operation);
    }
    assert!(
        pool.finalize(&bytes(&final_header(&prep, true)), b"")
            .is_err()
    );
    let done = pool
        .finalize(&bytes(&final_header(&prep, false)), raw.as_bytes())
        .unwrap();
    let result: Value = serde_json::from_slice(&done.serialize_current().unwrap()).unwrap();
    let intent: FinancialIntent =
        serde_json::from_value(result["scope"]["intent"].clone()).unwrap();
    assert!(
        pool.admission(
            result["token"].as_u64().unwrap(),
            "wrong",
            &identity,
            &intent,
            "de-DE-test"
        )
        .is_err()
    );
    assert!(
        pool.admission(
            result["token"].as_u64().unwrap(),
            result["digest"].as_str().unwrap(),
            &identity,
            &intent,
            "other-locale"
        )
        .is_err()
    );
    let (_, other, other_identity) = setup();
    assert!(
        other
            .admission(
                result["token"].as_u64().unwrap(),
                result["digest"].as_str().unwrap(),
                &other_identity,
                &intent,
                "de-DE-test"
            )
            .is_err()
    );
}
#[test]
fn native_draft_capacity_and_idle_proof_lru_do_not_promise_infinite_retention() {
    let (_, pool, identity) = setup();
    let mut drafts = Vec::new();
    for i in 0..4 {
        drafts.push(prepared(
            &pool,
            &header(&identity, "2026-07", &format!("open-{i}")),
        ));
    }
    let full = prepared(&pool, &header(&identity, "2026-07", "open-fifth"));
    assert_eq!(full["state"], "FINANCIAL_COLLATION_UNAVAILABLE");
    assert_eq!(full["reason"]["code"], "FINANCIAL_COLLATION_RESOURCE_LIMIT");
    for draft in drafts {
        pool.abort(&bytes(&json!({"draftId":draft["draftId"]})))
            .unwrap();
    }
    pool.collect_retired().unwrap();
    let mut receipts = Vec::new();
    for i in 0..10 {
        let prep = prepared(&pool, &header(&identity, "2026-07", &format!("proof-{i}")));
        let raw = if i == 0 {
            ranks(&pool, &prep)
        } else {
            String::new()
        };
        let done = pool
            .finalize(&bytes(&final_header(&prep, i != 0)), raw.as_bytes())
            .unwrap();
        receipts.push(serde_json::from_slice::<Value>(&done.serialize_current().unwrap()).unwrap());
        drop(done);
        pool.collect_retired().unwrap();
    }
    assert_eq!(pool.stats().unwrap().intent_proofs, 8);
    let old = &receipts[0];
    let intent = serde_json::from_value(old["scope"]["intent"].clone()).unwrap();
    assert!(
        pool.admission(
            old["token"].as_u64().unwrap(),
            old["digest"].as_str().unwrap(),
            &identity,
            &intent,
            "de-DE-test"
        )
        .is_err()
    );
    assert_eq!(pool.stats().unwrap().structure_builds, 1);
    assert_eq!(pool.stats().unwrap().rank_parses, 1);
}
#[test]
fn active_proofs_and_two_shared_locale_owners_are_not_evicted_for_new_work() {
    let (_, pool, identity) = setup();
    let mut pinned = Vec::new();
    for i in 0..8 {
        let prep = prepared(&pool, &header(&identity, "2026-07", &format!("pinned-{i}")));
        let raw = if i == 0 {
            ranks(&pool, &prep)
        } else {
            String::new()
        };
        let done = pool
            .finalize(&bytes(&final_header(&prep, i != 0)), raw.as_bytes())
            .unwrap();
        let value: Value = serde_json::from_slice(&done.serialize_current().unwrap()).unwrap();
        let intent = serde_json::from_value(value["scope"]["intent"].clone()).unwrap();
        pinned.push(
            pool.admission(
                value["token"].as_u64().unwrap(),
                value["digest"].as_str().unwrap(),
                &identity,
                &intent,
                "de-DE-test",
            )
            .unwrap(),
        );
    }
    let prep = prepared(&pool, &header(&identity, "2026-08", "pinned-ninth"));
    assert!(
        pool.finalize(&bytes(&final_header(&prep, true)), b"")
            .is_err()
    );
    pinned.pop();
    let done = pool
        .finalize(&bytes(&final_header(&prep, true)), b"")
        .unwrap();
    assert!(done.is_current().unwrap());
    let mut other = header(&identity, "2026-07", "other-locale");
    other["localeKey"] = json!("other-test");
    let second = prepared(&pool, &other);
    assert_eq!(second["state"], "FINANCIAL_COLLATION_PREPARED");
    let mut third = header(&identity, "2026-07", "third-locale");
    third["localeKey"] = json!("third-test");
    let unavailable = prepared(&pool, &third);
    assert_eq!(unavailable["state"], "FINANCIAL_COLLATION_UNAVAILABLE");
    assert_eq!(pool.stats().unwrap().shared_owners, 2);
    assert_eq!(pool.stats().unwrap().structure_builds, 1);
    assert!(pinned.iter().all(|p| p.is_current().unwrap()));
}
#[test]
fn fifty_thousand_rows_build_one_index_and_parse_one_map_across_neighbor_months() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/financial-candidates-golden.json"
    ));
    let prototype = fixture["cases"][0]["input"]["shiftRows"][0].clone();
    let mut ranks = BTreeMap::new();
    let mut strings = std::collections::BTreeSet::new();
    let rows = (0..50_000)
        .map(|index| {
            let mut row = prototype.clone();
            row["id"] = json!(format!("row-{index:05}"));
            for key in ["date", "title", "id", "created_at", "start_time"] {
                strings.insert(row[key].as_str().unwrap_or("").to_owned());
            }
            row
        })
        .collect::<Vec<_>>();
    for (index, text) in strings.into_iter().enumerate() {
        ranks.insert(text, index);
    }
    let calendar = json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":{"shiftRows":rows,"appointmentRows":[],"platformCollationRanks":ranks}}}});
    let (_, pool, identity) = setup_calendar(Some(calendar));
    let prep = prepared(&pool, &header(&identity, "2026-07", "large-july"));
    assert_eq!(prep["state"], "FINANCIAL_COLLATION_PREPARED");
    let mut values = BTreeMap::new();
    let mut after = Value::Null;
    loop {
        let page=pool.candidates(&bytes(&json!({"draftId":prep["draftId"],"candidateDigest":prep["candidateDigest"],"after":after,"limit":1024}))).unwrap();
        let encoded = page.serialize_current().unwrap();
        assert!(encoded.len() <= 1024 * 1024);
        let value: Value = serde_json::from_slice(&encoded).unwrap();
        for text in value["page"]["candidates"].as_array().unwrap() {
            let rank = values.len();
            values.insert(text.as_str().unwrap().to_owned(), rank);
        }
        after = value["page"]["nextAfter"].clone();
        if after.is_null() {
            break;
        }
    }
    assert!(values.len() >= 50_000);
    let raw = serde_json::to_vec(&values).unwrap();
    let first = pool
        .finalize(&bytes(&final_header(&prep, false)), &raw)
        .unwrap();
    assert!(first.is_current().unwrap());
    for month in ["2026-06", "2026-08", "2026-09"] {
        let next = prepared(&pool, &header(&identity, month, &format!("large-{month}")));
        assert_eq!(next["cachedVerifiedRanks"], true);
        let done = pool
            .finalize(&bytes(&final_header(&next, true)), b"")
            .unwrap();
        assert!(done.is_current().unwrap());
    }
    let stats = pool.stats().unwrap();
    assert_eq!(stats.structure_builds, 1);
    assert_eq!(stats.rank_parses, 1);
    assert!(stats.retained_bytes <= 32 * 1024 * 1024);
}
