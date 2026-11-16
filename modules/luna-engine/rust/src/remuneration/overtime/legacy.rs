use super::{OvertimeError, own::unavailable};
use crate::{
    pay::{
        conditions::{ConditionShift, RuleConditions, conditions_match},
        tariff::{self, TariffProfile},
    },
    remuneration::{
        allowances::model::*,
        base::round_remuneration_cents,
        context::model::{ContextKind, RemunerationContext},
    },
};
use serde::Deserialize;
use serde_json::Value;

fn tariff_profile(context: &RemunerationContext<'_>) -> Result<TariffProfile, OvertimeError> {
    let ContextKind::Tariff {
        full_time_weekly_minutes,
        ..
    } = context.kind
    else {
        return Err(OvertimeError::InvalidInput);
    };
    let selection = &context.profile.ok_or(OvertimeError::InvalidInput)?["data"]["selection"];
    let text = |key: &str| selection[key].as_str().ok_or(OvertimeError::InvalidInput);
    Ok(TariffProfile {
        pay_group: text("group")?.into(),
        pay_level: text("level")?
            .parse()
            .map_err(|_| OvertimeError::InvalidInput)?,
        sector: text("variant")?.into(),
        tariff_region: text("region")?.into(),
        full_time_weekly_minutes: full_time_weekly_minutes as f64,
    })
}
fn matching_rules<'a>(
    context: &RemunerationContext<'a>,
    date: &str,
    work: &Value,
    shift: &Value,
) -> Result<Vec<&'a Value>, OvertimeError> {
    let ContextKind::Tariff { rule_package, .. } = &context.kind else {
        return Ok(vec![]);
    };
    let profile = tariff_profile(context)?;
    let mut result = vec![];
    for rule in rule_package.rules()["premiumRules"]
        .as_array()
        .ok_or(OvertimeError::InvalidInput)?
    {
        if rule["premiumType"] != "OVERTIME" {
            continue;
        }
        let conditions = RuleConditions::deserialize(&rule["conditions"])
            .map_err(|_| OvertimeError::InvalidInput)?;
        if conditions_match(
            &conditions,
            Some(&profile),
            work["federalState"]
                .as_str()
                .ok_or(OvertimeError::InvalidInput)?,
            date,
            Some(ConditionShift {
                shift_type: shift["type"].as_str().ok_or(OvertimeError::InvalidInput)?,
                holiday_premium_mode: shift["holidayPremiumMode"]
                    .as_str()
                    .ok_or(OvertimeError::InvalidInput)?,
            }),
            None,
        ) {
            result.push(rule);
        }
    }
    Ok(result)
}
pub(super) fn context_key(
    context: &RemunerationContext<'_>,
    date: &str,
    work: &Value,
    shift: &Value,
) -> Result<String, OvertimeError> {
    let kind = match context.kind {
        ContextKind::Unavailable { .. } => "unavailable",
        ContextKind::OwnConfigured { .. } => "own-configured",
        ContextKind::OwnMonthly { .. } => "own-monthly",
        ContextKind::Tariff { .. } => "tariff",
        ContextKind::TrainingTariff { .. } => "training-tariff",
        ContextKind::TvlKr { .. } => "tvl-kr",
        ContextKind::TvalTraining { .. } => "tval-training",
        ContextKind::TvoedAnnexADraft { .. } => "tvoed-annex-a-draft",
        ContextKind::TvoedSueDraft { .. } => "tvoed-sue-draft",
    };
    let issue = match &context.kind {
        ContextKind::Unavailable { issue } => Some(issue),
        _ => None,
    };
    let applicable = matching_rules(context, date, work, shift)?;
    let training = match &context.kind {
        ContextKind::TvalTraining {
            monthly_cents,
            full_time_weekly_minutes,
            rule_package,
            ..
        } => Some((
            *monthly_cents,
            *full_time_weekly_minutes,
            rule_package.rules().get("tvalOvertimePolicy"),
        )),
        _ => None,
    };
    let kr = match &context.kind {
        ContextKind::TvlKr {
            group_id,
            monthly_cents,
            full_time_weekly_minutes,
            rule_package,
            ..
        } => Some((
            group_id,
            *monthly_cents,
            *full_time_weekly_minutes,
            rule_package.rules().get("tvlOvertimePolicy"),
        )),
        _ => None,
    };
    serde_json::to_string(&(
        &date[..7],
        kind,
        &context.source,
        issue,
        applicable,
        training,
        kr,
    ))
    .map_err(|_| OvertimeError::Encoding)
}
pub(super) fn calculate<'a>(
    position: SupplementPosition<'a>,
    context: &RemunerationContext<'_>,
    shift: &Value,
    work: &Value,
) -> Result<Vec<SupplementPosition<'a>>, OvertimeError> {
    let ContextKind::Tariff { rule_package, .. } = context.kind else {
        return Err(OvertimeError::InvalidInput);
    };
    let profile = tariff_profile(context)?;
    let rules = matching_rules(context, &position.from, work, shift)?;
    if rules.len() != 1 {
        return Ok(vec![unavailable(
            position,
            if rules.is_empty() {
                SupplementIssueKind::OvertimeRuleMissing
            } else {
                SupplementIssueKind::OvertimeRuleAmbiguous
            },
            "Die Überstundenregel ist nicht eindeutig verfügbar.",
        )]);
    }
    let rule = rules[0];
    let individual = tariff::get_individual_hourly_rate_from_package(rule_package, &profile)?;
    let maximum = rule_package.rules()["overtimeBaseRule"]["maximumStepId"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|step| {
            tariff::get_hourly_table_amount_for_step_from_package(rule_package, &profile, step)
        })
        .transpose()?
        .flatten();
    let premium_rate = if rule["rateBasis"] == "INDIVIDUAL_HOURLY" {
        individual
    } else {
        rule["referenceStepId"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(|step| {
                tariff::get_hourly_table_amount_for_step_from_package(rule_package, &profile, step)
            })
            .transpose()?
            .flatten()
    };
    let (Some(individual), Some(_maximum), Some(premium_rate)) =
        (individual, maximum, premium_rate)
    else {
        return Ok(vec![unavailable(
            position,
            SupplementIssueKind::OvertimeRateMissing,
            "Die Stundenbasis oder tarifliche Stufenbegrenzung für Überstunden fehlt.",
        )]);
    };
    let base_cents =
        (tariff::get_overtime_base_hourly_rate(rule_package, &profile, individual)? * 100.0 + 0.5)
            .floor() as i64;
    let premium_cents = (premium_rate * 100.0 + 0.5).floor() as i64;
    let percentage =
        super::integer(&rule["percentageBasisPoints"]).ok_or(OvertimeError::InvalidInput)?;
    let mut base = position.clone();
    base.amount_cents = Some(round_remuneration_cents(
        base_cents as f64 * position.basis.minutes,
        60.0,
    )?);
    base.basis.rate_cents = Some(base_cents);
    let mut premium = position.clone();
    premium.id.push_str(":premium");
    premium.kind = SupplementKind::OvertimePremium;
    premium.label = rule["label"]
        .as_str()
        .ok_or(OvertimeError::InvalidInput)?
        .into();
    premium.amount_cents = Some(round_remuneration_cents(
        premium_cents as f64 * position.basis.minutes * percentage as f64,
        600_000.0,
    )?);
    premium.basis.rule_id = rule["id"].as_str().map(str::to_owned);
    premium.basis.rate_cents = Some(premium_cents);
    premium.basis.percentage_basis_points = Some(percentage);
    Ok(vec![base, premium])
}
