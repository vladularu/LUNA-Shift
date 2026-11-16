use luna_engine::{
    input::{
        profile_editor::{EditorDraftPatch, EditorSection, ProfileEditorSource},
        profile_form::FormClock,
    },
    rules::RuleResolver,
};
use serde_json::{Value, json};
#[path = "support/value_pool.rs"]
mod value_pool;
#[test]
fn full_original_settings_editor_bootstrap_and_raw_draft_preview_match() {
    let data = value_pool::decode(include_str!("../../reference/profile-editor-golden.json"));
    let resolver = RuleResolver::bundled().unwrap();
    assert!(data["cases"].as_array().unwrap().len() > 650);
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let mut profile = input["profile"].clone();
        if input["ignoredTargetDays"] == 50_000 {
            profile["workingTimeTarget"] =
                json!({"days":vec![json!({"date":"2026-11-01","targetMinutes":462});50_000]});
        }
        let section: EditorSection = serde_json::from_value(input["section"].clone()).unwrap();
        let clock = FormClock::from_instant(input["instant"].as_str().unwrap()).unwrap();
        let result = ProfileEditorSource::new(
            &profile,
            section,
            input["fromMore"].as_bool().unwrap(),
            input["referenceDate"].as_str().unwrap(),
            &clock,
            &resolver,
        )
        .and_then(|source| {
            assert!(std::ptr::eq(source.original_profile(), &profile));
            if case["operation"] == "bootstrap" {
                source.bootstrap(&resolver)
            } else {
                let empty = json!({});
                let draft = EditorDraftPatch::try_from_raw(input.get("draft").unwrap_or(&empty))?;
                source.preview(&draft, input["referenceDate"].as_str().unwrap(), &resolver)
            }
        });
        let actual = match result {
            Ok(value) => json!({"ok":true,"value":value}),
            Err(error) => json!({"ok":false,"name":error.name(),"message":error.to_string()}),
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
        if input["ignoredTargetDays"] == 50_000 {
            assert!(serde_json::to_vec(&actual).unwrap().len() < 16_384);
            assert!(actual["value"]["draft"].get("workingTimeTarget").is_none());
        }
    }
}

#[test]
fn only_raw_editable_fields_are_accepted_as_draft_inputs() {
    for raw in [
        Value::Null,
        json!({"ready":true}),
        json!({"tariffTouched":false}),
        json!({"payLevel":true}),
        json!({"confirmedGroups":[1]}),
    ] {
        assert!(EditorDraftPatch::try_from_raw(&raw).is_err());
    }
    assert!(EditorDraftPatch::try_from_raw(&json!({})).is_ok());
}
#[test]
fn original_editor_metadata_uses_native_baseline_and_raw_current_fields() {
    let data = value_pool::decode(include_str!(
        "../../reference/profile-editor-view-golden.json"
    ));
    let resolver = RuleResolver::bundled().unwrap();
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let section = serde_json::from_value(input["section"].clone()).unwrap();
        let clock = FormClock::from_instant(input["instant"].as_str().unwrap()).unwrap();
        let source = ProfileEditorSource::new(
            &input["profile"],
            section,
            input["fromMore"].as_bool().unwrap(),
            input["referenceDate"].as_str().unwrap(),
            &clock,
            &resolver,
        )
        .unwrap();
        let empty = json!({});
        let patch = EditorDraftPatch::try_from_raw(input.get("draft").unwrap_or(&empty)).unwrap();
        assert_eq!(
            source.editor_metadata(&patch).unwrap(),
            case["expected"],
            "{}",
            case["id"]
        );
    }
    assert_eq!(data["cases"].as_array().unwrap().len(), 680);
}
