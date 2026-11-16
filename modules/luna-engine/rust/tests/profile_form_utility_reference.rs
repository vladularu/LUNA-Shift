mod common;
use luna_engine::{
    contract::{self, utility::parse_utility_request},
    runtime::utility,
};
use serde_json::{Value, json};
fn command(case: &Value) -> Value {
    let mut value = case["input"].clone();
    let operation = case["operation"].as_str().unwrap();
    let (kind, fields): (&str, &[&str]) = match operation {
        "groups" => ("GROUPS", &["mode"]),
        "levels" => ("LEVELS", &["mode", "group"]),
        "training" => ("TRAINING", &["mode"]),
        "fullTime" => ("FULL_TIME", &["selection", "instant"]),
        "errors" => ("ERRORS", &["selection", "weeklyMinutes", "instant"]),
        "draft" => ("DRAFT", &["selection", "weeklyMinutes", "instant"]),
        "regionMismatch" => ("REGION_MISMATCH", &["mode", "federalState"]),
        "settings" => ("SETTINGS", &["profile", "referenceDate", "instant"]),
        "settingsMode" => (
            "SETTINGS_MODE",
            &["profile", "mode", "referenceDate", "instant"],
        ),
        "tvalChoice" => ("TVAL_CHOICE", &["profile", "referenceDate", "instant"]),
        "tvalFields" => ("TVAL_FIELDS", &["choice", "previous", "changed"]),
        "manualGross" => ("MANUAL_GROSS", &["text"]),
        "manualError" => ("MANUAL_ERROR", &["text"]),
        "evidence" => ("EVIDENCE", &["value"]),
        "clock" => ("CLOCK", &["instant", "timeZone"]),
        _ => panic!("unknown operation"),
    };
    // Only the frozen fixture harness supplies its recorded default clock.
    if fields.contains(&"instant") && value.get("instant").is_none() {
        value["instant"] = json!("2026-07-15T12:00:00Z");
    }
    let mut result = json!({"kind":kind});
    for field in fields {
        if let Some(v) = value.get(*field) {
            result[*field] = v.clone();
        }
    }
    result
}
fn envelope(command: Value, revision: usize) -> Value {
    json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,
 "guard":{"ownerScope":"profile-editor","ownerEpoch":1,"requestId":"profile","draftRevision":revision},"operation":{"kind":"PROFILE_FORM","command":command}})
}
fn assert_result(result: &Value, case: &Value) {
    assert_eq!(result["state"], "VALUE", "{}", case["id"]);
    let frame = &result["value"];
    let actual = match frame["state"].as_str().unwrap() {
        "READY" => frame["value"].clone(),
        "FORM_ERROR" => json!({"$error":{"name":frame["name"],"message":frame["message"]}}),
        _ => panic!("{frame}"),
    };
    common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
}
#[test]
fn all_original_profile_commands_cross_the_closed_public_contract() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/profile-form-golden.json")).unwrap();
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 3600);
    for (index, case) in cases.iter().enumerate() {
        let bytes = serde_json::to_vec(&envelope(command(case), index + 1)).unwrap();
        let request =
            parse_utility_request(&bytes).unwrap_or_else(|e| panic!("{}:{e:?}", case["id"]));
        assert_result(
            &serde_json::to_value(utility::calculate(request.operation())).unwrap(),
            case,
        );
    }
}
#[test]
fn all_original_commands_use_native_c_buffer_ownership() {
    use luna_engine::ffi::*;
    fn take(buffer: EngineBuffer) -> Value {
        // SAFETY: this library owns the live buffer until the matching release.
        let result = serde_json::from_slice(unsafe {
            std::slice::from_raw_parts(buffer.bytes, buffer.length)
        })
        .unwrap();
        assert!(luna_engine_release_buffer(buffer.handle));
        result
    }
    take(luna_engine_reset());
    let owner = br#"{"ownerScope":"profile-editor","ownerEpoch":1}"#;
    // SAFETY: immutable input remains live through the bounded native call.
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) })["ok"],
        true
    );
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/profile-form-golden.json")).unwrap();
    for (index, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let bytes = serde_json::to_vec(&envelope(command(case), index + 1)).unwrap();
        // SAFETY: immutable input remains live through the bounded native call.
        let result = take(unsafe { luna_engine_utility(bytes.as_ptr(), bytes.len()) });
        assert_eq!(result["state"], "COMPLETED", "{}:{result}", case["id"]);
        assert_result(&result["result"], case);
    }
    take(luna_engine_reset());
}
#[test]
fn commands_require_raw_clock_and_reject_precomputed_fields() {
    for command in [
        json!({"kind":"SETTINGS","profile":{},"ready":true}),
        json!({"kind":"CLOCK","timeZone":"Europe/Berlin"}),
        json!({"kind":"GROUPS","mode":null,"computedGroups":[]}),
        json!({"kind":"DRAFT","selection":{},"weeklyMinutes":"12","instant":"2026-01-01T00:00Z"}),
    ] {
        assert!(
            parse_utility_request(&serde_json::to_vec(&envelope(command, 1)).unwrap()).is_err()
        );
    }
    let request = parse_utility_request(
        &serde_json::to_vec(&envelope(
            json!({"kind":"CLOCK","timeZone":"Europe/Berlin","instant":"bad"}),
            1,
        ))
        .unwrap(),
    )
    .unwrap();
    let result = serde_json::to_value(utility::calculate(request.operation())).unwrap();
    assert_eq!(result["value"]["state"], "FORM_ERROR");
}
