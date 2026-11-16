mod common;
use luna_engine::input::{InputError, net_form::*};
use serde_json::{Value, json};

fn run(operation: &str, input: &Value) -> Result<Value, InputError> {
    let initial = if input.get("initial").is_some_and(|v| !v.is_null()) {
        Some(InitialNetSettings::try_from_raw(&input["initial"])?)
    } else {
        None
    };
    let state = || NetFormState::try_from_raw(&input["form"]);
    let month = input["month"].as_str().unwrap_or("");
    match operation {
        "decimal" => parse_decimal(
            input["text"].as_str().unwrap(),
            match input["scale"].as_i64().unwrap() {
                1 => DecimalScale::Units,
                100 => DecimalScale::Cents,
                1000 => DecimalScale::Permille,
                _ => panic!("outside typed UI scales"),
            },
            input["label"].as_str().unwrap(),
        )
        .map(|v| json!(v)),
        "prefill" => form_values(initial.as_ref()).map(|v| json!(v)),
        "setupPrefill" => setup_values(initial.as_ref(), input["worksInSaxony"].as_bool().unwrap())
            .map(|v| json!(v)),
        "monthly" => prepare_monthly(month, &state()?).map(ValidatedNetDraft::into_settings),
        "step" => validate_step(month, input["step"].as_u64().unwrap() as u32, &state()?)
            .map(|_| json!({"validated":true})),
        "setup" => prepare_setup(SetupInput {
            month,
            form: &state()?,
            pension_scheme: input["pensionScheme"].as_str(),
            additional_gross: input["additionalGross"].as_str().unwrap(),
            additional_net: input["additionalNet"].as_str().unwrap(),
            initial: initial.as_ref(),
            pension_employee_rate: input["pensionEmployeeRate"].as_str().unwrap_or(""),
        })
        .map(ValidatedNetDraft::into_settings),
        "amounts" => {
            parse_amounts(&serde_json::from_value(input["form"].clone()).unwrap()).map(|v| json!(v))
        }
        _ => panic!("unknown operation"),
    }
}
fn corpus() -> Value {
    serde_json::from_str(include_str!("../../reference/net-form-golden.json")).unwrap()
}
#[test]
fn full_raw_form_policy_matches_frozen_source_outputs_and_error_order() {
    let bundle = corpus();
    assert_eq!(bundle["cases"].as_array().unwrap().len(), 846);
    for case in bundle["cases"].as_array().unwrap() {
        let actual = match run(case["operation"].as_str().unwrap(), &case["input"]) {
            Ok(v) => v,
            Err(e) => json!({"$error":{"name":e.name(),"message":e.message()}}),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
#[test]
fn malformed_runtime_records_are_rejected_before_entering_typed_form_policy() {
    let bundle = corpus();
    assert_eq!(bundle["boundaries"].as_array().unwrap().len(), 57);
    for case in bundle["boundaries"].as_array().unwrap() {
        assert!(
            run(case["operation"].as_str().unwrap(), &case["input"]).is_err(),
            "{} original outcome retained separately: {}",
            case["id"],
            case["expected"]
        );
    }
}
