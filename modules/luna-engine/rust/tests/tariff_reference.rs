use luna_engine::pay::{
    conditions::{ConditionShift, RuleConditions, conditions_match},
    tariff::{self, TariffError, TariffProfile},
};
use luna_engine::rules::{PackageIds, RuleResolver};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn result<T: Serialize>(v: Result<T, TariffError>) -> Value {
    match v {
        Ok(v) => json!(v),
        Err(e) => json!({"$error":{"name":"Error","message":e.0}}),
    }
}
#[test]
fn all_tariff_rates_and_pay_conditions_match_frozen_source_exactly() {
    let reference: Value =
        serde_json::from_str(include_str!("../../reference/tariff-golden.json")).unwrap();
    assert_eq!(
        reference["baselineDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let mut resolvers = BTreeMap::new();
    for data in reference["resolvers"].as_array().unwrap() {
        let ids: PackageIds = serde_json::from_value(data["packageIds"].clone()).unwrap();
        resolvers.insert(
            data["id"].as_str().unwrap(),
            RuleResolver::from_catalog_json(data["catalog"].clone(), ids, None).unwrap(),
        );
    }
    let cases = reference["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 3720);
    for case in cases {
        let input = &case["input"];
        let actual = match case["operation"].as_str().unwrap() {
            "tariff.version" => result(tariff::get_tariff_version(
                input["date"].as_str().unwrap(),
                resolvers.get(input["resolver"].as_str().unwrap()).unwrap(),
            )),
            "tariff.rates" => {
                let resolver = resolvers.get(input["resolver"].as_str().unwrap()).unwrap();
                let date = input["date"].as_str().unwrap();
                let profile: TariffProfile =
                    serde_json::from_value(input["profile"].clone()).unwrap();
                let individual = tariff::get_individual_hourly_rate(&profile, date, resolver);
                let overtime = match (tariff::get_tariff_rule_package(date, resolver), &individual)
                {
                    (Some(package), Ok(Some(rate))) => result(
                        tariff::get_overtime_base_hourly_rate(package, &profile, *rate),
                    ),
                    _ => Value::Null,
                };
                json!({"monthly":result(tariff::get_monthly_table_amount(&profile,date,resolver)),"individual":result(individual),"weekly":result(tariff::get_tariff_full_time_weekly_minutes(&profile,date,resolver)),"step3":result(tariff::get_hourly_table_amount_for_step(&profile,date,"s3",resolver)),"premium":result(tariff::get_premium_hourly_rate(&profile,date,resolver)),"overtime":overtime})
            }
            "pay.conditions" => {
                let conditions: RuleConditions =
                    serde_json::from_value(input["conditions"].clone()).unwrap();
                let profile: Option<TariffProfile> =
                    serde_json::from_value(input["profile"]["tariff"].clone()).unwrap();
                let shift = if input["shift"].is_null() {
                    None
                } else {
                    Some(ConditionShift {
                        shift_type: input["shift"]["type"].as_str().unwrap(),
                        holiday_premium_mode: input["shift"]["holidayPremiumMode"]
                            .as_str()
                            .unwrap(),
                    })
                };
                json!(conditions_match(
                    &conditions,
                    profile.as_ref(),
                    input["profile"]["federalState"].as_str().unwrap(),
                    input["date"].as_str().unwrap(),
                    shift,
                    input["allowanceStatus"].as_str()
                ))
            }
            operation => panic!("Unknown operation {operation}"),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
mod common;
