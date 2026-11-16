use luna_engine::{contract, ffi::*};
use serde_json::{Value, json};
fn take(buffer: EngineBuffer) -> Value {
    assert!(!buffer.bytes.is_null());
    // SAFETY: the live descriptor owns these bytes until the release below.
    let result =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
    }
    result
}
#[test]
fn actual_c_backup_preferences_match_all_original_decisions_and_owner_reset() {
    let owner = br#"{"ownerScope":"backup-preferences-c","ownerEpoch":1}"#;
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) })["ok"],
        true
    );
    let mut header = json!({"kind":"PRESENTATION","wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"backup-preferences-c","ownerEpoch":1,"requestId":"backup-preferences","draftRevision":0},"command":{"kind":"BACKUP_BUSINESS_PREFERENCES"}});
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/backup-preferences-golden.json"
    ))
    .unwrap();
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 1069);
    let large: Value = serde_json::from_str(include_str!(
        "../../reference/backup-preferences-large-golden.json"
    ))
    .unwrap();
    assert_eq!(large["cases"].as_array().unwrap().len(), 7);
    for (index, case) in fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .chain(large["cases"].as_array().unwrap())
        .enumerate()
    {
        header["guard"]["draftRevision"] = json!(index);
        let h = serde_json::to_vec(&header).unwrap();
        let mut input = case["input"].clone();
        for row in input["rows"].as_array_mut().unwrap() {
            let Some(raw) = row["value"].as_str().filter(|v| v.len() > 16000) else {
                continue;
            };
            let mut chunks = Vec::new();
            let mut start = 0;
            while start < raw.len() {
                let mut end = (start + 16000).min(raw.len());
                while !raw.is_char_boundary(end) {
                    end -= 1;
                }
                chunks.push(raw[start..end].to_owned());
                start = end;
            }
            row.as_object_mut().unwrap().remove("value");
            row["value_chunks"] = json!(chunks);
        }
        let b = serde_json::to_vec(&input).unwrap();
        let actual =
            take(unsafe { luna_engine_calendar_source(h.as_ptr(), h.len(), b.as_ptr(), b.len()) });
        assert_eq!(
            actual["state"], "CALENDAR_PRESENTED",
            "{}: {actual}",
            case["id"]
        );
        if let Some(error) = case["expected"].get("error") {
            assert_eq!(actual["value"]["state"], "RECORD_ERROR", "{}", case["id"]);
            for field in ["name", "message", "userFacing"] {
                assert_eq!(
                    actual["value"][field], error[field],
                    "{}:{field}",
                    case["id"]
                );
            }
        } else {
            assert_eq!(
                actual["value"],
                json!({"state":"VALUE","value":null}),
                "{}",
                case["id"]
            );
        }
    }
    let owner2 = br#"{"ownerScope":"backup-preferences-c","ownerEpoch":2}"#;
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner2.as_ptr(), owner2.len()) })["ok"],
        true
    );
    let h = serde_json::to_vec(&header).unwrap();
    let b = br#"{"rows":[],"profile":null}"#;
    let stale =
        take(unsafe { luna_engine_calendar_source(h.as_ptr(), h.len(), b.as_ptr(), b.len()) });
    assert_ne!(stale["state"], "CALENDAR_PRESENTED", "{stale}");
}
