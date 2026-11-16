mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::input::entry_editor_save::{self, EntrySaveFailure};
use serde_json::Value;
#[test]
fn actual_original_save_closure_validation_requests_and_completion_states_match() {
    let fixture = value_pool::decode(include_str!("../../reference/entry-save-golden.json"));
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 3678);
    let mut time_errors = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let input: Value = serde_json::from_str(case["rawInput"].as_str().unwrap()).unwrap();
        let error = match input["ioFailure"].as_str() {
            None => None,
            Some("VALIDATION") => Some(EntrySaveFailure::UserFacing(
                "Source validation failure".into(),
            )),
            Some("CONCURRENCY") => Some(EntrySaveFailure::UserFacing(
                "Der Eintrag wurde zwischenzeitlich geändert. Bitte neu laden.".into(),
            )),
            Some("GENERIC") => Some(EntrySaveFailure::Internal),
            _ => panic!("fixture io"),
        };
        let preparation = entry_editor_save::prepare_raw(&input).unwrap();
        match preparation.write_intent() {
            Some(intent) => common::assert_json_eq(
                intent,
                &case["expected"]["write"],
                case["id"].as_str().unwrap(),
            ),
            None => assert!(case["expected"]["write"].is_null(), "{}", case["id"]),
        }
        if let Some(begin) = preparation.begin() {
            let prefix: Vec<_> = case["expected"]["events"]
                .as_array()
                .unwrap()
                .iter()
                .take_while(|event| {
                    event["kind"] != "WARNING_FEEDBACK"
                        && event["kind"] != "CLOSE"
                        && !(event["kind"] == "SAVING" && event["value"] == false)
                })
                .cloned()
                .collect();
            common::assert_json_eq(
                &begin["events"],
                &serde_json::json!(prefix),
                case["id"].as_str().unwrap(),
            );
            assert_eq!(begin["stored"], false);
        } else {
            assert!(preparation.write_intent().is_none());
        }
        let actual = preparation.finish(error.as_ref());
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        if case.get("sourceError").is_some() {
            assert_eq!(actual["state"], "PRECHECK_TIME_ERROR");
            time_errors += 1;
        }
    }
    assert_eq!(time_errors, 2);
}

#[test]
fn completion_uses_typed_native_error_ancestry_and_raw_intents_are_owned() {
    use luna_engine::input::{
        calendar,
        entry_editor_draft::{EntryEditorDraft, EntryEditorMode},
    };
    use serde_json::json;
    let validation = calendar::require_non_empty(&json!(""), "Bezeichnung").unwrap_err();
    assert!(
        matches!(EntrySaveFailure::from_input_error(&validation),EntrySaveFailure::UserFacing(message) if message=="Bezeichnung darf nicht leer sein.")
    );
    let mut draft = EntryEditorDraft::new_raw(
        &Value::Null,
        &Value::Null,
        EntryEditorMode::Appointment,
        "#ABCDEF",
    )
    .unwrap();
    let internal = draft.set_raw("unknown", Value::Null).unwrap_err();
    assert!(matches!(
        EntrySaveFailure::from_input_error(&internal),
        EntrySaveFailure::Internal
    ));
    let fixture = value_pool::decode(include_str!("../../reference/entry-save-golden.json"));
    let mut input: Value =
        serde_json::from_str(fixture["cases"][0]["rawInput"].as_str().unwrap()).unwrap();
    let prepared = entry_editor_save::prepare_raw(&input).unwrap();
    let before = prepared.write_intent().unwrap().clone();
    input["fields"]["shiftTitle"] = json!("Changed after prepare");
    assert_eq!(prepared.finish(None)["write"], before);
}
