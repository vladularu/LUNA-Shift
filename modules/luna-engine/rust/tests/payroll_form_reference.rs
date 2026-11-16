use luna_engine::input::{
    net_form::InitialNetSettings,
    payroll_form::{
        AnnualEditorSeed, AnnualUserDraft, prepare_annual_save, prepare_timing,
        reset_annual_settings,
    },
};
use luna_engine::net::payment_schedule::validate_salary_payment_preferences;
use serde_json::{Value, json};
#[path = "support/value_pool.rs"]
mod value_pool;

#[test]
fn original_annual_editor_ast_and_timing_mutations_match_native_drafts() {
    let source = value_pool::decode(include_str!("../../reference/payroll-form-golden.json"));
    for case in source["cases"].as_array().unwrap() {
        let input = &case["input"];
        let settings = InitialNetSettings::try_from_raw(&input["settings"])
            .unwrap_or_else(|error| panic!("initial {}: {error}", case["id"]));
        let seed = AnnualEditorSeed::new(
            input["month"].as_str().unwrap(),
            &input["profile"],
            &settings,
            &input["forecastPayments"],
            input["automatic"].as_bool().unwrap(),
        )
        .unwrap_or_else(|error| panic!("seed {}: {error}", case["id"]));
        assert_eq!(
            seed.value(),
            case["expected"]["seed"],
            "seed {}",
            case["id"]
        );
        let explicit = input
            .get("draft")
            .map(|raw| AnnualUserDraft::try_from_raw(raw).unwrap());
        let draft = explicit.as_ref().unwrap_or_else(|| seed.form());
        let result = match prepare_annual_save(
            &seed,
            &settings,
            draft,
            input["locked"].as_bool().unwrap_or(false),
        ) {
            Ok(Some(value)) => json!({"kind":"WRITE","settings":value.settings()}),
            Ok(None) => json!({"kind":"NO_CHANGE"}),
            Err(error) => json!({"kind":"ERROR","message":error.message()}),
        };
        assert_eq!(result, case["expected"]["result"], "save {}", case["id"]);
    }
    for case in source["reset"].as_array().unwrap() {
        let settings: Vec<_> = case["timeline"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| InitialNetSettings::try_from_raw(&row["settings"]).unwrap())
            .collect();
        assert_eq!(
            json!(reset_annual_settings(case["year"].as_i64().unwrap() as i32, &settings).unwrap()),
            case["expected"]
        );
    }
    for case in source["timing"].as_array().unwrap() {
        let preferences = validate_salary_payment_preferences(&case["preferences"]).unwrap();
        assert_eq!(
            json!(
                prepare_timing(
                    &preferences,
                    case["month"].as_str().unwrap(),
                    case["choice"].as_str().unwrap()
                )
                .unwrap()
            ),
            case["expected"]
        );
    }
}

#[test]
fn malformed_raw_drafts_are_not_promoted_to_calculation_evidence() {
    let source = value_pool::decode(include_str!("../../reference/payroll-form-golden.json"));
    let valid = &source["cases"][0]["expected"]["seed"]["form"];
    assert!(AnnualUserDraft::try_from_raw(valid).is_ok());
    for malformed in [
        Value::Null,
        json!([]),
        json!({}),
        json!({"ready":true,"settings":{}}),
    ] {
        assert!(AnnualUserDraft::try_from_raw(&malformed).is_err());
    }
    for field in ["payout", "gross", "forecast", "payroll", "yearValues"] {
        let mut missing = valid.clone();
        missing.as_object_mut().unwrap().remove(field);
        assert!(AnnualUserDraft::try_from_raw(&missing).is_err());
    }
    let mut injected = valid.clone();
    injected["ready"] = json!(true);
    assert!(AnnualUserDraft::try_from_raw(&injected).is_err());
    let mut huge = valid.clone();
    huge["gross"] = json!("0".repeat(4097));
    assert!(AnnualUserDraft::try_from_raw(&huge).is_err());
}

#[test]
fn integral_json_spellings_have_the_original_javascript_form_values() {
    let source = value_pool::decode(include_str!("../../reference/payroll-form-golden.json"));
    let case = source["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == "seed-7-false-true")
        .unwrap();
    let input = &case["input"];
    let settings = InitialNetSettings::try_from_raw(&input["settings"]).unwrap();
    let mut forecasts = input["forecastPayments"].clone();
    forecasts[0]["netBasis"]["socialInsuranceDays"] = json!(330.0);
    let seed = AnnualEditorSeed::new(
        input["month"].as_str().unwrap(),
        &input["profile"],
        &settings,
        &forecasts,
        false,
    )
    .unwrap();
    assert_eq!(seed.value()["form"], case["expected"]["seed"]["form"]);
}
