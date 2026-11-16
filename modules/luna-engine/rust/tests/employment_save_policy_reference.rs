use luna_engine::input::{
    profile_editor::{self, SaveScope},
    profile_form::{FormClock, ProfileFormError},
};
use serde_json::{Value, json};
#[path = "support/value_pool.rs"]
mod value_pool;
fn evaluate(operation: &str, i: &Value) -> Result<Value, ProfileFormError> {
    Ok(match operation {
        "fields" => json!(profile_editor::changed_fields(&i["before"], &i["after"])?),
        "lines" => json!(profile_editor::change_lines(
            &i["before"],
            &i["after"],
            &FormClock::from_instant(i["instant"].as_str().unwrap())?
        )?),
        "label" => json!(profile_editor::salary_label(&i["profile"])?),
        "undo" => {
            serde_json::to_value(profile_editor::undo_input(&i["before"], &i["saved"])?).unwrap()
        }
        "validity" => {
            let scope: SaveScope = serde_json::from_value(i["scope"].clone()).unwrap();
            serde_json::to_value(profile_editor::prepare_validity(
                &i["before"],
                &i["after"],
                scope,
                i["day"].as_str().unwrap(),
            )?)
            .unwrap()
        }
        _ => panic!("unknown operation"),
    })
}
#[test]
fn original_change_lines_salary_labels_undo_and_actual_validity_expression_match() {
    let data = value_pool::decode(include_str!(
        "../../reference/employment-save-policy-golden.json"
    ));
    assert_eq!(data["cases"].as_array().unwrap().len(), 10132);
    for c in data["cases"].as_array().unwrap() {
        let actual = match evaluate(c["operation"].as_str().unwrap(), &c["input"]) {
            Ok(value) => json!({"ok":true,"value":value}),
            Err(e) => json!({"ok":false,"name":e.name(),"message":e.to_string()}),
        };
        assert_eq!(actual, c["expected"], "{}", c["id"]);
    }
}
#[test]
fn native_save_views_keep_large_source_metadata_borrowed_and_small_diffs_independent() {
    use luna_engine::{
        input::profile_editor::{EditorIntent, EditorSection, EditorSession, ProfileEditorSource},
        rules::RuleResolver,
    };
    let data = value_pool::decode(include_str!(
        "../../reference/employment-save-policy-golden.json"
    ));
    let mut profile = data["cases"][0]["input"]["profile"].clone();
    profile["workingTimeTarget"] = json!({"days":(0..50_000).map(|_|json!({"date":"2026-11-01","targetMinutes":462})).collect::<Vec<_>>()});
    let resolver = RuleResolver::bundled().unwrap();
    let clock = FormClock::from_instant("2026-11-15T12:00:00Z").unwrap();
    let source = ProfileEditorSource::new(
        &profile,
        EditorSection::Work,
        true,
        "2026-11-15",
        &clock,
        &resolver,
    )
    .unwrap();
    let mut session = EditorSession::new(&source);
    let intent: EditorIntent =
        serde_json::from_value(json!({"kind":"FIELD","field":"weeklyHours","value":"40"})).unwrap();
    session
        .apply(&intent, "2026-11-15", &clock, &resolver)
        .unwrap();
    let submission = profile_editor::prepare(&session, "2026-11-15", &resolver).unwrap();
    let built = submission
        .build("2026-11-15", true, &resolver)
        .unwrap()
        .unwrap();
    assert!(std::ptr::eq(
        built.field("workingTimeTarget").unwrap(),
        &profile["workingTimeTarget"]
    ));
    let fields = profile_editor::changed_fields(&profile, &built).unwrap();
    assert!(fields.contains(&"weeklyMinutes".to_owned()));
    let validity = profile_editor::save_validity(&profile, &built, None).unwrap();
    assert!(serde_json::to_vec(&validity).unwrap().len() < 8 * 1024);
    let undo = profile_editor::undo_input(&profile, &profile).unwrap();
    assert!(std::ptr::eq(
        undo.field("workingTimeTarget").unwrap(),
        &profile["workingTimeTarget"]
    ));
    assert!(serde_json::to_vec(undo.changes()).unwrap().len() < 8 * 1024);
}
