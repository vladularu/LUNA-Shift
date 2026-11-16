mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    input::{net_form::InitialNetSettings, payroll_form::AnnualEditorSeed},
    runtime::payroll_form::presentation,
};
use serde_json::json;
#[test]
fn complete_original_annual_editor_ui_props_and_handlers_match_native_facts() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/annual-editor-presentation-golden.json"
    ));
    for case in fixture["cases"].as_array().unwrap() {
        let input = &case["input"];
        let settings = InitialNetSettings::try_from_raw(&input["settings"]).unwrap();
        let seed = AnnualEditorSeed::new(
            input["month"].as_str().unwrap(),
            &input["profile"],
            &settings,
            &input["forecastPayments"],
            input["automatic"].as_bool().unwrap(),
        )
        .unwrap();
        let annual = json!({"payments":input["forecastPayments"],"proposal":input["proposal"],"issue":input["issue"],"automatic":input["automatic"]});
        let value = presentation::present(
            input["month"].as_str().unwrap(),
            &input["profile"],
            &settings,
            &seed,
            &annual,
        )
        .unwrap_or_else(|error| panic!("{}: {error:?}", case["id"]));
        common::assert_json_eq(&value, &case["expected"], case["id"].as_str().unwrap());
    }
}
