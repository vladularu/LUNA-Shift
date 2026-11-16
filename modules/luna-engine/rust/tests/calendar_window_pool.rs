mod common;
#[path = "support/snapshot.rs"]
mod snapshot;
use luna_engine::{
    contract::{
        self, ImmutableSnapshot, OwnerIdentity, SnapshotIdentity, SourceKind, ValidatedRequest,
        utility::{UtilityGuard, UtilityKind},
    },
    runtime::{
        SnapshotRegistry,
        calendar_window::{CalendarWindowPool, WindowPoolError},
    },
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
fn bytes(value: &Value) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}
fn original() -> Value {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../reference/input-calendar-rows-golden.json"
    ))
    .unwrap();
    corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "expandedStoredRows-395")
        .unwrap()
        .clone()
}
fn source(value: Value) -> Value {
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":value}}})
}
fn make_snapshot(state: Option<Value>, revision: u64) -> ImmutableSnapshot {
    let case = original();
    let mut raw = snapshot::raw_snapshot(revision, "calendar-owner", 1);
    for group in raw["sources"].as_array_mut().unwrap() {
        if group["kind"] == json!(SourceKind::CalendarEntries) {
            group["source"]=state.clone().unwrap_or_else(||source(json!({"shiftRows":case["input"]["shiftRows"],"appointmentRows":case["input"]["appointmentRows"],"platformCollationRanks":case["storedPlatformCollationRanks"]})));
        }
        if group["kind"] == json!(SourceKind::WorkProfile) {
            group["source"] = json!({"state":"FAILED","code":"READ_FAILED"});
        }
    }
    raw["catalogs"]["current"]["tariff"] = json!({"state":"FAILED","code":"UNAVAILABLE"});
    snapshot::seal(&mut raw);
    let parsed=contract::parse_request(&bytes(&json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}}))).unwrap();
    let snapshot: ImmutableSnapshot = match parsed {
        ValidatedRequest::RegisterSnapshot(s) => s,
        _ => panic!("snapshot"),
    };
    snapshot
}
fn setup(state: Option<Value>) -> (SnapshotRegistry, CalendarWindowPool, SnapshotIdentity) {
    let snapshot = make_snapshot(state, 1);
    let identity = snapshot.identity().clone();
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("calendar-owner", 1).unwrap())
        .unwrap();
    registry.register(snapshot).unwrap();
    let pool = CalendarWindowPool::new(registry.clone());
    (registry, pool, identity)
}

