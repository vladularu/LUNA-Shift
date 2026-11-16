use luna_engine::{
    input::{
        profile_editor::{self, EditorIntent, EditorSection, EditorSession, ProfileEditorSource},
        profile_form::FormClock,
    },
    rules::RuleResolver,
};
use serde_json::json;
#[path = "support/value_pool.rs"]
mod value_pool;
#[test]
fn exact_original_submit_deltas_and_captured_dated_builders_match() {
    let data = value_pool::decode(include_str!(
        "../../reference/profile-editor-submit-golden.json"
    ));
    let resolver = RuleResolver::bundled().unwrap();
    assert!(data["cases"].as_array().unwrap().len() > 1250);
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let section: EditorSection = serde_json::from_value(input["section"].clone()).unwrap();
        let clock = FormClock::from_instant(input["instant"].as_str().unwrap()).unwrap();
        let date = input["referenceDate"].as_str().unwrap();
        let source = ProfileEditorSource::new(
            &input["profile"],
            section,
            input["fromMore"].as_bool().unwrap(),
            date,
            &clock,
            &resolver,
        )
        .unwrap();
        let mut session = EditorSession::new(&source);
        for raw in input["actions"].as_array().unwrap() {
            let action: EditorIntent = serde_json::from_value(raw.clone()).unwrap();
            session.apply(&action, date, &clock, &resolver).unwrap();
        }
        let submission = profile_editor::prepare(&session, date, &resolver).unwrap();
        let mut actual = submission.feedback();
        match submission.build(
            input["buildDate"].as_str().unwrap_or(date),
            input["final"].as_bool().unwrap(),
            &resolver,
        ) {
            Ok(Some(built)) => {
                actual["built"] = json!({"ok":true,"value":serde_json::to_value(built).unwrap()})
            }
            Ok(None) => {}
            Err(error) => {
                let mut value = json!({"ok":false,"name":error.name(),"message":error.to_string()});
                if let Some(failure) = error.rule_failure() {
                    value["failure"] = serde_json::to_value(failure).unwrap();
                }
                actual["built"] = value;
            }
        }
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}

#[test]
fn source_metadata_is_borrowed_and_never_enters_the_small_ui_feedback_or_override_patch() {
    let data = value_pool::decode(include_str!(
        "../../reference/profile-editor-submit-golden.json"
    ));
    let input = &data["cases"][0]["input"];
    let mut profile = input["profile"].clone();
    profile["workingTimeTarget"] =
        json!({"days":vec![json!({"date":"2026-11-01","targetMinutes":462});50_000]});
    let resolver = RuleResolver::bundled().unwrap();
    let clock = FormClock::from_instant(input["instant"].as_str().unwrap()).unwrap();
    let source = ProfileEditorSource::new(
        &profile,
        EditorSection::Employment,
        false,
        "2026-11-15",
        &clock,
        &resolver,
    )
    .unwrap();
    let session = EditorSession::new(&source);
    let submission = profile_editor::prepare(&session, "2026-11-15", &resolver).unwrap();
    assert!(serde_json::to_vec(&submission.feedback()).unwrap().len() < 4096);
    let built = submission
        .build("2026-11-15", true, &resolver)
        .unwrap()
        .unwrap();
    assert!(std::ptr::eq(
        built.field("workingTimeTarget").unwrap(),
        &profile["workingTimeTarget"]
    ));
    assert!(!built.changes().contains_key("workingTimeTarget"));
    assert!(!built.changes().contains_key("employmentTimeline"));
    assert!(serde_json::to_vec(built.changes()).unwrap().len() < 8192);
}
