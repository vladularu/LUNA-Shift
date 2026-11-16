mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{contract, ffi::*};
use serde_json::{Value, json};
fn take(buffer: EngineBuffer) -> Value {
    let v =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
    }
    v
}
fn invoke(h: &Value, b: &Value) -> Value {
    let h = serde_json::to_vec(h).unwrap();
    let b = serde_json::to_vec(b).unwrap();
    take(unsafe { luna_engine_calendar_source(h.as_ptr(), h.len(), b.as_ptr(), b.len()) })
}
#[test]
fn original_timing_effective_month_and_all_groups_cross_the_existing_c_channel() {
    let owner = br#"{"ownerScope":"timing-test","ownerEpoch":1}"#;
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) })["ok"],
        true
    );
    let mut header = json!({"kind":"PRESENTATION","wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"timing-test","ownerEpoch":1,"requestId":"timing","draftRevision":0},"command":{"kind":"SALARY_PAYMENT_TIMING"}});
    let fixture = value_pool::decode(include_str!("../../reference/payroll-form-golden.json"));
    let mut dump = Vec::new();
    for (i, c) in fixture["timing"].as_array().unwrap().iter().enumerate() {
        header["guard"]["draftRevision"] = json!(i * 2);
        let initial = invoke(
            &header,
            &json!({"operation":"VALIDATE","value":c["preferences"]}),
        );
        assert_eq!(initial["value"]["state"], "VALUE", "{initial}");
        header["guard"]["draftRevision"] = json!(i * 2 + 1);
        let actual = invoke(
            &header,
            &json!({"operation":"SET_LAG","value":c["preferences"],"month":c["month"],"choice":c["choice"]}),
        );
        assert_eq!(actual["state"], "CALENDAR_PRESENTED", "{actual}");
        assert_eq!(actual["value"]["state"], "VALUE", "{actual}");
        common::assert_json_eq(
            &actual["value"]["value"],
            &c["expected"],
            "Original timing source",
        );
        dump.push(json!({"input":c,"initial":initial["value"]["value"],"actual":actual["value"]["value"]}));
    }
    assert_eq!(dump.len(), 60);
    for invalid in [Value::Null, json!({}), json!({"ready":true,"periods":[]})] {
        let result = invoke(&header, &json!({"operation":"VALIDATE","value":invalid}));
        assert_eq!(result["value"]["state"], "RECORD_ERROR");
        assert_eq!(result["value"]["name"], "SalaryPaymentValidationError");
    }
    if let Ok(file) = std::env::var("LUNA_SALARY_TIMING_DUMP") {
        std::fs::write(
            file,
            serde_json::to_vec(&json!({"engineVersion":luna_engine::ENGINE_VERSION,"cases":dump}))
                .unwrap(),
        )
        .unwrap();
    }
}
