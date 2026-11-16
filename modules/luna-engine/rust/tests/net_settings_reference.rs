use luna_engine::net::settings::{
    SettingsError, collect_annual_salary_payments, resolve_net_pay_settings,
    validate_monthly_net_pay_settings, validate_net_pay_automation,
};
use serde_json::{Value, json};

#[test]
fn dated_settings_and_revision_merges_match_every_frozen_source_case() {
    let reference: Value =
        serde_json::from_str(include_str!("../../reference/net-settings-golden.json"))
            .expect("frozen settings facts");
    let cases = reference["cases"].as_array().expect("cases");
    assert_eq!(cases.len(), 505);
    for case in cases {
        let input = &case["input"];
        let result = match case["operation"].as_str().expect("operation") {
            "settings" => validate_monthly_net_pay_settings(&input["value"]),
            "automation" => validate_net_pay_automation(&input["value"]),
            "resolve" => input["month"]
                .as_str()
                .ok_or(SettingsError::Profile)
                .and_then(|month| {
                    resolve_net_pay_settings(
                        month,
                        input["timeline"].as_array().expect("source rows"),
                    )
                }),
            "collect" => {
                collect_annual_salary_payments(input["timeline"].as_array().expect("source rows"))
            }
            other => panic!("unknown operation {other}"),
        };
        let actual = match result {
            Ok(value) => value,
            Err(error) => json!({"$error":error.to_string()}),
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}
