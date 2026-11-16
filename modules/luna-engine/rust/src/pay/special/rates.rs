use super::types::{round_integer, text, truthy};
use super::{DutyOvertimeRates, SpecialDutyError, StandbyHourlyRate};
use crate::pay::{
    conditions::{ConditionShift, RuleConditions, conditions_match},
    duty_policy::duty_tariff_family,
    families::{self, Family},
    tariff::{self, TariffProfile},
};
use crate::rules::RuleResolver;
use serde::Deserialize;
use serde_json::Value;
use std::sync::OnceLock;

fn selected_family(profile: &Value) -> Option<Family> {
    [
        ("vkaETariff", Family::VkaE),
        ("nursingTrainingTariff", Family::Training),
        ("tvlKrTariff", Family::Tvl),
        ("tvhKrTariff", Family::Tvh),
        ("tvUkNursingTariff", Family::Tvuk),
        ("tvalPflegeTariff", Family::Tval),
    ]
    .into_iter()
    .find_map(|(key, family)| truthy(profile.get(key)).then_some(family))
}
pub fn hourly_cents(
    date: &str,
    profile: &Value,
    resolver: &RuleResolver,
) -> Result<Option<i64>, SpecialDutyError> {
    if truthy(profile.get("salaryBasisConflict"))
        || profile
            .get("manualMonthlyGrossCents")
            .is_some_and(|value| !value.is_null())
    {
        return Ok(None);
    }
    let count = [
        "tariff",
        "vkaETariff",
        "nursingTrainingTariff",
        "tvlKrTariff",
        "tvhKrTariff",
        "tvUkNursingTariff",
        "tvalPflegeTariff",
    ]
    .iter()
    .filter(|key| truthy(profile.get(**key)))
    .count();
    if count != 1 {
        return Ok(None);
    }
    if truthy(profile.get("tariff")) {
        let tariff = TariffProfile::deserialize(&profile["tariff"])
            .map_err(|_| SpecialDutyError::InvalidInput)?;
        return tariff::get_individual_hourly_rate(&tariff, date, resolver)?
            .map(|value| round_integer(value * 100.0))
            .transpose();
    }
    Ok(families::duty_hourly_cents(
        selected_family(profile).ok_or(SpecialDutyError::InvalidInput)?,
        date,
        profile,
        resolver,
    )?)
}
pub fn overtime_rates(
    date: &str,
    profile: &Value,
    shift: &Value,
    resolver: &RuleResolver,
) -> Result<Option<DutyOvertimeRates>, SpecialDutyError> {
    let Some(hourly) = hourly_cents(date, profile, resolver)? else {
        return Ok(None);
    };
    if truthy(profile.get("tvUkNursingTariff")) {
        return Ok(Some(DutyOvertimeRates {
            base_hourly_cents: hourly,
            premium_hourly_cents: hourly,
            premium_basis_points: 2500,
        }));
    }
    if let Some(family) = selected_family(profile) {
        return Ok(
            families::duty_overtime_rates(family, date, profile, resolver)?.map(|rates| {
                DutyOvertimeRates {
                    base_hourly_cents: rates.base_hourly_cents,
                    premium_hourly_cents: rates.premium_hourly_cents,
                    premium_basis_points: rates.premium_basis_points,
                }
            }),
        );
    }
    let Some(pkg) = tariff::get_tariff_rule_package(date, resolver) else {
        return Ok(None);
    };
    let tariff = TariffProfile::deserialize(&profile["tariff"])
        .map_err(|_| SpecialDutyError::InvalidInput)?;
    let mut matches = Vec::new();
    for rule in pkg.rules()["premiumRules"]
        .as_array()
        .ok_or(SpecialDutyError::InvalidInput)?
    {
        if rule["premiumType"] != "OVERTIME" {
            continue;
        }
        let conditions = RuleConditions::deserialize(&rule["conditions"])
            .map_err(|_| SpecialDutyError::InvalidInput)?;
        if conditions_match(
            &conditions,
            Some(&tariff),
            text(profile, "federalState")?,
            date,
            Some(ConditionShift {
                shift_type: text(shift, "type")?,
                holiday_premium_mode: text(shift, "holidayPremiumMode")?,
            }),
            None,
        ) {
            matches.push(rule);
        }
    }
    if matches.len() != 1 {
        return Ok(None);
    }
    let rule = matches[0];
    let premium = if rule["rateBasis"] == "INDIVIDUAL_HOURLY" {
        Some(hourly as f64 / 100.0)
    } else if let Some(step) = rule["referenceStepId"].as_str() {
        tariff::get_hourly_table_amount_for_step(&tariff, date, step, resolver)?
    } else {
        None
    };
    let Some(premium) = premium else {
        return Ok(None);
    };
    Ok(Some(DutyOvertimeRates {
        base_hourly_cents: round_integer(
            tariff::get_overtime_base_hourly_rate(pkg, &tariff, hourly as f64 / 100.0)? * 100.0,
        )?,
        premium_hourly_cents: round_integer(premium * 100.0)?,
        premium_basis_points: rule["percentageBasisPoints"]
            .as_i64()
            .ok_or(SpecialDutyError::InvalidInput)?,
    }))
}

