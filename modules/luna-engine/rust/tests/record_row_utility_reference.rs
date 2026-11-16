mod common;
use luna_engine::{
    contract::{self, utility::parse_utility_request},
    input::record_rows::{self, RecordRowKind},
    runtime::utility,
};
use serde_json::{Value, json};
fn envelope(kind: &str, rows: Value, revision: usize) -> Value {
    json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"records","ownerEpoch":1,"requestId":"records","draftRevision":revision},"operation":{"kind":"MAP_RECORD_ROWS","rowKind":kind,"rows":rows}})
}
#[test]
fn original_sql_row_normalization_and_errors_cross_closed_public_batch_transport() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/input-calendar-rows-golden.json"
    ))
    .unwrap();
    let mut count = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let kind = match case["operation"].as_str().unwrap() {
            "mapShift" => "SHIFT",
            "mapAppointment" => "APPOINTMENT",
            "mapTemplate" => "TEMPLATE",
            _ => continue,
        };
        count += 1;
        // This source operation validates a STORED decision. Save intent has no
        // revision or timestamps and is separately proven by tariff_record_reference.
        let input = if kind == "TARIFF_DECISION" {
            let v = &case["input"];
            json!({"month":v["month"],"allowance_status":v["allowanceStatus"],"revision":v["revision"],"confirmed_at":v["confirmedAt"],"updated_at":v["updatedAt"]})
        } else {
            case["input"].clone()
        };
        let raw = envelope(kind, json!([input]), count);
        let request = parse_utility_request(&serde_json::to_vec(&raw).unwrap()).unwrap();
        let actual = serde_json::to_value(utility::calculate(request.operation())).unwrap();
        if case["expected"].get("value").is_some() {
            assert_eq!(actual["state"], "VALUE");
            common::assert_json_eq(
                &actual["value"][0],
                &case["expected"]["value"],
                case["id"].as_str().unwrap(),
            );
        } else {
            assert_eq!(actual["state"], "RECORD_ERROR");
            assert_eq!(actual["name"], case["expected"]["name"]);
            assert_eq!(actual["message"], case["expected"]["$error"]);
        }
    }
    assert_eq!(count, 377);
}
#[test]
fn raw_row_batches_preserve_order_have_a_hard_bound_and_accept_no_profile_ready_modes() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/input-calendar-rows-golden.json"
    ))
    .unwrap();
    let valid: Vec<_> = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["operation"] == "mapShift" && c["expected"].get("value").is_some())
        .take(128)
        .collect();
    assert_eq!(valid.len(), 128);
    let rows: Vec<Value> = valid.iter().map(|c| c["input"].clone()).collect();
    let expected = Value::Array(
        valid
            .iter()
            .map(|c| c["expected"]["value"].clone())
            .collect(),
    );
    common::assert_json_eq(
        &record_rows::map_rows(RecordRowKind::Shift, &rows).unwrap(),
        &expected,
        "128-batch",
    );
    let mut too_many = rows;
    too_many.push(too_many[0].clone());
    assert!(record_rows::map_rows(RecordRowKind::Shift, &too_many).is_err());
    let raw = envelope("SHIFT", json!(too_many), 1);
    let parsed = parse_utility_request(&serde_json::to_vec(&raw).unwrap()).unwrap();
    assert_eq!(
        serde_json::to_value(utility::calculate(parsed.operation())).unwrap()["state"],
        "OPERATION_LIMIT"
    );
    let mut raw = envelope("PROFILE_READY", json!([]), 1);
    assert!(parse_utility_request(&serde_json::to_vec(&raw).unwrap()).is_err());
    raw["operation"]["rowKind"] = json!("SHIFT");
    raw["operation"]["ready"] = json!(true);
    assert!(parse_utility_request(&serde_json::to_vec(&raw).unwrap()).is_err());
}

#[test]
fn original_input_normalization_crosses_real_owned_c_buffers_with_native_error_ancestry() {
    use luna_engine::ffi::*;
    fn take(buffer: EngineBuffer) -> Value {
        // SAFETY: copy a live owned buffer before its exactly-once release.
        let value = serde_json::from_slice(unsafe {
            std::slice::from_raw_parts(buffer.bytes, buffer.length)
        })
        .unwrap();
        assert!(luna_engine_release_buffer(buffer.handle));
        value
    }
    take(luna_engine_reset());
    let owner = br#"{"ownerScope":"records","ownerEpoch":1}"#;
    // SAFETY: immutable owner bytes remain live for the synchronous native call.
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) })["ok"],
        true
    );
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/input-calendar-golden.json")).unwrap();
    let mut count = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let kind = match case["operation"].as_str().unwrap() {
            "validateShift" => "SHIFT_INPUT",
            "validateAppointment" => "APPOINTMENT_INPUT",
            "validateTemplate" => "TEMPLATE_INPUT",
            "validateMonthlyTariffDecision" => "TARIFF_DECISION",
            _ => continue,
        };
        count += 1;
        // This source operation validates a STORED decision. Save intent has no
        // revision or timestamps and is separately proven by tariff_record_reference.
        let input = if kind == "TARIFF_DECISION" {
            let v = &case["input"];
            json!({"month":v["month"],"allowance_status":v["allowanceStatus"],"revision":v["revision"],"confirmed_at":v["confirmedAt"],"updated_at":v["updatedAt"]})
        } else {
            case["input"].clone()
        };
        let raw = envelope(kind, json!([input]), count);
        let bytes = serde_json::to_vec(&raw).unwrap();
        // SAFETY: immutable envelope bytes remain live for the synchronous native call.
        let result = take(unsafe { luna_engine_utility(bytes.as_ptr(), bytes.len()) });
        assert_eq!(result["state"], "COMPLETED");
        let actual = &result["result"];
        if case["malformedType"] == true
            || case["engineDiagnostic"] == true
            || case["nativeMalformed"] == true
        {
            assert_eq!(
                actual["state"], "RECORD_ERROR",
                "safe native rejection {}",
                case["id"]
            );
            continue;
        }
        if case["expected"].get("value").is_some() {
            assert_eq!(actual["state"], "VALUE");
            common::assert_json_eq(
                &actual["value"][0],
                &case["expected"]["value"],
                case["id"].as_str().unwrap(),
            );
        } else {
            assert_eq!(actual["state"], "RECORD_ERROR");
            assert_eq!(actual["name"], case["expected"]["name"]);
            assert_eq!(actual["message"], case["expected"]["$error"]);
            assert!(actual["userFacing"].is_boolean());
        }
    }
    assert_eq!(count, 508);
    take(luna_engine_reset());
}
