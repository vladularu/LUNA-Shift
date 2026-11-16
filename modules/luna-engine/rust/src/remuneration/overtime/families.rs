use super::{OvertimeError, own::unavailable};
use crate::remuneration::{
    allowances::model::*,
    base::{model::RemunerationStatus, round_remuneration_cents},
    context::model::{ContextKind, RemunerationContext},
};
use serde_json::Value;
fn num(v: &Value, key: &str) -> Result<i64, OvertimeError> {
    super::integer(&v[key]).ok_or(OvertimeError::InvalidInput)
}
fn missing<'a>(position: SupplementPosition<'a>, message: &str) -> Vec<SupplementPosition<'a>> {
    vec![unavailable(
        position,
        SupplementIssueKind::OvertimeRuleMissing,
        message,
    )]
}
pub(super) fn calculate<'a>(
    position: SupplementPosition<'a>,
    context: &RemunerationContext<'_>,
) -> Result<Vec<SupplementPosition<'a>>, OvertimeError> {
    let (package, monthly, full) = match context.kind {
        ContextKind::TrainingTariff {
            rule_package,
            monthly_cents,
            full_time_weekly_minutes,
            ..
        }
        | ContextKind::TvlKr {
            rule_package,
            monthly_cents,
            full_time_weekly_minutes,
            ..
        }
        | ContextKind::TvalTraining {
            rule_package,
            monthly_cents,
            full_time_weekly_minutes,
            ..
        } => (rule_package, monthly_cents, full_time_weekly_minutes),
        _ => return Err(OvertimeError::InvalidInput),
    };
    let rules = package.rules();
    let supported = rules["selection"]["capabilities"]["overtime"] == "SUPPORTED";
    let mut base = position.clone();
    let mut premium = position.clone();
    premium.id.push_str(":premium");
    premium.kind = SupplementKind::OvertimePremium;
    base.status = RemunerationStatus::Estimated;
    premium.status = RemunerationStatus::Estimated;
    match &context.kind {
        ContextKind::TrainingTariff { .. } => {
            let overtime: Vec<&Value> = rules["premiumRules"]
                .as_array()
                .ok_or(OvertimeError::InvalidInput)?
                .iter()
                .filter(|r| r["premiumType"] == "OVERTIME")
                .collect();
            let factor = super::integer(&rules["hourlyCalculation"]["monthlyFactorThousandths"]);
            if !supported || overtime.len() != 1 || factor.is_none_or(|f| f == 0) || full <= 0 {
                return Ok(missing(
                    position,
                    "Für Ausbildungsüberstunden fehlt eine eindeutige unterstützte Tarifregel.",
                ));
            }
            let rule = overtime[0];
            let hourly = round_remuneration_cents(
                monthly as f64 * 60_000.0,
                full as f64 * factor.ok_or(OvertimeError::InvalidInput)? as f64,
            )?;
            let percentage = num(rule, "percentageBasisPoints")?;
            base.label = "Ausbildungsüberstunden · Grundvergütung".into();
            base.amount_cents = Some(round_remuneration_cents(
                hourly as f64 * position.basis.minutes,
                60.0,
            )?);
            base.basis.rate_cents = Some(hourly);
            premium.label = rule["label"]
                .as_str()
                .ok_or(OvertimeError::InvalidInput)?
                .into();
            premium.amount_cents = Some(round_remuneration_cents(
                hourly as f64 * position.basis.minutes * percentage as f64,
                600_000.0,
            )?);
            premium.basis.rule_id = rule["id"].as_str().map(str::to_owned);
            premium.basis.rate_cents = Some(hourly);
            premium.basis.percentage_basis_points = Some(percentage);
        }
        ContextKind::TvalTraining { .. } => {
            let policy = rules.get("tvalOvertimePolicy");
            if policy.is_none() || !supported || full <= 0 {
                return Ok(missing(
                    position,
                    "Die TVA-L-Pflege-Überstundenregel oder ihre Stundenbasis fehlt.",
                ));
            }
            let policy = policy.ok_or(OvertimeError::InvalidInput)?;
            let hourly = round_remuneration_cents(
                monthly as f64 * 60_000.0,
                full as f64 * num(policy, "monthlyFactorThousandths")? as f64,
            )?;
            let percentage = num(policy, "percentageBasisPoints")?;
            let premium_rate =
                round_remuneration_cents(hourly as f64 * percentage as f64, 10_000.0)?;
            base.label = "TVA-L-Überstunden · Grundvergütung".into();
            base.amount_cents = Some(round_remuneration_cents(
                hourly as f64 * position.basis.minutes,
                60.0,
            )?);
            base.basis.rule_id = Some("tval-overtime-base".into());
            base.basis.rate_cents = Some(hourly);
            premium.label = "TVA-L-Überstundenzuschlag".into();
            premium.amount_cents = Some(round_remuneration_cents(
                premium_rate as f64 * position.basis.minutes,
                60.0,
            )?);
            premium.basis.rule_id = Some("tval-overtime-premium".into());
            premium.basis.rate_cents = Some(hourly);
            premium.basis.percentage_basis_points = Some(percentage);
        }
        ContextKind::TvlKr { group_id, .. } => {
            let policy = rules.get("tvlOvertimePolicy").unwrap_or(&Value::Null);
            let entries = rules["payTables"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|t| t.get("id") == rules["selector"].get("payTableId"))
                .and_then(|t| t["entries"].as_array());
            let candidates = |step: &str| {
                entries
                    .into_iter()
                    .flatten()
                    .filter(|e| e["groupId"] == *group_id && e.get("stepId") == policy.get(step))
                    .collect::<Vec<_>>()
            };
            let capped = candidates("maximumBaseStepId");
            let reference = candidates("premiumReferenceStepId");
            let rates: Vec<_> = policy["groupRates"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|r| r["groupId"] == *group_id)
                .collect();
            if policy.is_null()
                || !supported
                || capped.len() != 1
                || reference.len() != 1
                || rates.len() != 1
                || full <= 0
            {
                return Ok(missing(
                    position,
                    "Die TV-L/KR-Überstundenregel oder ihre Stundenbasis fehlt bzw. ist nicht eindeutig.",
                ));
            }
            let factor = num(policy, "monthlyFactorThousandths")?;
            let hourly = |monthly: i64| {
                round_remuneration_cents(monthly as f64 * 60_000.0, full as f64 * factor as f64)
            };
            let base_rate = hourly(monthly.min(num(capped[0], "monthlyCents")?))?;
            let reference_rate = hourly(num(reference[0], "monthlyCents")?)?;
            let percentage = num(rates[0], "percentageBasisPoints")?;
            let premium_rate =
                round_remuneration_cents(reference_rate as f64 * percentage as f64, 10_000.0)?;
            base.label = "TV-L-Überstunden · Grundvergütung".into();
            base.amount_cents = Some(round_remuneration_cents(
                base_rate as f64 * position.basis.minutes,
                60.0,
            )?);
            base.basis.rule_id = Some("tvl-overtime-base".into());
            base.basis.rate_cents = Some(base_rate);
            premium.label = "TV-L-Überstundenzuschlag".into();
            premium.amount_cents = Some(round_remuneration_cents(
                premium_rate as f64 * position.basis.minutes,
                60.0,
            )?);
            premium.basis.rule_id = Some("tvl-overtime-premium".into());
            premium.basis.rate_cents = Some(reference_rate);
            premium.basis.percentage_basis_points = Some(percentage);
        }
        _ => return Err(OvertimeError::InvalidInput),
    }
    Ok(vec![base, premium])
}
