mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{contract, ffi::*};
use serde_json::{Value, json};
fn take(buffer: EngineBuffer) -> Value {
    let result =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
    }
    result
}
fn invoke(header: &Value, body: &Value) -> Value {
    let header = serde_json::to_vec(header).unwrap();
    let body = serde_json::to_vec(body).unwrap();
    take(unsafe {
        luna_engine_calendar_source(header.as_ptr(), header.len(), body.as_ptr(), body.len())
    })
}
#[test]
fn stateless_original_export_candidates_use_existing_raw_channel_and_owner_fences() {
    let owner = br#"{"ownerScope":"export-candidates","ownerEpoch":1}"#;
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) })["ok"],
        true
    );
    let mut header = json!({"kind":"PRESENTATION","wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"export-candidates","ownerEpoch":1,"requestId":"export-candidates","draftRevision":0},"command":{"kind":"EXPORT_CANDIDATES"}});
    let fixture = value_pool::decode(include_str!("../../reference/export-structure-golden.json"));
    for (index, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        header["guard"]["draftRevision"] = json!(index);
        let actual = invoke(
            &header,
            &json!({"kind":"RECORDED_ENTRIES","entries":case["entries"]}),
        );
        assert_eq!(
            actual["state"], "CALENDAR_PRESENTED",
            "{}:{actual}",
            case["id"]
        );
        common::assert_json_eq(
            &json!({"candidates":actual["value"]["candidates"],"readableCount":actual["value"]["readableEntryCount"]}),
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
    header["guard"]["draftRevision"] = json!(20_000);
    let row = json!({"kind":"SHIFT","id":"long","title":"Dienst","date":"2026-07-01","type":"EARLY","startTime":"08:00","endTime":"16:00","breakMinutes":30,"allDay":false,"deletedAt":null,"note":"x".repeat(280_000)});
    let body = json!({"kind":"RECORDED_ENTRIES","entries":[row]});
    assert!(serde_json::to_vec(&body).unwrap().len() > 262_144);
    assert_eq!(invoke(&header, &body)["state"], "CALENDAR_PRESENTED");
    assert_eq!(take(luna_engine_reset())["ok"], true);
    assert_eq!(invoke(&header, &body)["ok"], false);
}
