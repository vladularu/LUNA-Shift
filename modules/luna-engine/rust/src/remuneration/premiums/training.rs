use super::{PremiumError, common::*, model::*};
use crate::{
    pay::premium_minutes::{
        PremiumMinuteInterval, PremiumMinuteSpan, PremiumRules, count_premium_minutes,
    },
    remuneration::base::{
        model::RemunerationStatus, round_remuneration_cents, shift_days::RemunerationShiftDay,
    },
    rules::{RulePackage, RuleResolver},
};
use bigdecimal::BigDecimal;
use serde_json::Value;
use std::str::FromStr;

pub(super) struct TrainingContext<'a> {
    pub package: &'a RulePackage,
    pub monthly_cents: i64,
    pub full_time_weekly_minutes: i64,
    pub weekly_minutes: i64,
}
pub(super) fn calculate<'a>(
    base: &TimeRemunerationPosition<'a>,
    day: &RemunerationShiftDay,
    shift: &Value,
    work: &Value,
    context: &TrainingContext<'_>,
    resolver: &RuleResolver,
) -> Result<Vec<TimeRemunerationPosition<'a>>, PremiumError> {
    let rules = context.package.rules();
    let premiums = rules["premiumRules"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let factor = rules["hourlyCalculation"]["monthlyFactorThousandths"]
        .as_f64()
        .filter(|n| n.is_finite() && *n != 0.0);
    if rules["selection"]["capabilities"]["timePremiums"] != "SUPPORTED"
        || !rules["trainingPay"].is_object()
        || factor.is_none()
        || context.full_time_weekly_minutes <= 0
        || !premiums.iter().any(|r| r["premiumType"] != "OVERTIME")
    {
        return Err(PremiumError::MissingRate);
    }
    let hourly = round_remuneration_cents(
        context.monthly_cents as f64 * 60_000.0,
        context.full_time_weekly_minutes as f64 * factor.unwrap(),
    )?;
    let bounds = frame(shift, work)?.ok_or(PremiumError::MissingRate)?;
    if day.from.fract() != 0.0
        || day.until.fract() != 0.0
        || day.from < 0.0
        || day.until < day.from
        || day.until > bounds.gross
    {
        return Err(crate::pay::premium_minutes::PremiumError::InvalidInterval.into());
    }
    // Keep the source's IEEE754 centering intermediates before converting the
    // resulting bounds to the shared classifier's exact comparison carrier.
    let span = PremiumMinuteSpan {
        gross_minutes: bounds.gross as i64,
        break_start: BigDecimal::from_str(&bounds.pause_from.to_string())
            .map_err(|_| PremiumError::InvalidInput)?,
        break_end: BigDecimal::from_str(&bounds.pause_until.to_string())
            .map_err(|_| PremiumError::InvalidInput)?,
    };
    let mut projected = work.clone();
    projected
        .as_object_mut()
        .ok_or(PremiumError::InvalidInput)?
        .insert("tariff".into(), Value::Null);
    let buckets = count_premium_minutes(
        shift,
        &projected,
        &span,
        &PremiumRules::from_json(rules)?,
        resolver,
        Some(&PremiumMinuteInterval::new(
            day.from as i64,
            day.until as i64,
        )),
    )?;
    let minimum = number(&rules["trainingPay"], "minimumNightHourlyCents")?;
    let mut positions = vec![];
    for id in buckets.rule_order {
        let rule = premiums
            .iter()
            .find(|rule| rule["id"] == id)
            .ok_or(PremiumError::MissingRate)?;
        if rule["rateBasis"] != "INDIVIDUAL_HOURLY"
            || rule.get("referenceStepId") != Some(&Value::Null)
        {
            return Err(PremiumError::MissingRate);
        }
        let minutes = *buckets
            .by_rule_id
            .get(&id)
            .ok_or(PremiumError::MissingRate)? as f64;
        let percentage = number(rule, "percentageBasisPoints")?;
        let floor =
            rule["premiumType"] == "NIGHT" && hourly as f64 * percentage < minimum * 10_000.0;
        let rate = if floor { minimum } else { hourly as f64 };
        let percentage = if floor { None } else { Some(percentage as i64) };
        let mut position = base.clone();
        position.id = format!("{}:{id}", base.id);
        position.label = format!(
            "{}{}",
            text(rule, "label")?,
            if floor {
                " · tariflicher Mindestzuschlag"
            } else {
                ""
            }
        );
        position.amount_cents = Some(round_remuneration_cents(
            rate * minutes * percentage.unwrap_or(10_000) as f64,
            600_000.0,
        )?);
        if context.weekly_minutes < context.full_time_weekly_minutes {
            position.status = RemunerationStatus::Estimated;
        }
        position.basis.rule_id = Some(id);
        position.basis.minutes = minutes;
        position.basis.hourly_rate_cents = Some(rate as i64);
        position.basis.percentage_basis_points = percentage;
        positions.push(position);
    }
    if positions.is_empty() {
        let mut position = base.clone();
        position.label = "Keine Zeitzuschläge in diesem Abschnitt".into();
        positions.push(position);
    }
    Ok(positions)
}
