mod common;
#[path = "support/value_pool_source_numbers.rs"]
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
    let h = serde_json::to_vec(header).unwrap();
    let b = serde_json::to_vec(body).unwrap();
    take(unsafe { luna_engine_calendar_source(h.as_ptr(), h.len(), b.as_ptr(), b.len()) })
}
#[test]
fn original_identities_projection_privacy_and_confirmation_signature_cross_the_existing_c_transport()
 {
    let owner = br#"{"ownerScope":"sharing-projection","ownerEpoch":1}"#;
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) })["ok"],
        true
    );
    let mut header = json!({"kind":"PRESENTATION","wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"sharing-projection","ownerEpoch":1,"requestId":"sharing","draftRevision":0},"command":{"kind":"SHARING_CANDIDATES"}});
    let fixture = value_pool::decode(include_str!(
        "../../reference/sharing-projection-golden.json"
    ));
    for (i, c) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        header["guard"]["draftRevision"] = json!(i * 2);
        header["command"]["kind"] = json!("SHARING_CANDIDATES");
        let mut body = json!({"entries":c["entries"],"options":c["options"]});
        let candidates = invoke(&header, &body);
        assert_eq!(
            candidates["state"], "CALENDAR_PRESENTED",
            "{}:{candidates}",
            c["id"]
        );
        common::assert_json_eq(
            &candidates["value"]["candidates"],
            &c["candidates"],
            c["id"].as_str().unwrap(),
        );
        assert_eq!(candidates["value"]["projectionSlots"], c["projectionSlots"]);
        body["bindings"]=json!(c["projectionSlots"].as_array().unwrap().iter().map(|slot|json!({"slot":slot,"publicId":c["publicIds"][slot.as_u64().unwrap() as usize].as_str().unwrap_or("")})).collect::<Vec<_>>());
        header["guard"]["draftRevision"] = json!(i * 2 + 1);
        header["command"]["kind"] = json!("SHARING_PROJECT");
        let actual = invoke(&header, &body);
        assert_eq!(
            actual["state"], "CALENDAR_PRESENTED",
            "{}:{actual}",
            c["id"]
        );
        common::assert_json_eq(&actual["value"], &c["expected"], c["id"].as_str().unwrap());
    }
}
