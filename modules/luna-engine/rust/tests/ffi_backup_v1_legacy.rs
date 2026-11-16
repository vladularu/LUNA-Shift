use luna_engine::{contract, ffi::*};
use serde_json::{Value, json};
fn take(buffer: EngineBuffer) -> Value {
    let value =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
        assert!(!luna_engine_release_buffer(buffer.handle));
    }
    value
}
#[test]
fn original_v1_legacy_rows_cross_the_existing_c_preference_command() {
    let owner = br#"{"ownerScope":"backup-v1","ownerEpoch":1}"#;
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) })["ok"],
        true
    );
    let header = json!({"kind":"PRESENTATION","wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"backup-v1","ownerEpoch":1,"requestId":"legacy","draftRevision":0},"command":{"kind":"BACKUP_BUSINESS_PREFERENCES"}});
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/backup-v1-legacy-golden.json")).unwrap();
    let header = serde_json::to_vec(&header).unwrap();
    let mut count = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let Some(expected) = case["expected"].get("value") else {
            continue;
        };
        let body=serde_json::to_vec(&json!({"rows":[],"profile":case["input"]["document"]["data"]["profile"],"prepareLegacy":true})).unwrap();
        let actual = take(unsafe {
            luna_engine_calendar_source(header.as_ptr(), header.len(), body.as_ptr(), body.len())
        });
        assert_eq!(actual["state"], "CALENDAR_PRESENTED", "{actual}");
        assert_eq!(actual["value"]["state"], "VALUE", "{actual}");
        let rows = expected["history"].as_array().unwrap();
        if let Some(row) = rows.first() {
            assert_eq!(
                serde_json::to_string(&actual["value"]["value"]).unwrap(),
                row["data_json"],
                "{}",
                case["id"]
            );
        } else {
            assert!(actual["value"]["value"].is_null());
        }
        count += 1;
    }
    assert_eq!(count, 15);
}
