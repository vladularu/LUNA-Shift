use super::{AllowanceError, key, model::*};
use crate::{
    pay::{
        allowances::{AllowanceRule, configured_allowance_amount},
        conditions::conditions_match,
        tariff::TariffProfile,
    },
    remuneration::{
        base::{model::RemunerationStatus, round_remuneration_cents},
        context::model::{ContextKind, IssueCode, RemunerationContext},
        profile::TrainingSpecialDutyAllowance,
    },
};
use serde::Deserialize;
use serde_json::Value;
use std::borrow::Cow;

pub(super) struct Bucket<'a> {
    pub position: SupplementPosition<'a>,
    rule: Option<Rule<'a>>,
    tariff: Option<TariffProfile>,
    weekly: f64,
    full: f64,
    training: bool,
}
struct Rule<'a> {
    raw: &'a Value,
    value: AllowanceRule,
}
fn profile(context: &RemunerationContext<'_>) -> Result<Option<TariffProfile>, AllowanceError> {
    if !matches!(context.kind, ContextKind::Tariff { .. }) {
        return Ok(None);
    }
    let selection = &context.profile.ok_or(AllowanceError::InvalidInput)?["data"]["selection"];
    let text = |key: &str| selection[key].as_str().ok_or(AllowanceError::InvalidInput);
    let ContextKind::Tariff {
        full_time_weekly_minutes,
        ..
    } = context.kind
    else {
        return Err(AllowanceError::InvalidInput);
    };
    Ok(Some(TariffProfile {
        pay_group: text("group")?.into(),
        pay_level: text("level")?
            .parse()
            .map_err(|_| AllowanceError::InvalidInput)?,
        sector: text("variant")?.into(),
        tariff_region: text("region")?.into(),
        full_time_weekly_minutes: full_time_weekly_minutes as f64,
    }))
}
fn rules<'a>(
    context: &RemunerationContext<'a>,
    kind: AllowanceType,
    date: &str,
    status: Option<&str>,
    tariff: Option<&TariffProfile>,
    state: &str,
) -> Result<Vec<Rule<'a>>, AllowanceError> {
    let package = match &context.kind {
        ContextKind::Tariff { rule_package, .. }
        | ContextKind::TrainingTariff { rule_package, .. } => *rule_package,
        _ => return Err(AllowanceError::InvalidInput),
    };
    let mut result = vec![];
    for raw in package.rules()["allowanceRules"]
        .as_array()
        .ok_or(AllowanceError::InvalidInput)?
    {
        let mut value =
            AllowanceRule::deserialize(raw).map_err(|_| AllowanceError::InvalidInput)?;
        if value.allowance_type != kind.text()
            || value.valid_from.as_str() > date
            || value.valid_to.as_deref().is_some_and(|to| date > to)
        {
            continue;
        }
        if let ContextKind::TrainingTariff {
            sector,
            tariff_region,
            special_duty_allowance,
            ..
        } = &context.kind
        {
            if kind == AllowanceType::Care
                && (*special_duty_allowance != Some(TrainingSpecialDutyAllowance::Pe1Only)
                    || raw["id"] != "training-special-duty-pe1")
                || value.conditions.pay_groups.is_some()
                || value
                    .conditions
                    .sectors
                    .as_ref()
                    .is_some_and(|v| !v.contains(sector))
                || value
                    .conditions
                    .tariff_regions
                    .as_ref()
                    .is_some_and(|v| !v.contains(tariff_region))
            {
                continue;
            }
            value.conditions.sectors = None;
            value.conditions.tariff_regions = None;
        }
        if conditions_match(&value.conditions, tariff, state, date, None, status) {
            result.push(Rule { raw, value });
        }
    }
    Ok(result)
}
pub(super) struct DayWork {
    pub minutes: f64,
    pub estimated_pause: bool,
}
pub(super) fn create_bucket<'a>(
    context: &RemunerationContext<'a>,
    date: &str,
    month_days: i32,
    kind: Option<AllowanceType>,
    entitlement: Option<Cow<'a, Value>>,
    work: &DayWork,
    work_profile: &Value,
) -> Result<(String, Bucket<'a>), AllowanceError> {
    let tariff = profile(context)?;
    let (weekly, full) = match context.kind {
        ContextKind::Tariff {
            weekly_minutes,
            full_time_weekly_minutes,
            ..
        }
        | ContextKind::TrainingTariff {
            weekly_minutes,
            full_time_weekly_minutes,
            ..
        } => (weekly_minutes as f64, full_time_weekly_minutes as f64),
        _ => (
            work_profile["weeklyMinutes"]
                .as_f64()
                .ok_or(AllowanceError::InvalidInput)?,
            1.0,
        ),
    };
    let training = matches!(context.kind, ContextKind::TrainingTariff { .. });
    let shift = kind.is_some_and(AllowanceType::shift);
    let status = entitlement.as_deref().and_then(|e| e["status"].as_str());
    let mut rule = None;
    let mut issue = match &context.kind {
        ContextKind::Unavailable { issue } => Some(issue.clone().into()),
        ContextKind::TvoedAnnexADraft { .. } => Some(SupplementIssue::context(
            IssueCode::TariffUnsupported,
            "Die weiteren TVöD-Anlage-A-Bestandteile sind noch nicht fachlich freigegeben.",
        )),
        ContextKind::TvoedSueDraft { .. } => Some(SupplementIssue::context(
            IssueCode::TariffUnsupported,
            "SuE-Zulagen sind für diesen Tabellenentwurf noch nicht berechenbar.",
        )),
        ContextKind::TvlKr { .. } => Some(SupplementIssue::context(
            IssueCode::TariffUnsupported,
            "Weitere TV-L/KR-Pflege- und Tätigkeitszulagen sind noch nicht vollständig angebunden; bestätigte Schichtzulagen werden separat ausgewiesen.",
        )),
        ContextKind::TvalTraining { .. } => Some(SupplementIssue::context(
            IssueCode::TariffUnsupported,
            "Weitere TVA-L-Zulagen, insbesondere BAT-Gefahrenzulagen, sind noch nicht vollständig geprüft; bestätigte Schicht- und Tätigkeitszulagen werden separat ausgewiesen.",
        )),
        ContextKind::TrainingTariff {
            special_duty_allowance,
            ..
        } if kind == Some(AllowanceType::Care)
            && matches!(
                special_duty_allowance,
                None | Some(TrainingSpecialDutyAllowance::OtherOrMultiple)
            ) =>
        {
            Some(if special_duty_allowance.is_none() {
                SupplementIssue::new(
                    SupplementIssueKind::AllowanceDecisionMissing,
                    "Bitte die tätigkeitsabhängigen Zulagen im datierten Vergütungsprofil ausdrücklich bestätigen.",
                )
            } else {
                SupplementIssue::context(
                    IssueCode::TariffUnsupported,
                    "Weitere oder kombinierte tätigkeitsabhängige Ausbildungszulagen sind noch nicht vollständig abgebildet.",
                )
            })
        }
        ContextKind::OwnMonthly { .. } => Some(SupplementIssue::new(
            SupplementIssueKind::OwnAllowancesUnconfigured,
            "Für die eigene Vergütung sind noch keine Zulagenbausteine bestätigt.",
        )),
        _ if shift && entitlement.is_none() => Some(SupplementIssue::new(
            SupplementIssueKind::AllowanceDecisionMissing,
            "Die Schichtzulagenentscheidung fehlt für diesen Zeitraum.",
        )),
        _ => None,
    };
    let explicit_no_training_care = matches!(
        context.kind,
        ContextKind::TrainingTariff {
            special_duty_allowance: Some(TrainingSpecialDutyAllowance::None),
            ..
        }
    ) && kind == Some(AllowanceType::Care);
    if issue.is_none()
        && !explicit_no_training_care
        && !(shift && status == Some("NONE"))
        && let Some(kind) = kind
    {
        let candidates = rules(
            context,
            kind,
            date,
            status,
            tariff.as_ref(),
            work_profile["federalState"]
                .as_str()
                .ok_or(AllowanceError::InvalidInput)?,
        )?;
        if candidates.len() != 1 {
            issue = Some(SupplementIssue::new(
                if candidates.is_empty() {
                    SupplementIssueKind::AllowanceRuleMissing
                } else {
                    SupplementIssueKind::AllowanceRuleAmbiguous
                },
                format!(
                    "Die Regel für {} ist {}.",
                    kind.label(),
                    if candidates.is_empty() {
                        "nicht verfügbar"
                    } else {
                        "nicht eindeutig"
                    }
                ),
            ));
        } else {
            rule = candidates.into_iter().next();
        }
    }
    let hourly = rule
        .as_ref()
        .is_some_and(|r| r.value.amount_kind == "FIXED_HOURLY");
    let estimated = shift
        && entitlement
            .as_deref()
            .is_some_and(|e| e["origin"] == "estimated")
        || hourly && work.estimated_pause;
    let mut basis = SupplementBasis::empty(1, month_days);
    basis.rule_id = rule
        .as_ref()
        .and_then(|r| r.raw["id"].as_str())
        .map(str::to_owned);
    basis.allowance_type = kind;
    basis.rate_cents = rule.as_ref().map(|r| r.value.amount_cents as i64);
    basis.minutes = if hourly { work.minutes } else { 0.0 };
    basis.entitlement = if shift { entitlement } else { None };
    basis.pause_method = if hourly && work.estimated_pause {
        PauseMethod::CenteredDurationEstimate
    } else {
        PauseMethod::None
    };
    let position = SupplementPosition {
        id: format!(
            "allowance:{}:{date}",
            kind.map_or("unknown", AllowanceType::text)
        ),
        kind: SupplementKind::Allowance,
        label: if matches!(
            context.kind,
            ContextKind::TvoedAnnexADraft { .. } | ContextKind::TvoedSueDraft { .. }
        ) {
            "Weitere TVöD-Bestandteile"
        } else if training && kind == Some(AllowanceType::Care) {
            "Tätigkeitsabhängige Ausbildungszulage"
        } else {
            kind.map_or("Zulagen", AllowanceType::label)
        }
        .into(),
        from: date.into(),
        through: date.into(),
        amount_cents: issue.is_none().then_some(0),
        status: if issue.is_some() {
            RemunerationStatus::Unavailable
        } else if estimated {
            RemunerationStatus::Estimated
        } else {
            RemunerationStatus::Calculated
        },
        source: context.source.clone(),
        issue,
        basis,
    };
    let k = key((
        kind,
        &context.source,
        rule.as_ref().map(|r| r.raw),
        &position.basis.entitlement,
        &position.issue,
    ))?;
    Ok((
        k,
        Bucket {
            position,
            rule,
            tariff,
            weekly,
            full,
            training,
        },
    ))
}
pub(super) fn finish_bucket(
    mut bucket: Bucket<'_>,
) -> Result<SupplementPosition<'_>, AllowanceError> {
    let Some(rule) = &bucket.rule else {
        return Ok(bucket.position);
    };
    if bucket.position.amount_cents.is_none() {
        return Ok(bucket.position);
    }
    let hourly = rule.value.amount_kind == "FIXED_HOURLY";
    let monthly = rule.value.amount_kind == "FIXED_MONTHLY";
    let cents = if bucket.training {
        round_remuneration_cents(
            rule.value.amount_cents
                * if hourly {
                    bucket.position.basis.minutes
                } else {
                    1.0
                }
                * if rule.value.prorate_by_part_time {
                    bucket.weekly
                } else {
                    1.0
                },
            if hourly { 60.0 } else { 1.0 }
                * if rule.value.prorate_by_part_time {
                    bucket.full
                } else {
                    1.0
                },
        )?
    } else {
        (configured_allowance_amount(
            &rule.value,
            bucket.position.basis.minutes,
            bucket.tariff.as_ref(),
            bucket.weekly,
            bucket.full,
        ) * 100.0
            + 0.5)
            .floor() as i64
    };
    if bucket.training
        && monthly
        && (bucket.weekly < bucket.full
            || bucket.position.basis.calendar_days < bucket.position.basis.month_days)
    {
        bucket.position.status = RemunerationStatus::Estimated;
    }
    bucket.position.amount_cents = Some(if monthly {
        round_remuneration_cents(
            cents as f64 * bucket.position.basis.calendar_days as f64,
            bucket.position.basis.month_days as f64,
        )?
    } else {
        cents
    });
    bucket.position.basis.personal_monthly_cents = monthly.then_some(cents);
    bucket.position.basis.proration = if monthly {
        if bucket.position.basis.calendar_days == bucket.position.basis.month_days {
            Proration::None
        } else {
            Proration::CalendarDays
        }
    } else {
        Proration::WorkedMinutes
    };
    Ok(bucket.position)
}
