use luna_engine::{
    input::{
        profile_editor::{EditorIntent, EditorSection, EditorSession, ProfileEditorSource},
        profile_form::FormClock,
    },
    rules::RuleResolver,
};
use serde_json::json;
#[path = "support/value_pool.rs"]
mod value_pool;
#[test]
fn actual_original_field_group_mode_and_cached_roundtrip_intents_match() {
    let data = value_pool::decode(include_str!(
        "../../reference/profile-editor-transitions-golden.json"
    ));
    let resolver = RuleResolver::bundled().unwrap();
    assert!(data["cases"].as_array().unwrap().len() > 570);
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let section: EditorSection = serde_json::from_value(input["section"].clone()).unwrap();
        let clock = FormClock::from_instant(input["instant"].as_str().unwrap()).unwrap();
        let date = input["referenceDate"].as_str().unwrap();
        let result = ProfileEditorSource::new(
            &input["profile"],
            section,
            input["fromMore"].as_bool().unwrap(),
            date,
            &clock,
            &resolver,
        )
        .and_then(|source| {
            let mut session = EditorSession::new(&source);
            for raw in input["actions"].as_array().unwrap() {
                let action: EditorIntent = serde_json::from_value(raw.clone()).unwrap();
                session.apply(&action, date, &clock, &resolver)?;
            }
            session.state(date, &resolver)
        });
        let actual = match result {
            Ok(value) => json!({"ok":true,"value":value}),
            Err(error) => json!({"ok":false,"name":error.name(),"message":error.to_string()}),
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}

#[test]
fn host_intents_cannot_supply_confirmations_touched_flags_or_cached_native_state() {
    for raw in [
        json!({"kind":"FIELD","field":"confirmedGroups","value":["TVOED_P"]}),
        json!({"kind":"FIELD","field":"pFullTimeOverride","value":2400}),
        json!({"kind":"FIELD","field":"lastTariffMode","value":"TVOED_P"}),
        json!({"kind":"FIELD","field":"dirty","value":false}),
        json!({"kind":"MODE","value":"TVOED_P","tariffTouched":true}),
        json!({"kind":"MODE","value":"TVOED_P","salaryDrafts":{"TVOED_P":{}}}),
    ] {
        assert!(serde_json::from_value::<EditorIntent>(raw).is_err());
    }
}
