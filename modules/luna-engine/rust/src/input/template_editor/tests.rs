use super::*;
use crate::input::{
    calendar_rows, employment::RawEmploymentHistory, personal_context::CheckedWorkPatternSettings,
    profile_clock::prepare_profile_clock, stored_profile::checked_stored_work_profile,
};
use serde_json::{Value, json};
use std::sync::Arc;
fn provider(input: &Value) -> Value {
    let raw = &input["rawProfile"];
    let stored = if raw["profile"].is_null() {
        None
    } else {
        Some(
            checked_stored_work_profile(
                Arc::new(raw["profile"]["profileRow"].clone()),
                Arc::new(raw["profile"]["salaryRows"].as_array().unwrap().clone()),
            )
            .unwrap(),
        )
    };
    let history = RawEmploymentHistory::try_from_rows(Arc::new(
        raw["historyRows"].as_array().unwrap().clone(),
    ))
    .unwrap();
    let pattern = CheckedWorkPatternSettings::try_from_raw_rows(&raw["patternRows"]).unwrap();
    prepare_profile_clock(
        stored.as_ref(),
        Some(&history),
        input["observedEpochMilliseconds"].as_i64().unwrap(),
    )
    .unwrap()
    .editor_profile(Some(&pattern), Some(&history))
    .unwrap()
    .map_or(Value::Null, |p| p.as_ref().clone())
}
#[test]
fn original_template_draft_render_and_submit_prefixes() {
    let data = crate::test_value_pool::decode(include_str!(
        "../../../../reference/template-editor-golden.json"
    ));
    assert_eq!(data["cases"].as_array().unwrap().len(), 129);
    let mut frames = 0;
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let templates = input["templates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| calendar_rows::map_template(row).unwrap())
            .collect::<Vec<_>>();
        let existing = templates
            .iter()
            .find(|t| t["id"] == input["existingId"])
            .cloned()
            .unwrap_or(Value::Null);
        let profile = provider(input);
        let instant = crate::input::javascript_date::iso_from_epoch_milliseconds(
            input["observedEpochMilliseconds"].as_f64().unwrap(),
        )
        .unwrap();
        let clock = crate::input::profile_form::FormClock::from_instant(&instant).unwrap();
        let mut draft = TemplateEditorDraft::new_raw(&existing, &data["appearance"]).unwrap();
        let ios = input["platform"] == "ios";
        let mut effects = Vec::<Value>::new();
        let mut writes = Vec::<Value>::new();
        let steps = input["steps"].as_array().unwrap();
        for index in 0..=steps.len() {
            if index > 0 {
                let step = &steps[index - 1];
                match step["kind"].as_str().unwrap(){
                    "COMMIT"|"FAIL"|"CONFIRM_ARCHIVE"=>break,
                    "FIELD"=>draft.set_field(step["field"].as_str().unwrap(),&step["value"]).unwrap(),
                    "TYPE"=>draft.choose_type(step["value"].as_str().unwrap()).unwrap(),
                    "OPEN_TYPE"=>{if let Some(effect)=draft.open_type_picker(ios,input["dark"]==true){effects.push(effect);}},
                    "CHOOSE_TYPE"=>{if let Some(kind)=["CUSTOM","TRAINING","VACATION","SICK","FREE"].get(step["value"].as_u64().unwrap() as usize){draft.choose_type(kind).unwrap();}},
                    "SET_EXISTING"=>{},
                    "ARCHIVE"=>{if let Some(effect)=draft.delete_confirmation(){effects.push(effect);}},
                    "SUBMIT"=>match draft.prepare_submit(&templates).unwrap(){
                        TemplateSubmitStart::Ignored=>{},
                        TemplateSubmitStart::Blocked{field,message}=>effects.push(json!({"kind":"FOCUS","field":field,"message":message})),
                        TemplateSubmitStart::Prepared(submission)=>writes.push(json!({"kind":"TEMPLATE","input":submission.input(),"inputJson":submission.input_json().unwrap()})),
                    },
                    other=>panic!("unhandled original prefix {other}"),
                }
            }
            let actual = draft
                .render(&profile, &clock, input["quickEntryDate"].as_str(), ios)
                .unwrap();
            let expected = &case["expected"]["frames"][index];
            assert_eq!(
                actual,
                json!({"fields":expected["fields"],"flags":expected["flags"],"controls":expected["controls"]}),
                "{} frame{index}",
                case["id"]
            );
            assert_eq!(
                json!(effects),
                expected["effects"],
                "{} frame{index} effects",
                case["id"]
            );
            assert_eq!(
                json!(writes),
                expected["writes"],
                "{} frame{index} captured ordered input",
                case["id"]
            );
            frames += 1;
        }
    }
    assert_eq!(frames, 509);
}