#[test]
fn third_pinned_source_is_refused_before_admitting_another_native_index() {
    let (registry, pool, first) = setup(None);
    let retain_index = |identity: &SnapshotIdentity| {
        let guard:UtilityGuard=serde_json::from_value(json!({"ownerScope":"calendar-owner","ownerEpoch":1,"requestId":format!("index-{}",identity.snapshot_revision()),"draftRevision":1,"snapshot":identity})).unwrap();
        let lease = registry
            .lease_utility(
                &registry.utility_owner_marker().unwrap(),
                &guard,
                UtilityKind::MonthGrid,
            )
            .unwrap();
        lease
            .facts()
            .unwrap()
            .calendar_window_index()
            .unwrap()
            .clone()
    };
    let first_index = retain_index(&first);
    assert_eq!(
        prepare(&pool, &first, "first-source")["state"],
        "CALENDAR_WINDOW_PREPARED"
    );
    let second = make_snapshot(None, 2);
    let second_id = second.identity().clone();
    registry.register(second).unwrap();
    let second_index = retain_index(&second_id);
    assert_eq!(
        prepare(&pool, &second_id, "second-source")["state"],
        "CALENDAR_WINDOW_PREPARED"
    );
    let third = make_snapshot(None, 3);
    let third_id = third.identity().clone();
    registry.register(third).unwrap();
    let denied = prepare(&pool, &third_id, "third-source");
    assert_eq!(denied["state"], "CALENDAR_WINDOW_UNAVAILABLE");
    assert_eq!(denied["reason"]["code"], "CALENDAR_WINDOW_RESOURCE_LIMIT");
    assert_eq!(pool.stats().unwrap().source_indices, 2);
    drop(first_index);
    registry.collect_retired().unwrap();
    pool.collect_retired().unwrap();
    assert_eq!(
        prepare(&pool, &third_id, "third-source-retry")["state"],
        "CALENDAR_WINDOW_PREPARED"
    );
    assert_eq!(pool.stats().unwrap().source_indices, 2);
    drop(second_index);
}
fn header(identity: &SnapshotIdentity, id: &str) -> Value {
    json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"calendar-owner","ownerEpoch":1,"requestId":id,"draftRevision":1},"source":{"kind":"REPORT_SNAPSHOT","identity":identity},"spec":{"kind":"DAY","date":"2026-03-01"},"options":{"showAppointments":true,"showShifts":true},"localeKey":"original-platform-default"})
}
fn reply(completion: &luna_engine::runtime::calendar_window::Completion) -> Value {
    serde_json::from_slice(&completion.serialize_current().unwrap()).unwrap()
}
fn prepare(pool: &CalendarWindowPool, identity: &SnapshotIdentity, id: &str) -> Value {
    reply(&pool.prepare(&bytes(&header(identity, id))).unwrap())
}
fn candidates(pool: &CalendarWindowPool, prepared: &Value) -> Vec<String> {
    let mut result = Vec::new();
    let mut after = Value::Null;
    loop {
        let page=reply(&pool.candidates(&bytes(&json!({"resourceId":prepared["resourceId"],"candidateDigest":prepared["candidateDigest"],"after":after,"limit":2}))).unwrap());
        assert_eq!(page["scope"], prepared["scope"]);
        result.extend(
            page["page"]["candidates"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_owned()),
        );
        after = page["page"]["nextAfter"].clone();
        if after.is_null() {
            assert_eq!(result.len() as u64, page["page"]["total"].as_u64().unwrap());
            return result;
        }
    }
}
fn ranks(pool: &CalendarWindowPool, prepared: &Value) -> String {
    let strings = candidates(pool, prepared);
    let original = original();
    let authoritative = &original["platformCollationRanks"];
    let numeric = strings
        .iter()
        .map(|s| {
            authoritative[s]
                .as_u64()
                .expect("original candidate coverage")
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    serde_json::to_string(
        &strings
            .iter()
            .map(|s| {
                (
                    s,
                    numeric
                        .binary_search(&authoritative[s].as_u64().unwrap())
                        .unwrap(),
                )
            })
            .collect::<BTreeMap<_, _>>(),
    )
    .unwrap()
}
fn finalize_header(prepared: &Value) -> Value {
    json!({"resourceId":prepared["resourceId"],"candidateDigest":prepared["candidateDigest"]})
}
fn read(pool: &CalendarWindowPool, id: &Value, view: &str) -> Vec<Value> {
    let mut result = Vec::new();
    let mut after = Value::Null;
    loop {
        let page = reply(
            &pool
                .read(&bytes(
                    &json!({"resourceId":id,"view":view,"after":after,"limit":1}),
                ))
                .unwrap(),
        );
        assert_eq!(page["view"], view);
        result.extend(page["page"]["items"].as_array().unwrap().iter().cloned());
        after = page["page"]["nextAfter"].clone();
        if after.is_null() {
            assert_eq!(result.len() as u64, page["page"]["total"].as_u64().unwrap());
            return result;
        }
    }
}
#[test]
fn raw_repository_rows_flow_through_current_resources_to_the_complete_original_occurrences() {
    let (_, pool, identity) = setup(None);
    let prepared = prepare(&pool, &identity, "original");
    assert_eq!(prepared["state"], "CALENDAR_WINDOW_PREPARED");
    let raw = ranks(&pool, &prepared);
    let ready = reply(
        &pool
            .finalize(&bytes(&finalize_header(&prepared)), raw.as_bytes())
            .unwrap(),
    );
    assert_eq!(ready["state"], "CALENDAR_WINDOW_READY");
    assert_eq!(ready["scope"], prepared["scope"]);
    let expanded = read(&pool, &ready["resourceId"], "EXPANDED");
    common::assert_json_eq(
        &json!(expanded),
        &original()["expected"]["value"],
        "original repository -> native window resource",
    );
    assert_eq!(read(&pool, &ready["resourceId"], "VISIBLE"), expanded);
    for (_, indices) in read(&pool, &ready["resourceId"], "DATES")
        .iter()
        .map(|v| (v[0].as_str().unwrap(), v[1].as_array().unwrap()))
    {
        for index in indices {
            assert!((index.as_u64().unwrap() as usize) < expanded.len());
        }
    }
    assert_eq!(pool.stats().unwrap().source_indices, 1);
    assert_eq!(pool.stats().unwrap().rank_parses, 1);
}
#[test]
fn missing_loading_failed_null_and_incomplete_calendar_are_typed_unavailable_without_a_resource() {
    let cases = [
        (json!({"state":"NOT_REQUESTED"}), "SOURCE_NOT_REQUESTED"),
        (json!({"state":"LOADING"}), "SOURCE_LOADING"),
        (
            json!({"state":"FAILED","code":"READ_FAILED"}),
            "SOURCE_READ_FAILED",
        ),
        (
            json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"NULL"}}}),
            "SOURCE_NULL",
        ),
        (
            json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"MISSING"}}}),
            "SOURCE_MISSING",
        ),
        (
            json!({"state":"READY","revision":1,"coverage":{"kind":"DATE_RANGES","ranges":[{"start":"2026-01-01","end":"2026-12-31"}]},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":{}}}}),
            "SOURCE_INCOMPLETE",
        ),
    ];
    for (state, code) in cases {
        let (_, pool, id) = setup(Some(state));
        let result = prepare(&pool, &id, "unavailable");
        assert_eq!(result["state"], "CALENDAR_WINDOW_UNAVAILABLE");
        assert_eq!(result["reason"]["code"], code);
        assert!(result.get("resourceId").is_none());
        assert_eq!(pool.stats().unwrap().drafts, 0);
    }
    let (_, pool, id) = setup(Some(source(
        json!({"shiftRows":[],"appointmentRows":[],"platformCollationRanks":{}}),
    )));
    let prepared = prepare(&pool, &id, "empty-is-real");
    let done = reply(
        &pool
            .finalize(&bytes(&finalize_header(&prepared)), b"{}")
            .unwrap(),
    );
    assert_eq!(done["projectedCount"], 0);
    assert!(read(&pool, &done["resourceId"], "EXPANDED").is_empty());
}
#[test]
fn malformed_or_incomplete_rank_maps_never_consume_preparation_into_fake_ready() {
    let (_, pool, id) = setup(None);
    let prepared = prepare(&pool, &id, "ranks");
    let header = bytes(&finalize_header(&prepared));
    let valid = ranks(&pool, &prepared);
    let map: Value = serde_json::from_str(&valid).unwrap();
    let key = map.as_object().unwrap().keys().next().unwrap();
    let mut missing = map.clone();
    missing.as_object_mut().unwrap().remove(key);
    let mut foreign = map.clone();
    foreign["foreign-unrequested-title"] = json!(0);
    let mut fractional = map.clone();
    fractional[key] = json!(0.5);
    let mut outside = map.clone();
    outside[key] = json!(u32::MAX);
    let duplicate = format!(
        "{{{}:0,{}:0}}",
        serde_json::to_string(key).unwrap(),
        serde_json::to_string(key).unwrap()
    );
    for raw in [
        "{}".to_owned(),
        missing.to_string(),
        foreign.to_string(),
        fractional.to_string(),
        outside.to_string(),
        duplicate,
        format!("{valid}[]"),
    ] {
        assert_eq!(
            pool.finalize(&header, raw.as_bytes()).unwrap_err(),
            WindowPoolError::InvalidRanks
        );
        assert_eq!(pool.stats().unwrap().ready, 0);
    }
    assert_eq!(
        reply(&pool.finalize(&header, valid.as_bytes()).unwrap())["state"],
        "CALENDAR_WINDOW_READY"
    );
    assert_eq!(
        pool.finalize(&header, valid.as_bytes()).unwrap_err(),
        WindowPoolError::AlreadyReady
    );
}
#[test]
fn abort_and_same_owner_reset_fence_already_retained_completions_and_never_reuse_ids() {
    let (registry, pool, id) = setup(None);
    let completion = pool.prepare(&bytes(&header(&id, "old"))).unwrap();
    let prepared = reply(&completion);
    let page=pool.candidates(&bytes(&json!({"resourceId":prepared["resourceId"],"candidateDigest":prepared["candidateDigest"],"after":null,"limit":1}))).unwrap();
    assert!(
        pool.abort(&bytes(&json!({"resourceId":prepared["resourceId"]})))
            .unwrap()
    );
    assert!(!completion.is_current().unwrap());
    assert_eq!(
        page.serialize_current().unwrap_err(),
        WindowPoolError::Stale
    );
    assert_eq!(pool.collect_retired().unwrap().retired, 1);
    drop(page);
    drop(completion);
    assert_eq!(pool.collect_retired().unwrap().retired, 0);
    let second = pool.prepare(&bytes(&header(&id, "second"))).unwrap();
    let second_value = reply(&second);
    assert_ne!(second_value["resourceId"], prepared["resourceId"]);
    registry
        .reset_for_owner(&OwnerIdentity::new("calendar-owner", 1).unwrap())
        .unwrap();
    assert!(!second.is_current().unwrap());
    assert_eq!(
        second.serialize_current().unwrap_err(),
        WindowPoolError::Stale
    );
}
#[test]
fn active_drafts_are_bounded_and_only_unpinned_idle_resources_are_evicted() {
    let (_, pool, id) = setup(None);
    let pinned = (0..4)
        .map(|i| {
            pool.prepare(&bytes(&header(&id, &format!("pinned-{i}"))))
                .unwrap()
        })
        .collect::<Vec<_>>();
    let denied = prepare(&pool, &id, "over-capacity");
    assert_eq!(denied["state"], "CALENDAR_WINDOW_UNAVAILABLE");
    assert_eq!(denied["reason"]["code"], "CALENDAR_WINDOW_RESOURCE_LIMIT");
    assert!(pinned.iter().all(|c| c.is_current().unwrap()));
    drop(pinned);
    assert_eq!(
        prepare(&pool, &id, "idle-can-retire")["state"],
        "CALENDAR_WINDOW_PREPARED"
    );
    assert!(pool.stats().unwrap().drafts <= 4);
    assert!(pool.stats().unwrap().retained_bytes <= 32 * 1024 * 1024);
}
#[test]
fn one_native_index_is_shared_and_control_retirement_cannot_drop_the_last_row_owner() {
    let (registry, pool, id) = setup(None);
    let guard:UtilityGuard=serde_json::from_value(json!({"ownerScope":"calendar-owner","ownerEpoch":1,"requestId":"reader","draftRevision":1,"snapshot":id})).unwrap();
    let lease = registry
        .lease_utility(
            &registry.utility_owner_marker().unwrap(),
            &guard,
            UtilityKind::MonthGrid,
        )
        .unwrap();
    let facts = lease.facts().unwrap();
    let first = facts.calendar_window_index().unwrap();
    let second = facts.calendar_window_index().unwrap();
    assert!(Arc::ptr_eq(first, second));
    let rows = Arc::downgrade(first.source_entries());
    drop(lease);
    let completion = pool.prepare(&bytes(&header(&id, "keep-owner"))).unwrap();
    let prepared = reply(&completion);
    registry
        .reset_for_owner(&OwnerIdentity::new("calendar-owner", 1).unwrap())
        .unwrap();
    registry.collect_retired().unwrap();
    assert!(
        pool.abort(&bytes(&json!({"resourceId":prepared["resourceId"]})))
            .unwrap()
    );
    assert!(rows.upgrade().is_some());
    assert_eq!(pool.collect_retired().unwrap().retired, 1);
    drop(completion);
    assert!(rows.upgrade().is_some());
    assert_eq!(pool.collect_retired().unwrap().retired, 0);
    assert!(rows.upgrade().is_none());
}

