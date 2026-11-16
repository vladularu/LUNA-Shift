use luna_engine::contract::{self, calendar_window::*};
use serde_json::{Value, json};
fn bytes(value: &Value) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}
fn header() -> Value {
    json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"calendar-owner","ownerEpoch":1,"requestId":"window-2026","draftRevision":1},"source":{"kind":"REPORT_SNAPSHOT","identity":{"ownerScope":"calendar-owner","ownerEpoch":1,"snapshotId":"snapshot","snapshotRevision":1,"inputDigest":"a".repeat(64),"catalogDigest":"b".repeat(64)}},"spec":{"kind":"CALENDAR_YEAR","year":"2026"},"options":{"showAppointments":true,"showShifts":false},"localeKey":"default-source-locale"})
}
#[test]
fn closed_prepare_versions_source_identity_and_scalar_window_do_not_create_a_ready_claim() {
    let original = header();
    let parsed = parse_prepare(&bytes(&original)).unwrap();
    assert!(parsed.guard().snapshot().is_none());
    assert!(parsed.report_snapshot_guard().unwrap().snapshot().is_some());
    assert_eq!(parsed.spec().bounds().unwrap().start_date, "2025-10-27");
    assert!(!parsed.options().show_shifts);
    for field in [
        "wireSchemaVersion",
        "expectedEngineVersion",
        "calculationContractVersion",
        "guard",
        "source",
        "spec",
        "options",
        "localeKey",
    ] {
        let mut bad = original.clone();
        bad.as_object_mut().unwrap().remove(field);
        assert!(parse_prepare(&bytes(&bad)).is_err(), "missing {field}");
    }
    for (field, value) in [
        ("wireSchemaVersion", json!(2)),
        ("expectedEngineVersion", json!("stale")),
        ("calculationContractVersion", json!("stale")),
        ("localeKey", json!("")),
        ("localeKey", json!("x".repeat(513))),
        ("localeKey", json!("invalid\u{0}")),
    ] {
        let mut bad = original.clone();
        bad[field] = value;
        assert!(parse_prepare(&bytes(&bad)).is_err());
    }
    for (pointer, value) in [
        ("/guard/snapshot", original["source"]["identity"].clone()),
        ("/source/identity/ownerEpoch", json!(2)),
        ("/source/identity/inputDigest", json!("wrong")),
        ("/source/ready", json!(true)),
        ("/spec/ready", json!(true)),
        ("/options/showShifts", Value::Null),
        ("/options/hiddenPolicy", json!(true)),
    ] {
        let mut bad = original.clone();
        let (parent, key) = pointer.rsplit_once('/').unwrap();
        bad.pointer_mut(parent).unwrap()[key] = value;
        assert!(parse_prepare(&bytes(&bad)).is_err(), "{pointer}");
    }
    let duplicate = String::from_utf8(bytes(&original)).unwrap().replace(
        "\"draftRevision\":1",
        "\"draftRevision\":1,\"draftRevision\":2",
    );
    assert!(parse_prepare(duplicate.as_bytes()).is_err());
    assert!(parse_prepare(&vec![b' '; MAX_PREPARE_BYTES + 1]).is_err());
}
#[test]
fn bounded_resource_pages_and_abort_frames_are_closed_and_never_accept_a_host_result() {
    let page = json!({"resourceId":1,"candidateDigest":"a".repeat(64),"after":null,"limit":1024});
    assert_eq!(parse_candidates(&bytes(&page)).unwrap().limit(), 1024);
    assert!(
        parse_finalize(&bytes(
            &json!({"resourceId":1,"candidateDigest":"a".repeat(64)})
        ))
        .is_ok()
    );
    for view in ["EXPANDED", "VISIBLE", "DATES", "MONTHS"] {
        assert!(
            parse_read(&bytes(
                &json!({"resourceId":1,"view":view,"after":0,"limit":512})
            ))
            .is_ok()
        );
    }
    assert_eq!(
        parse_abort(br#"{"resourceId":1}"#).unwrap().resource_id(),
        1
    );
    for (field, value) in [
        ("resourceId", json!(0)),
        ("resourceId", json!(9_007_199_254_740_992u64)),
        ("candidateDigest", json!("bad")),
        ("limit", json!(0)),
        ("limit", json!(1025)),
        ("after", json!(100001)),
        ("ready", json!(true)),
        ("value", json!([])),
    ] {
        let mut bad = page.clone();
        bad[field] = value;
        assert!(parse_candidates(&bytes(&bad)).is_err());
    }
    assert!(parse_read(br#"{"resourceId":1,"view":"RESULT","after":0,"limit":1}"#).is_err());
    assert!(parse_abort(br#"{"resourceId":1,"ready":true}"#).is_err());
    assert!(parse_abort(&vec![b' '; MAX_CONTROL_BYTES + 1]).is_err());
}
