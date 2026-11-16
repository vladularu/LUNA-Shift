mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{self, OwnerIdentity, RevisionFence, SourceState},
    runtime::{
        SnapshotRegistry,
        calendar_window::{CalendarWindowPool, Completion},
    },
};
use serde_json::{Value, json};
fn bytes(v: &Value) -> Vec<u8> {
    serde_json::to_vec(v).unwrap()
}
fn read(c: &Completion) -> Value {
    serde_json::from_slice(&c.serialize_current().unwrap()).unwrap()
}
fn null() -> SourceState {
    serde_json::from_value(json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"NULL"}}})).unwrap()
}
fn setup() -> (SnapshotRegistry, CalendarWindowPool, Value) {
    let r = SnapshotRegistry::default();
    r.reset_for_owner(&OwnerIdentity::new("navigation-owner", 1).unwrap())
        .unwrap();
    let s:SourceState=serde_json::from_value(json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":{"shiftRows":[],"appointmentRows":[],"templateRows":[],"platformCollationRanks":{}}}}})).unwrap();
    let marker = r
        .start_calendar_rows(&r.calendar_rows_marker().unwrap(), 1)
        .unwrap();
    let id = r.register_calendar_rows(&marker, 1, &s).unwrap();
    (
        r.clone(),
        CalendarWindowPool::new(r),
        serde_json::to_value(id).unwrap(),
    )
}
fn clock(r: &SnapshotRegistry, revision: u64, epoch: i64, failed: bool) -> Value {
    let marker = r
        .start_calendar_clock(&r.calendar_clock_marker().unwrap(), revision)
        .unwrap();
    let source = if failed { SourceState::Loading } else { null() };
    serde_json::to_value(
        r.register_calendar_clock(
            &marker,
            revision,
            &source,
            &SourceState::NotRequested,
            epoch,
        )
        .unwrap(),
    )
    .unwrap()
}
fn request(rows: &Value, clock: &Value, epoch: i64, options: &Value, name: &str) -> Value {
    json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,
      "guard":{"ownerScope":"navigation-owner","ownerEpoch":1,"requestId":name,"draftRevision":1},
      "source":{"kind":"CALENDAR_ONLY","identity":rows},"spec":{"kind":"MONTHS","months":[options["anchorMonth"]]},
      "options":{"showAppointments":true,"showShifts":true},"localeKey":"original-default",
      "presentation":{"clockIdentity":clock,"observedEpochMilliseconds":epoch,"anchorMonth":options["anchorMonth"],"selectedDate":options["selectedDate"],"before":options["before"],"after":options["after"]}})
}
fn finish(p: &CalendarWindowPool, prepared: &Value) -> Value {
    let header =
        json!({"resourceId":prepared["resourceId"],"candidateDigest":prepared["candidateDigest"]});
    p.finalize(&bytes(&header), b"{}").unwrap();
    read(&p.read(&bytes(&json!({"resourceId":prepared["resourceId"],"view":"NAVIGATION","after":null,"limit":1}))).unwrap())
}
#[test]
fn all_original_navigation_frames_bind_a_real_independent_clock_and_share_the_rows_index() {
    let (r, p, rows) = setup();
    let corpus = value_pool::decode(include_str!(
        "../../reference/calendar-navigation-golden.json"
    ));
    for (i, case) in corpus["cases"].as_array().unwrap().iter().enumerate() {
        let instant = format!(
            "{}T12:00:00Z",
            case["input"]["referenceDate"].as_str().unwrap()
        )
        .parse::<jiff::Timestamp>()
        .unwrap()
        .as_millisecond();
        let id = clock(&r, i as u64 + 1, instant, false);
        let query = request(
            &rows,
            &id,
            instant,
            &case["input"],
            &format!("navigation-{i}"),
        );
        let prepared = read(&p.prepare(&bytes(&query)).unwrap());
        let page = finish(&p, &prepared);
        assert_eq!(page["page"]["total"], 1);
        let frame = &page["page"]["items"][0];
        common::assert_json_eq(
            &frame["navigation"],
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
        assert_eq!(
            frame["clock"]["referenceDate"],
            case["input"]["referenceDate"]
        );
        assert_eq!(frame["clock"]["cacheable"], true);
        assert!(frame.get("profile").is_none());
        p.abort(&bytes(&json!({"resourceId":prepared["resourceId"]})))
            .unwrap();
    }
    assert_eq!(p.stats().unwrap().source_indices, 1);
}
#[test]
fn clock_change_and_reset_fence_frames_but_finance_revision_does_not() {
    let (r, p, rows) = setup();
    let epoch = 1794398400000i64;
    let id = clock(&r, 1, epoch, false);
    let options = json!({"anchorMonth":"2026-11","selectedDate":null,"before":24,"after":36});
    let prepared = p
        .prepare(&bytes(&request(&rows, &id, epoch, &options, "clock-fence")))
        .unwrap();
    let meta = read(&prepared);
    finish(&p, &meta);
    r.advance_revision(
        &RevisionFence::new(OwnerIdentity::new("navigation-owner", 1).unwrap(), 7).unwrap(),
    )
    .unwrap();
    assert!(prepared.is_current().unwrap());
    r.start_calendar_clock(&r.calendar_clock_marker().unwrap(), 2)
        .unwrap();
    assert!(!prepared.is_current().unwrap());
    assert!(prepared.serialize_current().is_err());
    let id = clock(&r, 3, epoch, false);
    let next = p
        .prepare(&bytes(&request(&rows, &id, epoch, &options, "next")))
        .unwrap();
    r.reset_for_owner(&OwnerIdentity::new("navigation-owner", 1).unwrap())
        .unwrap();
    assert!(!next.is_current().unwrap());
}
#[test]
fn degraded_clock_is_explicitly_transient_and_untrusted_or_expired_clock_claims_fail_closed() {
    let (r, p, rows) = setup();
    let epoch = 1794398400000i64;
    let options = json!({"anchorMonth":"2026-11","selectedDate":null,"before":24,"after":36});
    let id = clock(&r, 1, epoch, true);
    let q = request(&rows, &id, epoch, &options, "degraded");
    let prepared = read(&p.prepare(&bytes(&q)).unwrap());
    let frame = finish(&p, &prepared)["page"]["items"][0].clone();
    assert_eq!(frame["clock"]["cacheable"], false);
    assert_eq!(frame["clock"]["origin"], "DEGRADED_BERLIN");
    let mut bad = q.clone();
    bad["presentation"]["observedEpochMilliseconds"] = json!(epoch + 1);
    assert!(p.prepare(&bytes(&bad)).is_err());
    bad = q.clone();
    bad["presentation"]["clockIdentity"]["ownerEpoch"] = json!(2);
    assert!(p.prepare(&bytes(&bad)).is_err());
    bad = q.clone();
    bad["presentation"] = Value::Null;
    assert!(p.prepare(&bytes(&bad)).is_err());
    bad = q.clone();
    bad["presentation"]["before"] = json!(128);
    assert!(p.prepare(&bytes(&bad)).is_err());
    bad = q.clone();
    bad["presentation"]["referenceDate"] = json!("2099-01-01");
    assert!(p.prepare(&bytes(&bad)).is_err());
    bad = q.clone();
    bad["presentation"]
        .as_object_mut()
        .unwrap()
        .remove("selectedDate");
    assert!(p.prepare(&bytes(&bad)).is_err());
    bad = q.clone();
    bad["presentation"]["anchorMonth"] = json!("2028-01");
    assert!(p.prepare(&bytes(&bad)).is_err());
    let id = clock(&r, 2, epoch, false);
    let expired = request(&rows, &id, epoch + 86_400_000, &options, "expired");
    assert!(p.prepare(&bytes(&expired)).is_err());
}

#[test]
fn largest_navigation_frame_remains_charged_after_finalize_and_old_requests_have_no_new_scope_fields()
 {
    let (r, p, rows) = setup();
    let epoch = 1794398400000i64;
    let id = clock(&r, 1, epoch, false);
    let options = json!({"anchorMonth":"2026-11","selectedDate":null,"before":63,"after":64});
    let mut q = request(&rows, &id, epoch, &options, "large");
    let meta = read(&p.prepare(&bytes(&q)).unwrap());
    let page = finish(&p, &meta);
    let frame = &page["page"]["items"][0];
    assert_eq!(frame["navigation"]["grids"].as_array().unwrap().len(), 128);
    let body_bytes = serde_json::to_vec(frame).unwrap().len() as u64;
    assert!(body_bytes < 1024 * 1024 - 16384);
    assert!(p.stats().unwrap().retained_bytes >= body_bytes * 2);
    q.as_object_mut().unwrap().remove("presentation");
    q["guard"]["requestId"] = json!("old-wire");
    let old = read(&p.prepare(&bytes(&q)).unwrap());
    assert!(old["scope"].get("presentation").is_none());
    assert_eq!(old["scope"].as_object().unwrap().len(), 5);
    p.finalize(
        &bytes(&json!({"resourceId":old["resourceId"],"candidateDigest":old["candidateDigest"]})),
        b"{}",
    )
    .unwrap();
    assert!(
        p.read(&bytes(
            &json!({"resourceId":old["resourceId"],"view":"NAVIGATION","after":null,"limit":1})
        ))
        .is_err()
    );
}
