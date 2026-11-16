mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{contract, ffi::*};
use serde_json::{Value, json};
fn take(buffer: EngineBuffer) -> Value {
    assert!(!buffer.bytes.is_null());
    // SAFETY: output remains owned by this live descriptor until release.
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
fn chunk(row: &Value) -> Value {
    let mut row = row.clone();
    let row = row.as_object_mut().unwrap();
    for field in [
        "payment_json",
        "claim_json",
        "actual_payment_json",
        "data_json",
        "allocations_json",
        "decisions_json",
        "facts_json",
        "confirmation_json",
    ] {
        let Some(text) = row.get(field).and_then(Value::as_str) else {
            continue;
        };
        let mut parts = Vec::new();
        let mut start = 0;
        while start < text.len() {
            let mut end = (start + 48000).min(text.len());
            while !text.is_char_boundary(end) {
                end -= 1
            }
            parts.push(json!(&text[start..end]));
            start = end;
        }
        if parts.is_empty() {
            parts.push(json!(""));
        }
        row.remove(field);
        row.insert(format!("{field}_chunks"), json!(parts));
    }
    Value::Object(row.clone())
}
#[test]
fn real_large_channel_preserves_original_rows_and_owner_fences_without_a_source_slot() {
    let owner = br#"{"ownerScope":"stored-rows-c","ownerEpoch":1}"#;
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) })["ok"],
        true
    );
    let mut header = json!({"kind":"PRESENTATION","wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"stored-rows-c","ownerEpoch":1,"requestId":"stored-rows","draftRevision":0},"command":{"kind":"STORED_ROWS"}});
    let corpus = value_pool::decode(include_str!(
        "../../reference/stored-rows-large-golden.json"
    ));
    assert_eq!(corpus["cases"].as_array().unwrap().len(), 4);
    for (index, case) in corpus["cases"].as_array().unwrap().iter().enumerate() {
        header["guard"]["draftRevision"] = json!(index);
        let body =
            json!({"table":case["table"],"collection":false,"rows":[chunk(&case["rows"][0])]});
        assert!(serde_json::to_vec(&body).unwrap().len() > 262144);
        let result = invoke(&header, &body);
        assert_eq!(result["state"], "CALENDAR_PRESENTED", "{result}");
        assert_eq!(result["value"]["state"], "VALUE", "{result}");
        common::assert_json_eq(
            &result["value"]["value"],
            &case["expected"]["value"],
            case["id"].as_str().unwrap(),
        );
    }
    let next = value_pool::decode(include_str!("../../reference/stored-rows-next-golden.json"));
    for table in [
        "REMUNERATION_PROFILE",
        "OVERTIME_ALLOCATION",
        "PAID_ABSENCE",
        "ALLOWANCE_DECISION",
    ] {
        let case = next["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["table"] == table && c["expected"].get("value").is_some())
            .unwrap();
        let result = invoke(
            &header,
            &json!({"table":table,"collection":false,"rows":[chunk(&case["rows"][0])]}),
        );
        assert_eq!(result["state"], "CALENDAR_PRESENTED", "{table}: {result}");
        common::assert_json_eq(&result["value"]["value"], &case["expected"]["value"], table);
    }
    let parents = value_pool::decode(include_str!(
        "../../reference/stored-parent-join-golden.json"
    ));
    for table in ["OVERTIME_ALLOCATION", "PAID_ABSENCE", "SHIFT_TRAINING"] {
        for success in [true, false] {
            let case = parents["cases"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["table"] == table && c["expected"].get("value").is_some() == success)
                .unwrap();
            let result = invoke(
                &header,
                &json!({"table":table,"collection":false,"rows":[chunk(&case["rows"][0])],"parents":case["parents"]}),
            );
            assert_eq!(result["state"], "CALENDAR_PRESENTED", "{table}: {result}");
            if success {
                common::assert_json_eq(&result["value"]["value"], &case["expected"]["value"], table)
            } else {
                let error = &case["expected"]["error"];
                assert_eq!(
                    result["value"],
                    json!({"state":"RECORD_ERROR","name":error["name"],"message":error["message"],"userFacing":error["userFacing"],"rowIndex":0})
                );
            }
        }
    }
    let drafts = value_pool::decode(include_str!(
        "../../reference/stored-draft-rows-golden.json"
    ));
    for case in drafts["largeCases"].as_array().unwrap() {
        let body =
            json!({"table":case["table"],"collection":false,"rows":[chunk(&case["rows"][0])]});
        assert!(serde_json::to_vec(&body).unwrap().len() > 262144);
        let result = invoke(&header, &body);
        assert_eq!(
            result["state"], "CALENDAR_PRESENTED",
            "{}: {result}",
            case["id"]
        );
        common::assert_json_eq(
            &result["value"]["value"],
            &case["expected"]["value"],
            case["id"].as_str().unwrap(),
        );
        for success in [true, false] {
            let parent = drafts["parentCases"]
                .as_array()
                .unwrap()
                .iter()
                .find(|p| {
                    p["table"] == case["table"] && p["expected"].get("value").is_some() == success
                })
                .unwrap();
            let result = invoke(
                &header,
                &json!({"table":parent["table"],"collection":false,"rows":[chunk(&parent["rows"][0])],"parents":parent["parents"]}),
            );
            assert_eq!(
                result["state"], "CALENDAR_PRESENTED",
                "{}: {result}",
                parent["id"]
            );
            if success {
                common::assert_json_eq(
                    &result["value"]["value"],
                    &parent["expected"]["value"],
                    parent["id"].as_str().unwrap(),
                )
            } else {
                let e = &parent["expected"]["error"];
                assert_eq!(
                    result["value"],
                    json!({"state":"RECORD_ERROR","name":e["name"],"message":e["message"],"userFacing":e["userFacing"],"rowIndex":0}),
                    "{}",
                    parent["id"]
                )
            }
        }
    }
    let mapped = value_pool::decode(include_str!(
        "../../reference/stored-rows-ancestry-golden.json"
    ));
    let original = mapped["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            c["table"] == "TARIFF_ANNUAL_CLAIM"
                && c["collection"] == false
                && c["expected"].get("value").is_some()
        })
        .unwrap();
    // Original map-only semantics permit a batch of repeated physical rows;
    // collection validation is deliberately a separate explicit option.
    let rows = vec![chunk(&original["rows"][0]); 2048];
    let large = invoke(
        &header,
        &json!({"table":"TARIFF_ANNUAL_CLAIM","collection":false,"rows":rows}),
    );
    assert_eq!(large["state"], "CALENDAR_PRESENTED", "{large}");
    assert!(serde_json::to_vec(&large).unwrap().len() > 4 * 1024 * 1024);
    assert_eq!(large["value"]["state"], "VALUE");
    assert_eq!(
        large["value"]["value"],
        json!(vec![original["expected"]["value"][0].clone(); 2048])
    );
    take(luna_engine_reset());
    assert_eq!(
        invoke(
            &header,
            &json!({"table":"TRAINING_PROFILE","collection":true,"rows":[]})
        )["ok"],
        false
    );
}
