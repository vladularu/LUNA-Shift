mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::input::{
    entry_editor_draft::{EntryEditorDraft, EntryEditorMode},
    entry_editor_preset,
};
use serde_json::{Value, json};
#[test]
fn original_preset_selection_and_legacy_optional_template_fields_match() {
    let fixture = value_pool::decode(include_str!("../../reference/entry-preset-golden.json"));
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 1863);
    assert_eq!(fixture["sourceTemplates"], 141);
    assert_eq!(fixture["rejectedTemplates"], 10);
    for case in fixture["cases"].as_array().unwrap() {
        let input = &case["input"];
        let kind = input["type"].as_str().unwrap();
        let templates = input["templates"].as_array().unwrap();
        let preset = entry_editor_preset::resolve(kind, templates, &input["appearance"]).unwrap();
        common::assert_json_eq(
            &preset,
            &case["expected"]["preset"],
            case["id"].as_str().unwrap(),
        );
        let mut draft = EntryEditorDraft::new_raw(
            &Value::Null,
            &Value::Null,
            EntryEditorMode::Shift,
            "#ABCDEF",
        )
        .unwrap();
        draft
            .choose_type(kind, templates, &input["appearance"])
            .unwrap();
        let view = draft.view().unwrap();
        for event in case["expected"]["events"].as_array().unwrap() {
            let key = event["field"].as_str().unwrap();
            common::assert_json_eq(
                &view["fields"][key],
                &event["value"],
                case["id"].as_str().unwrap(),
            );
        }
    }
}

#[test]
fn preset_selection_borrows_unrelated_template_fields_and_rejects_unknown_types() {
    let appearance = json!({"colors":{"EARLY":"#ABCDEF"},"labels":{"EARLY":"Früh"}});
    assert!(entry_editor_preset::resolve("READY", &[], &appearance).is_err());
    let template = json!({"id":"stored","name":"Stored","type":"EARLY","deletedAt":null,"specialDuty":null,"allDay":false,"startTime":"06:00","endTime":"14:00","breakMinutes":30,"color":"#ABCDEF","symbol":"F","unrelatedRows":vec![json!({"ignored":"row"});50000]});
    let templates = vec![template];
    let result = entry_editor_preset::resolve("EARLY", &templates, &appearance).unwrap();
    assert!(serde_json::to_vec(&result).unwrap().len() < 1024);
    assert_eq!(
        templates[0]["unrelatedRows"].as_array().unwrap().len(),
        50000
    );
}
