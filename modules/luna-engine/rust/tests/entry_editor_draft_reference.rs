mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::input::entry_editor_draft;
use serde_json::Value;
#[test]
fn actual_original_hook_initial_changes_undo_and_duty_transitions_match() {
    let fixture = value_pool::decode(include_str!("../../reference/entry-draft-golden.json"));
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 6067);
    assert_eq!(fixture["sourceSeeds"]["shifts"], 159);
    assert_eq!(fixture["sourceSeeds"]["appointments"], 48);
    let mut observations = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let raw: Value = serde_json::from_str(case["rawInput"].as_str().unwrap()).unwrap();
        let mut draft = entry_editor_draft::EntryEditorDraft::new_raw(
            &raw["initialShift"],
            &raw["initialAppointment"],
            serde_json::from_value(raw["mode"].clone()).unwrap(),
            raw["defaultShiftColor"].as_str().unwrap(),
        )
        .unwrap();
        fn observe(draft: &entry_editor_draft::EntryEditorDraft) -> Value {
            let mut view = draft.view().unwrap();
            view["initialSignature"] = serde_json::json!(draft.initial_signature());
            view
        }
        let mut actual = vec![observe(&draft)];
        for action in raw["actions"].as_array().unwrap() {
            match action["kind"].as_str().unwrap() {
                "SET" => draft
                    .set_raw(action["field"].as_str().unwrap(), action["value"].clone())
                    .unwrap(),
                "DUTY" => draft.change_duty(&action["value"]).unwrap(),
                _ => panic!("fixture action"),
            };
            actual.push(observe(&draft));
        }
        observations += actual.len();
        common::assert_json_eq(
            &serde_json::json!(actual),
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
    assert_eq!(observations, 17783);
}

#[test]
fn raw_draft_helper_keeps_closed_fields_and_does_not_capture_unrelated_large_trees() {
    use entry_editor_draft::{EntryEditorDraft, EntryEditorMode};
    use serde_json::json;
    assert!(
        EntryEditorDraft::new_raw(&json!(true), &Value::Null, EntryEditorMode::Shift, "#fff")
            .is_err()
    );
    let mut draft = EntryEditorDraft::new_raw(
        &Value::Null,
        &Value::Null,
        EntryEditorMode::Appointment,
        "#fff",
    )
    .unwrap();
    let before = draft.view().unwrap();
    assert_eq!(before["hasChanges"], false);
    assert!(draft.set_raw("sourceReady", json!(true)).is_err());
    assert!(draft.change_duty(&json!({"kind":"READY"})).is_err());
    assert_eq!(draft.view().unwrap(), before);
    let mut raw = json!({"title":"Stored","breakMinutes":30,"overtimeMinutes":0});
    raw["unrelatedRows"] = json!(vec![json!({"unused":"row"}); 50000]);
    let draft =
        EntryEditorDraft::new_raw(&raw, &Value::Null, EntryEditorMode::Shift, "#fff").unwrap();
    assert!(serde_json::to_vec(&draft.view().unwrap()).unwrap().len() < 4096);
    assert_eq!(raw["unrelatedRows"].as_array().unwrap().len(), 50000);
}