#[test]
fn fifty_thousand_sql_rows_keep_one_native_index_for_neighbor_windows() {
    // Explicit synthetic equality ranks exercise ownership, not locale parity.
    // The separate frozen cases remain the authority for comparator behavior.
    let case = original();
    let seed = &case["input"]["appointmentRows"][0];
    let mut rank_map = BTreeMap::<String, u32>::new();
    for text in [
        "2026-03-01",
        "2026-03-02",
        "Owned",
        "08:00",
        seed["created_at"].as_str().unwrap(),
    ] {
        rank_map.insert(text.to_owned(), 0);
    }
    let rows = (0..50_000)
        .map(|index| {
            let mut row = seed.clone();
            let id = format!("owned-{index:05}");
            rank_map.insert(id.clone(), 0);
            row["id"] = json!(id);
            row["date"] = json!(if index % 2 == 0 {
                "2026-03-01"
            } else {
                "2026-03-02"
            });
            row["title"] = json!("Owned");
            row["all_day"] = json!(0);
            row["start_time"] = json!("08:00");
            row["end_time"] = json!("09:00");
            row["deleted_at"] = Value::Null;
            row["recurrence_frequency"] = Value::Null;
            row["recurrence_interval"] = Value::Null;
            row
        })
        .collect::<Vec<_>>();
    let (registry, pool, id) = setup(Some(source(
        json!({"shiftRows":[],"appointmentRows":rows,"platformCollationRanks":rank_map}),
    )));
    let guard:UtilityGuard=serde_json::from_value(json!({"ownerScope":"calendar-owner","ownerEpoch":1,"requestId":"large-reader","draftRevision":1,"snapshot":id})).unwrap();
    let lease = registry
        .lease_utility(
            &registry.utility_owner_marker().unwrap(),
            &guard,
            UtilityKind::MonthGrid,
        )
        .unwrap();
    let index = lease
        .facts()
        .unwrap()
        .calendar_window_index()
        .unwrap()
        .clone();
    assert_eq!(index.source_entries().len(), 50_000);
    let first = prepare(&pool, &id, "large-first");
    let mut second_header = header(&id, "large-second");
    second_header["spec"]["date"] = json!("2026-03-02");
    let second = reply(&pool.prepare(&bytes(&second_header)).unwrap());
    assert_eq!(first["projectedCount"], 25_000);
    assert_eq!(second["projectedCount"], 25_000);
    assert_eq!(pool.stats().unwrap().source_indices, 1);
    assert_eq!(pool.stats().unwrap().preparations, 2);
    assert!(Arc::ptr_eq(
        &index,
        lease.facts().unwrap().calendar_window_index().unwrap()
    ));
    assert!(pool.stats().unwrap().retained_bytes <= 32 * 1024 * 1024);
}
