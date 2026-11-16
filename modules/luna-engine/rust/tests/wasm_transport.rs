use luna_engine::wasm_transport::engine_invoke;
use serde_json::Value;
#[test]
fn shared_string_transport_copies_and_releases_every_native_reply() {
    for _ in 0..64 {
        let value: Value = serde_json::from_str(&engine_invoke("info", "")).unwrap();
        assert_eq!(value["ok"], true);
        assert_eq!(value["engineVersion"], luna_engine::ENGINE_VERSION);
        assert_eq!(value["capabilities"]["fullCalculation"], false);
    }
}
#[test]
fn invalid_operations_and_payloads_never_echo_supplied_data() {
    for (operation, payload) in [
        ("private-operation", "private-value"),
        ("info", "private-value"),
        ("execute", "{\"private\":\"private-value\"}"),
    ] {
        let value: Value = serde_json::from_str(&engine_invoke(operation, payload)).unwrap();
        assert_eq!(value["ok"], false);
        assert!(!value.to_string().contains("private"));
    }
}
