mod common;
use luna_engine::pay::{
    allowances::{AllowanceCalculationInput, calculate_monthly_allowance_amounts},
    duty_policy::{self, DutyTariffFamily},
    manual::create_manual_monthly_pay_estimate,
    tariff::TariffProfile,
};
use luna_engine::rules::{PackageIds, RuleResolver};
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[test]
fn manual_pay_allowances_and_duty_policy_match_complete_frozen_outputs() {
    let data: Value =
        serde_json::from_str(include_str!("../../reference/pay-basics-golden.json")).unwrap();
    assert_eq!(
        data["baselineDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let mut resolvers = BTreeMap::new();
    for r in data["resolvers"].as_array().unwrap() {
        let ids: PackageIds = serde_json::from_value(r["packageIds"].clone()).unwrap();
        resolvers.insert(
            r["id"].as_str().unwrap(),
            RuleResolver::from_catalog_json(r["catalog"].clone(), ids, None).unwrap(),
        );
    }
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 5058);
    for case in cases {
        let input = &case["input"];
        let family: Option<DutyTariffFamily> =
            serde_json::from_value(input["family"].clone()).unwrap();
        let actual = match case["operation"].as_str().unwrap() {
            "pay.manual" => create_manual_monthly_pay_estimate(
                input["month"].as_str().unwrap(),
                input["cents"].as_i64().unwrap(),
            )
            .unwrap(),
            "duty.sources" => {
                let source = duty_policy::rule_source(family.unwrap());
                json!({"version":source.version,"standby":source.standby,"onCall":source.on_call})
            }
            "duty.family" => json!(duty_policy::duty_tariff_family(&input["profile"])),
            "duty.levels" => json!(duty_policy::standby_levels(family)),
            "duty.factor" => json!(duty_policy::standby_normal_factor(
                family.unwrap(),
                input["level"].as_str().unwrap(),
                input["ordinal"].as_f64(),
                input["confirmed"].as_bool().unwrap(),
                input["date"].as_str().unwrap()
            )),
            "duty.baseHours" => json!(duty_policy::on_call_base_hours(
                family.unwrap(),
                input["minutes"].as_f64().unwrap(),
                input["weekend"].as_bool().unwrap()
            )),
            "duty.paidMinutes" => {
                let onsite: Vec<f64> = serde_json::from_value(input["onsite"].clone()).unwrap();
                let remote: Vec<f64> = serde_json::from_value(input["remote"].clone()).unwrap();
                match duty_policy::on_call_paid_minutes(family.unwrap(), &onsite, &remote) {
                    Ok(m) => json!(m),
                    Err(_) => {
                        json!({"$error":{"name":"Error","message":"Ungültige Einsatzdauer."}})
                    }
                }
            }
            "pay.allowances" => {
                let resolver = resolvers.get(input["resolver"].as_str().unwrap()).unwrap();
                let date = input["date"].as_str().unwrap();
                let profile = &input["profile"];
                let tariff: Option<TariffProfile> =
                    serde_json::from_value(profile["tariff"].clone()).unwrap();
                let input = AllowanceCalculationInput {
                    date,
                    full_time_weekly_minutes: input["fullTimeWeeklyMinutes"].as_f64().unwrap(),
                    tariff: tariff.as_ref(),
                    weekly_minutes: profile["weeklyMinutes"].as_f64().unwrap(),
                    federal_state: profile["federalState"].as_str().unwrap(),
                    rule_package: resolver.resolve_tariff(date, None).unwrap(),
                    status: input["status"].as_str(),
                    work_minutes: input["workMinutes"].as_f64().unwrap(),
                };
                match calculate_monthly_allowance_amounts(&input) {
                    Ok(result) => json!(result),
                    Err(error) => json!({"$error":{"name":"Error","message":error.0}}),
                }
            }
            op => panic!("Unknown operation {op}"),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
