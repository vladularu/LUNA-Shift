use luna_engine::target::repository::execute;
use serde_json::{Value, json};
fn call(command: Value) -> Value {
    let result = execute(&serde_json::to_vec(&command).unwrap()).unwrap();
    match result["state"].as_str().unwrap() {
        "VALUE" => json!({"value":result["value"]}),
        "RECORD_ERROR" => json!({"error":{"name":result["name"],"message":result["message"]}}),
        other => panic!("unexpected target command state {other}"),
    }
}
#[test]
fn original_saved_rows_and_settings_validation_use_actual_command() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/target-row-golden.json")).unwrap();
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 101);
    for case in fixture["cases"].as_array().unwrap() {
        let actual = call(json!({"kind":"MAP_ROW","row":case["input"]}));
        if case.get("safeRejection").is_some() {
            assert_eq!(actual["error"]["name"], "WorkingTimeTargetError");
            assert!(!actual.to_string().contains("private@example.com"));
        } else {
            assert_eq!(actual, case["expected"], "{}", case["id"]);
        }
    }
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/target-golden.json")).unwrap();
    let mut count = 0;
    for case in fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|case| case["operation"] == "settingsValidation")
    {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        assert_eq!(
            call(json!({"kind":"VALIDATE_SETTINGS","settings":input["value"]})),
            case["expected"],
            "{}",
            case["id"]
        );
        count += 1;
    }
    assert!(count > 0);
}
#[test]
fn command_rejects_additional_prepared_fields() {
    assert!(execute(br#"{"kind":"MAP_ROW","row":null,"status":"ready"}"#).is_err());
}

#[test]
fn stored_json_chunks_preserve_large_valid_settings_without_relaxing_the_envelope() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/target-golden.json")).unwrap();
    let case = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == "saved-settings-2")
        .unwrap();
    let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
    let mut settings = input["value"].clone();
    let mut day = settings["context"]["days"][0].clone();
    day["date"] = json!("2026-12-25");
    settings["context"]["days"]
        .as_array_mut()
        .unwrap()
        .push(day);
    let signature = "ä".repeat(100000);
    settings["planBindings"] = json!([
        {"date":"2026-12-24","signature":signature},
        {"date":"2026-12-25","signature":signature}
    ]);
    let text = serde_json::to_string(&settings).unwrap();
    assert!(text.len() > 300000);
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let mut end = (start + 64000).min(text.len());
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        chunks.push(&text[start..end]);
        start = end;
    }
    let row = json!({"id":"singleton","settings_json_chunks":chunks,"revision":1,
      "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-11-01T00:00:00Z"});
    let actual = call(json!({"kind":"MAP_CHUNKS","row":row}));
    assert_eq!(actual["value"]["settings"], settings);
    let mut ambiguous = row.clone();
    ambiguous["settings_json"] = json!(text);
    assert!(
        execute(&serde_json::to_vec(&json!({"kind":"MAP_CHUNKS","row":ambiguous})).unwrap())
            .is_err()
    );
    ambiguous["settings_json"] = json!("{}");
    assert!(
        call(json!({"kind":"MAP_CHUNKS","row":ambiguous}))
            .get("error")
            .is_some()
    );
}