fn fixture() -> Value {
    crate::test_value_pool::decode(include_str!(
        "../../../../reference/template-editor-golden.json"
    ))
}

#[test]
fn raw_template_limits_reject_computed_state_without_mutation() {
    let data = fixture();
    let mut draft = TemplateEditorDraft::new_raw(&Value::Null, &data["appearance"]).unwrap();
    let before = draft.fields().clone();
    for (field, value) in [
        ("saving", json!(true)),
        ("error", json!("invented")),
        ("type", json!("SICK")),
        ("name", json!("😄".repeat(65_536))),
        ("allDay", json!("true")),
        ("name", Value::Null),
        ("specialDuty", json!([])),
    ] {
        assert!(draft.set_field(field, &value).is_err(), "{field}");
        assert_eq!(draft.fields(), &before, "rejected event is atomic");
    }
    assert!(draft.choose_type("HOST_READY").is_err());
    assert_eq!(draft.fields(), &before);
}

#[test]
fn captured_raw_number_and_editable_draft_are_independent() {
    let data = fixture();
    for (raw, number) in [
        ("NaN", f64::NAN),
        ("Infinity", f64::INFINITY),
        ("-Infinity", f64::NEG_INFINITY),
        ("0x1e", 30.0),
    ] {
        let mut draft = TemplateEditorDraft::new_raw(&Value::Null, &data["appearance"]).unwrap();
        draft.set_field("breakMinutes", &json!(raw)).unwrap();
        let TemplateSubmitStart::Prepared(submission) = draft.prepare_submit(&[]).unwrap() else {
            panic!("source required checks pass")
        };
        if number.is_nan() {
            assert!(submission.pause_number().is_nan());
        } else {
            assert_eq!(submission.pause_number(), number);
        }
        assert_eq!(
            submission.input()["breakMinutes"],
            if number.is_finite() {
                json!(30)
            } else {
                Value::Null
            }
        );
        let input_json = submission.input_json().unwrap();
        draft
            .set_field("name", &json!("Während des Speicherns geändert"))
            .unwrap();
        assert_eq!(submission.input()["name"], "Neuer Dienst");
        assert_eq!(submission.input_json().unwrap(), input_json);
        assert!(matches!(
            draft.prepare_submit(&[]).unwrap(),
            TemplateSubmitStart::Ignored
        ));
        assert_eq!(draft.fields()["breakMinutes"], raw);
    }
}

#[test]
fn template_render_borrows_and_releases_large_provider_context() {
    let data = fixture();
    let input = &data["cases"][0]["input"];
    let mut profile = provider(input);
    let draft = TemplateEditorDraft::new_raw(&Value::Null, &data["appearance"]).unwrap();
    let clock =
        crate::input::profile_form::FormClock::from_instant("2026-11-12T14:59:59Z").unwrap();
    let original = draft.render(&profile, &clock, None, true).unwrap();
    profile["workingTimeTarget"] = json!({"context":{"days":(0..50_000).map(|index|json!({"date":"2026-11-12","syntheticIgnoredIndex":index})).collect::<Vec<_>>()}});
    let shared = Arc::new(profile);
    let weak = Arc::downgrade(&shared);
    let actual = draft.render(&shared, &clock, None, true).unwrap();
    assert_eq!(actual, original);
    assert!(serde_json::to_vec(&actual).unwrap().len() < 4096);
    assert_eq!(Arc::strong_count(&shared), 1);
    drop(shared);
    assert!(
        weak.upgrade().is_none(),
        "no provider/target owner retained in view or raw draft"
    );
}

#[test]
fn source_role_tariff_query_retains_full_provider_and_uses_original_render_epoch() {
    let data = crate::test_value_pool::decode(include_str!(
        "../../../../reference/template-editor-golden.json"
    ));
    let mut count = 0;
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let profile = provider(input);
        let date = input["quickEntryDate"].as_str();
        let actual = tariff_query(
            &profile,
            date,
            input["observedEpochMilliseconds"].as_f64().unwrap(),
        )
        .unwrap();
        assert_eq!(
            actual, case["expected"]["frames"][0]["flags"]["tariffFamily"],
            "{}",
            case["id"]
        );
        if date.is_some() {
            assert_eq!(tariff_query(&profile, date, f64::NAN).unwrap(), actual);
        }
        count += 1;
    }
    assert_eq!(count, 129);
    assert_eq!(
        tariff_query(&Value::Null, None, f64::NAN).unwrap(),
        Value::Null
    );
    assert_eq!(
        tariff_query(&json!({"salaryBasisConflict":true}), None, f64::NAN).unwrap(),
        Value::Null
    );
}
