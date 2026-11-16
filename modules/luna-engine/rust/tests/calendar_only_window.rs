mod common;
#[path = "support/snapshot.rs"]
mod snapshot;
use luna_engine::{
    contract::{self, OwnerIdentity, RevisionFence, SourceState, ValidatedRequest},
    runtime::{
        SnapshotRegistry,
        calendar_window::{CalendarWindowPool, Completion},
    },
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
fn bytes(v: &Value) -> Vec<u8> {
    serde_json::to_vec(v).unwrap()
}
fn original() -> Value {
    let data: Value = serde_json::from_str(include_str!(
        "../../reference/calendar-templates-golden.json"
    ))
    .unwrap();
    data["cases"][0].clone()
}
fn source(value: Value) -> SourceState {
    serde_json::from_value(json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":value}}})).unwrap()
}
fn setup() -> (SnapshotRegistry, CalendarWindowPool, Value) {
    let r = SnapshotRegistry::default();
    r.reset_for_owner(&OwnerIdentity::new("calendar-owner", 1).unwrap())
        .unwrap();
    let mut raw = original()["input"].clone();
    raw["platformCollationRanks"] = json!({});
    let marker = r
        .start_calendar_rows(&r.calendar_rows_marker().unwrap(), 1)
        .unwrap();
    let id = r.register_calendar_rows(&marker, 1, &source(raw)).unwrap();
    let pool = CalendarWindowPool::new(r.clone());
    (r, pool, serde_json::to_value(id).unwrap())
}
fn request(id: &Value, name: &str, revision: u64) -> Value {
    json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"calendar-owner","ownerEpoch":1,"requestId":name,"draftRevision":revision},"source":{"kind":"CALENDAR_ONLY","identity":id},"spec":{"kind":"PROTOTYPE_YEAR","year":"2026"},"options":{"showAppointments":true,"showShifts":true},"localeKey":"original-default-locale"})
}
fn reply(c: &Completion) -> Value {
    serde_json::from_slice(&c.serialize_current().unwrap()).unwrap()
}
fn finish(p: &CalendarWindowPool, prepared: &Value) -> Value {
    let mut candidates = Vec::new();
    let mut after = Value::Null;
    loop {
        let page=reply(&p.candidates(&bytes(&json!({"resourceId":prepared["resourceId"],"candidateDigest":prepared["candidateDigest"],"after":after,"limit":2}))).unwrap());
        candidates.extend(
            page["page"]["candidates"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_owned()),
        );
        after = page["page"]["nextAfter"].clone();
        if after.is_null() {
            break;
        }
    }
    let case = original();
    let ranks = &case["input"]["platformCollationRanks"];
    let numeric = candidates
        .iter()
        .map(|s| ranks[s].as_u64().unwrap())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let selected = candidates
        .into_iter()
        .map(|s| {
            let rank = numeric.binary_search(&ranks[&s].as_u64().unwrap()).unwrap() as u32;
            (s, rank)
        })
        .collect::<BTreeMap<_, _>>();
    p.finalize(&bytes(&json!({"resourceId":prepared["resourceId"],"candidateDigest":prepared["candidateDigest"]})),&serde_json::to_vec(&selected).unwrap()).unwrap();
    reply(&p.read(&bytes(&json!({"resourceId":prepared["resourceId"],"view":"EXPANDED","after":null,"limit":1024}))).unwrap())
}
#[test]
fn independent_calendar_source_reaches_original_window_rows_without_financial_snapshot_or_profile()
{
    let (_, p, id) = setup();
    let prepared = reply(&p.prepare(&bytes(&request(&id, "calendar", 1))).unwrap());
    assert_eq!(prepared["state"], "CALENDAR_WINDOW_PREPARED");
    assert_eq!(prepared["scope"]["source"]["kind"], "CALENDAR_ONLY");
    assert!(prepared["scope"]["guard"].get("snapshot").is_none());
    let rows = finish(&p, &prepared);
    common::assert_json_eq(
        &rows["page"]["items"],
        &original()["expected"],
        "native CalendarOnly original template SQL window",
    );
}
#[test]
fn native_visible_indices_page_without_duplicating_full_records_and_keep_filter_order() {
    for show in [true, false] {
        let (_, p, id) = setup();
        let mut query = request(&id, "indices", 1);
        query["options"]["showShifts"] = json!(show);
        let prepared = reply(&p.prepare(&bytes(&query)).unwrap());
        let rows = finish(&p, &prepared);
        let count = rows["page"]["items"].as_array().unwrap().len();
        let mut actual = Vec::<Value>::new();
        let mut after = Value::Null;
        loop {
            let page = reply(&p.read(&bytes(&json!({"resourceId":prepared["resourceId"],"view":"VISIBLE_INDICES","after":after,"limit":1}))).unwrap());
            assert_eq!(page["view"], "VISIBLE_INDICES");
            let items = page["page"]["items"].as_array().unwrap();
            assert!(items.iter().all(|v| v.as_u64().is_some()));
            actual.extend(items.iter().cloned());
            after = page["page"]["nextAfter"].clone();
            if after.is_null() {
                break;
            }
        }
        let expected = if show {
            (0..count).map(|i| json!(i)).collect::<Vec<_>>()
        } else {
            vec![]
        };
        assert_eq!(actual, expected);
    }
}
#[test]
fn financial_revision_and_clock_source_changes_leave_calendar_window_current_but_row_change_does_not()
 {
    let (r, p, id) = setup();
    let completion = p.prepare(&bytes(&request(&id, "calendar", 1))).unwrap();
    let before = reply(&completion);
    r.advance_revision(
        &RevisionFence::new(OwnerIdentity::new("calendar-owner", 1).unwrap(), 7).unwrap(),
    )
    .unwrap();
    let raw = snapshot::raw_snapshot(7, "calendar-owner", 1);
    let frame = json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}});
    let ValidatedRequest::RegisterSnapshot(financial) =
        contract::parse_request(&bytes(&frame)).unwrap()
    else {
        panic!("snapshot")
    };
    r.register(financial).unwrap();
    assert!(completion.is_current().unwrap());
    r.start_calendar_clock(&r.calendar_clock_marker().unwrap(), 3)
        .unwrap();
    assert!(completion.is_current().unwrap());
    finish(&p, &before);
    r.start_calendar_rows(&r.calendar_rows_marker().unwrap(), 2)
        .unwrap();
    assert!(!completion.is_current().unwrap());
    assert!(completion.serialize_current().is_err());
}
#[test]
fn tagged_locators_owner_draft_and_same_epoch_reset_are_fail_closed() {
    let (r, p, id) = setup();
    let first = p.prepare(&bytes(&request(&id, "same-screen", 1))).unwrap();
    let next = p.prepare(&bytes(&request(&id, "same-screen", 2))).unwrap();
    assert!(!first.is_current().unwrap());
    assert!(next.is_current().unwrap());
    let mut injected = request(&id, "bad", 1);
    injected["guard"]["snapshot"] = json!({"ownerScope":"calendar-owner","ownerEpoch":1,"snapshotId":"fake","snapshotRevision":1,"inputDigest":"a".repeat(64),"catalogDigest":"b".repeat(64)});
    assert!(p.prepare(&bytes(&injected)).is_err());
    for (field, value) in [
        ("kind", json!("CALENDAR_CLOCK")),
        ("ownerEpoch", json!(2)),
        ("sourceDigest", json!("f".repeat(64))),
    ] {
        let mut bad = request(&id, "bad", 1);
        bad["source"]["identity"][field] = value;
        assert!(p.prepare(&bytes(&bad)).is_err());
    }
    r.reset_for_owner(&OwnerIdentity::new("calendar-owner", 1).unwrap())
        .unwrap();
    assert!(!next.is_current().unwrap());
    assert!(next.serialize_current().is_err());
}
#[test]
fn loading_calendar_rows_remain_unavailable_without_fake_empty_resource() {
    let (r, p, _) = setup();
    let marker = r
        .start_calendar_rows(&r.calendar_rows_marker().unwrap(), 2)
        .unwrap();
    let id = r
        .register_calendar_rows(&marker, 2, &SourceState::Loading)
        .unwrap();
    let output = reply(
        &p.prepare(&bytes(&request(
            &serde_json::to_value(id).unwrap(),
            "loading",
            1,
        )))
        .unwrap(),
    );
    assert_eq!(output["state"], "CALENDAR_WINDOW_UNAVAILABLE");
    assert_eq!(output["reason"]["code"], "SOURCE_LOADING");
    assert!(output.get("resourceId").is_none());
}