pub(crate) fn tables() -> Result<&'static Value, SpecialDutyError> {
    static TABLES: OnceLock<Result<Value, serde_json::Error>> = OnceLock::new();
    TABLES
        .get_or_init(|| {
            serde_json::from_str(include_str!(
                "../../../../../../src/engine/standby-tables.json"
            ))
        })
        .as_ref()
        .map_err(|_| SpecialDutyError::InvalidInput)
}

pub fn standby_hourly_rate(
    date: &str,
    profile: &Value,
    agreement: &Value,
    resolver: &RuleResolver,
) -> Result<Option<StandbyHourlyRate>, SpecialDutyError> {
    let regular = hourly_cents(date, profile, resolver)?;
    let family = duty_tariff_family(profile)
        .map(serde_json::to_value)
        .transpose()
        .map_err(|_| SpecialDutyError::InvalidInput)?;
    if regular.is_none()
        || family.as_ref() != agreement.get("tariff")
        || !("2026-01-01"..="2026-12-31").contains(&date)
    {
        return Ok(None);
    }
    let tariff = text(agreement, "tariff")?;
    if agreement["rateMode"] == "AGREED" {
        return Ok(agreement["hourlyCents"]
            .as_i64()
            .map(|cents| StandbyHourlyRate {
                cents,
                group: "Vereinbarter Stundensatz".into(),
                source: "Stundenentgelt laut Arbeitgeber, vor Bewertung".into(),
            }));
    }
    if tariff == "TVUK" {
        return Ok(Some(StandbyHourlyRate {
            cents: regular.ok_or(SpecialDutyError::InvalidInput)?,
            group: text(&profile["tvUkNursingTariff"], "payGroup")?.into(),
            source: "§ 12 Abs. 1 TV-UK".into(),
        }));
    }
    if truthy(profile.get("nursingTrainingTariff")) || truthy(profile.get("tvalPflegeTariff")) {
        return Ok(None);
    }
    let tables = tables()?;
    if tariff == "TVL_43" || tariff == "TVH_43" {
        let Some(key) = agreement["payGroup"].as_str() else {
            return Ok(None);
        };
        if tables["tvl"].get(key).is_none() {
            return Ok(None);
        }
        if tariff == "TVH_43" {
            return Ok(tables["tvh"][key][usize::from(date >= "2026-07-01")]
                .as_i64()
                .map(|cents| StandbyHourlyRate {
                    cents,
                    group: format!("Kr. {}", key.get(3..).unwrap_or("")),
                    source: "Anlage D TV-H, 01.08.2025 / 01.07.2026".into(),
                }));
        }
        let region = text(&profile["tvlKrTariff"], "universityRegion")?;
        if !["WEST", "EAST"].contains(&region) {
            return Ok(None);
        }
        let index = usize::from(date >= "2026-04-01") + if region == "EAST" { 2 } else { 0 };
        return Ok(tables["tvl"][key][index]
            .as_i64()
            .map(|cents| StandbyHourlyRate {
                cents,
                group: format!(
                    "Kr. {} · {}",
                    key.get(3..).unwrap_or(""),
                    if region == "WEST" { "West" } else { "Ost" }
                ),
                source: "Anlage E TV-L, 01.11.2025 / 01.04.2026".into(),
            }));
    }
    let group = profile["tariff"]["payGroup"]
        .as_str()
        .or_else(|| profile["vkaETariff"]["payGroup"].as_str());
    let Some(group) = group else {
        return Ok(None);
    };
    let key = if tariff == "TVOED_B" && truthy(profile.get("vkaETariff")) {
        agreement["payGroup"].as_str()
    } else {
        Some(group)
    };
    let Some(key) = key else {
        return Ok(None);
    };
    if key != group && key.strip_prefix("WORKER_") != Some(group) {
        return Ok(None);
    }
    Ok(
        tables["vka"][tariff][key][usize::from(date >= "2026-05-01")]
            .as_i64()
            .map(|cents| StandbyHourlyRate {
                cents,
                group: key.into(),
                source: format!(
                    "Anlage G TVöD {}, 01.04.2025 / 01.05.2026",
                    if tariff == "TVOED_K" { "BT-K" } else { "BT-B" }
                ),
            }),
    )
}
