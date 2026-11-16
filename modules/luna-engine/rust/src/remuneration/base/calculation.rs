use super::{
    BaseError,
    draft::{
        AnnexAInput, DraftBase, SueInput, calculate_annex_a_draft_base, calculate_sue_draft_base,
    },
    hourly::{OwnHourlyInput, calculate_own_hourly_period_with_paid_absences},
    model::*,
    prepared::PaidAbsenceIndex,
    round_remuneration_cents,
};
use crate::{
    remuneration::{
        context::{
            model::{
                ContextKind, IssueCode, NativePackageValidator, RemunerationIssue,
                RemunerationPeriod,
            },
            periods::{remuneration_month_start, resolve_month},
        },
        own_config::{OwnBase, PartialMonth},
    },
    rules::RuleResolver,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnexAMonthConfirmation {
    pub month: String,
    #[serde(default)]
    pub applicability_confirmed: bool,
    #[serde(default)]
    pub comparable_full_time_confirmed: bool,
    #[serde(default)]
    pub full_month_base_entitlement_confirmed: bool,
    #[serde(default)]
    pub full_month_same_contract_confirmed: bool,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SueMonthConfirmation {
    pub month: String,
    #[serde(default)]
    pub tariff_applicability_confirmed: bool,
    #[serde(default)]
    pub sue_classification_confirmed: bool,
    #[serde(default)]
    pub standard_full_time_confirmed: bool,
    #[serde(default)]
    pub full_month_base_entitlement_confirmed: bool,
    #[serde(default)]
    pub full_month_same_contract_confirmed: bool,
}
fn position<'a>(
    period: &RemunerationPeriod<'a>,
    month_days: i32,
    annex: Option<&AnnexAMonthConfirmation>,
    sue: Option<&SueMonthConfirmation>,
    validator: &impl NativePackageValidator,
) -> Result<BasePosition<'a>, BaseError> {
    let from = period
        .from
        .parse::<jiff::civil::Date>()
        .map_err(|_| BaseError::InvalidShift)?;
    let through = period
        .through
        .parse::<jiff::civil::Date>()
        .map_err(|_| BaseError::InvalidShift)?;
    let calendar_days = from
        .until(through)
        .map_err(|_| BaseError::InvalidShift)?
        .get_days()
        + 1;
    let mut base = BasePosition {
        id: format!("base:{}", period.from),
        kind: "base",
        label: "Grundvergütung".into(),
        from: period.from.clone(),
        through: period.through.clone(),
        source: period.context.source.clone(),
        basis: BaseBasis::empty(calendar_days, month_days),
        status: RemunerationStatus::Unavailable,
        amount_cents: None,
        issue: None,
    };
    match &period.context.kind {
        ContextKind::Unavailable { issue } => base.issue = Some(issue.clone()),
        ContextKind::TvoedAnnexADraft {
            rule_package,
            weekly_minutes,
            full_time_weekly_minutes,
            variant,
            group_id,
            step_id,
        } => {
            base.label = "Tabellenentgelt (Entwurf)".into();
            let entire = calendar_days == month_days && period.from.ends_with("-01");
            let confirmation = annex.filter(|c| c.month == period.from[..7]);
            if !entire || confirmation.is_none() {
                base.issue = Some(RemunerationIssue::new(
                    IssueCode::TariffUnsupported,
                    "Für das TVöD-Tabellenentgelt fehlen eine vollständige Monatsperiode oder ausdrücklich bestätigte Monatsangaben.",
                ));
                return Ok(base);
            }
            let c = confirmation.ok_or(BaseError::InvalidCalculation)?;
            let result = calculate_annex_a_draft_base(
                rule_package,
                &AnnexAInput {
                    date: period.from.clone(),
                    variant_id: variant.clone(),
                    group_id: group_id.clone(),
                    step_id: step_id.clone(),
                    contracted_weekly_minutes: *weekly_minutes as f64,
                    comparable_full_time_weekly_minutes: *full_time_weekly_minutes as f64,
                    applicability_confirmed: c.applicability_confirmed,
                    comparable_full_time_confirmed: c.comparable_full_time_confirmed,
                    full_month_base_entitlement_confirmed: c.full_month_base_entitlement_confirmed,
                    full_month_same_contract_confirmed: c.full_month_same_contract_confirmed,
                },
                validator,
            )?;
            match result {
                DraftBase::Unavailable { reason } => {
                    base.issue = Some(RemunerationIssue::new(
                        IssueCode::TariffUnsupported,
                        format!(
                            "Das TVöD-Tabellenentgelt kann noch nicht bestimmt werden: {}.",
                            serde_json::to_value(reason)
                                .map_err(|_| BaseError::InvalidCalculation)?
                                .as_str()
                                .ok_or(BaseError::InvalidCalculation)?
                        ),
                    ));
                }
                DraftBase::DraftTableBase(result) => {
                    base.status = RemunerationStatus::Estimated;
                    base.amount_cents = Some(result.personal_table_base_cents);
                    base.basis.full_time_monthly_cents = Some(result.full_time_table_cents);
                    base.basis.personal_monthly_cents = Some(result.personal_table_base_cents);
                    base.basis.weekly_minutes = Some(*weekly_minutes);
                    base.basis.full_time_weekly_minutes = Some(*full_time_weekly_minutes);
                    base.basis.proration = Proration::None;
                }
            }
        }
        ContextKind::TvoedSueDraft {
            rule_package,
            weekly_minutes,
            full_time_weekly_minutes,
            group_id,
            step_id,
        } => {
            base.label = "SuE-Tabellenentgelt (Entwurf)".into();
            let entire = calendar_days == month_days && period.from.ends_with("-01");
            let confirmation = sue.filter(|c| c.month == period.from[..7]);
            if !entire || confirmation.is_none() {
                base.issue = Some(RemunerationIssue::new(
                    IssueCode::TariffUnsupported,
                    "Für das SuE-Tabellenentgelt fehlen ein vollständiger Monat oder bestätigte Angaben.",
                ));
                return Ok(base);
            }
            let c = confirmation.ok_or(BaseError::InvalidCalculation)?;
            let result = calculate_sue_draft_base(
                rule_package,
                &SueInput {
                    month: c.month.clone(),
                    group_id: group_id.clone(),
                    step_id: step_id.clone(),
                    contracted_weekly_minutes: *weekly_minutes as f64,
                    tariff_applicability_confirmed: c.tariff_applicability_confirmed,
                    sue_classification_confirmed: c.sue_classification_confirmed,
                    standard_full_time_confirmed: c.standard_full_time_confirmed,
                    full_month_base_entitlement_confirmed: c.full_month_base_entitlement_confirmed,
                    full_month_same_contract_confirmed: c.full_month_same_contract_confirmed,
                },
                validator,
            )?;
            match result {
                DraftBase::Unavailable { reason } => {
                    base.issue = Some(RemunerationIssue::new(
                        IssueCode::TariffUnsupported,
                        format!(
                            "Das SuE-Tabellenentgelt kann noch nicht bestimmt werden: {}.",
                            serde_json::to_value(reason)
                                .map_err(|_| BaseError::InvalidCalculation)?
                                .as_str()
                                .ok_or(BaseError::InvalidCalculation)?
                        ),
                    ));
                }
                DraftBase::DraftTableBase(result) => {
                    base.status = RemunerationStatus::Estimated;
                    base.amount_cents = Some(result.personal_table_base_cents);
                    base.basis.full_time_monthly_cents = Some(result.full_time_table_cents);
                    base.basis.personal_monthly_cents = Some(result.personal_table_base_cents);
                    base.basis.weekly_minutes = Some(*weekly_minutes);
                    base.basis.full_time_weekly_minutes = Some(*full_time_weekly_minutes);
                    base.basis.proration = Proration::None;
                }
            }
        }
        ContextKind::OwnConfigured {
            configuration,
            weekly_minutes,
        } => {
            let OwnBase::Monthly {
                personal_cents,
                partial_month,
            } = configuration.base()
            else {
                return Err(BaseError::HourlyRouteRequired);
            };
            let full = calendar_days == month_days;
            let confirmed = full || *partial_month == PartialMonth::CalendarDays;
            base.status = if confirmed {
                RemunerationStatus::Calculated
            } else {
                RemunerationStatus::Unavailable
            };
            base.amount_cents = if confirmed {
                Some(round_remuneration_cents(
                    *personal_cents as f64 * f64::from(calendar_days),
                    f64::from(month_days),
                )?)
            } else {
                None
            };
            base.basis.personal_monthly_cents = Some(*personal_cents);
            base.basis.weekly_minutes = Some(*weekly_minutes);
            base.basis.proration = if full {
                Proration::None
            } else if *partial_month == PartialMonth::CalendarDays {
                Proration::CalendarDays
            } else {
                Proration::Unconfirmed
            };
            if !confirmed {
                base.issue = Some(RemunerationIssue::new(
                    IssueCode::OwnProrationUnconfirmed,
                    "Bitte die Teilmonatsberechnung der eigenen Grundvergütung bestätigen.",
                ));
            }
        }
        ContextKind::OwnMonthly {
            monthly_cents,
            weekly_minutes,
        } => {
            let complete = calendar_days == month_days;
            base.status = if complete {
                RemunerationStatus::Calculated
            } else {
                RemunerationStatus::Unavailable
            };
            base.amount_cents = complete.then_some(*monthly_cents);
            base.basis.personal_monthly_cents = Some(*monthly_cents);
            base.basis.weekly_minutes = Some(*weekly_minutes);
            base.basis.proration = if complete {
                Proration::None
            } else {
                Proration::Unconfirmed
            };
            if !complete {
                base.issue = Some(RemunerationIssue::new(
                    IssueCode::OwnProrationUnconfirmed,
                    "Für einen Teilmonat muss die Berechnungsbasis der eigenen Vergütung bestätigt werden.",
                ));
            }
        }
        ContextKind::Tariff {
            monthly_cents,
            weekly_minutes,
            full_time_weekly_minutes,
            ..
        }
        | ContextKind::TrainingTariff {
            monthly_cents,
            weekly_minutes,
            full_time_weekly_minutes,
            ..
        }
        | ContextKind::TvlKr {
            monthly_cents,
            weekly_minutes,
            full_time_weekly_minutes,
            ..
        }
        | ContextKind::TvalTraining {
            monthly_cents,
            weekly_minutes,
            full_time_weekly_minutes,
            ..
        } => {
            let personal = round_remuneration_cents(
                *monthly_cents as f64 * *weekly_minutes as f64,
                *full_time_weekly_minutes as f64,
            )?;
            let training = match &period.context.kind {
                ContextKind::TrainingTariff {
                    training_year,
                    category_label,
                    ..
                } => {
                    base.label = format!(
                        "Ausbildungsentgelt · {training_year}. Ausbildungsjahr · {category_label}"
                    );
                    true
                }
                ContextKind::TvalTraining {
                    period_label,
                    category_label,
                    ..
                } => {
                    base.label = format!("Ausbildungsentgelt · {period_label} · {category_label}");
                    true
                }
                _ => false,
            };
            base.status = if training
                && (*weekly_minutes != *full_time_weekly_minutes || calendar_days != month_days)
            {
                RemunerationStatus::Estimated
            } else {
                RemunerationStatus::Calculated
            };
            base.amount_cents = Some(round_remuneration_cents(
                personal as f64 * f64::from(calendar_days),
                f64::from(month_days),
            )?);
            base.basis.full_time_monthly_cents = Some(*monthly_cents);
            base.basis.personal_monthly_cents = Some(personal);
            base.basis.weekly_minutes = Some(*weekly_minutes);
            base.basis.full_time_weekly_minutes = Some(*full_time_weekly_minutes);
            base.basis.proration = if calendar_days == month_days {
                Proration::None
            } else {
                Proration::CalendarDays
            };
        }
    }
    Ok(base)
}
pub struct BaseMonthInput<'a, 'confirmation> {
    pub month: &'a str,
    pub history: &'a [Value],
    pub hourly_input: Option<OwnHourlyInput<'a>>,
    pub annex_a_confirmation: Option<&'confirmation AnnexAMonthConfirmation>,
    pub sue_confirmation: Option<&'confirmation SueMonthConfirmation>,
}
pub fn calculate_monthly_base<'a>(
    input: &BaseMonthInput<'a, '_>,
    resolver: &'a RuleResolver,
    validator: &impl NativePackageValidator,
) -> Result<MonthlyBase<'a>, BaseError> {
    calculate_monthly_base_with_paid_absences(input, resolver, validator, None)
}
pub fn calculate_monthly_base_with_paid_absences<'a>(
    input: &BaseMonthInput<'a, '_>,
    resolver: &'a RuleResolver,
    validator: &impl NativePackageValidator,
    prepared: Option<&PaidAbsenceIndex>,
) -> Result<MonthlyBase<'a>, BaseError> {
    let month_days = i32::from(remuneration_month_start(input.month)?.days_in_month());
    let periods = resolve_month(input.month, input.history, resolver, validator)?;
    let mut positions = vec![];
    for period in &periods {
        if matches!(&period.context.kind,ContextKind::OwnConfigured{configuration,..}if matches!(configuration.base(),OwnBase::Hourly{..}))
        {
            positions.extend(calculate_own_hourly_period_with_paid_absences(
                period,
                month_days,
                input.hourly_input.as_ref(),
                prepared,
            )?);
        } else {
            positions.push(position(
                period,
                month_days,
                input.annex_a_confirmation,
                input.sue_confirmation,
                validator,
            )?);
        }
    }
    let complete = positions
        .iter()
        .all(|p| p.status != RemunerationStatus::Unavailable);
    let mut known = 0i64;
    for p in &positions {
        known = known
            .checked_add(p.amount_cents.unwrap_or(0))
            .filter(|n| *n <= crate::money::MAX_SAFE_INTEGER)
            .ok_or(BaseError::InvalidCalculation)?;
    }
    let status = if !complete {
        RemunerationStatus::Unavailable
    } else if positions
        .iter()
        .any(|p| p.status == RemunerationStatus::Estimated)
    {
        RemunerationStatus::Estimated
    } else {
        RemunerationStatus::Calculated
    };
    Ok(MonthlyBase {
        month: input.month.into(),
        positions,
        complete,
        status,
        total_cents: complete.then_some(known),
        known_subtotal_cents: known,
    })
}
