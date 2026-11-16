//! Isolated explicitly confirmed Annex-A draft overtime. This does not infer
//! eligibility or an actual payroll month from a monthly working-time balance.
use super::{DraftPayError, rows, safe};
use crate::{
    remuneration::{
        base::{BaseError, round_remuneration_cents},
        context::{
            model::{FullNativePackageValidator, NativePackageValidator},
            selection::resolve_tariff_selection,
        },
    },
    rules::RulePackage,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Settlement {
    Cash,
    Time,
    Unknown,
}
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Classification {
    ConfirmedTvoedOvertime,
    NotOvertime,
    Unknown,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnnexOvertimeInput {
    pub date: String,
    pub variant_id: String,
    pub group_id: String,
    pub step_id: String,
    pub full_time_weekly_minutes: f64,
    pub full_time_reference_confirmed: bool,
    pub applicability_confirmed: bool,
    pub minutes: f64,
    pub classification: Classification,
    pub work_pay_not_already_included_confirmed: bool,
    pub work_settlement: Settlement,
    pub premium_settlement: Settlement,
}
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OvertimeFailure {
    InvalidPackage,
    MissingPolicy,
    OutsideValidity,
    TariffApplicabilityUnconfirmed,
    FullTimeReferenceUnsupported,
    InvalidMinutes,
    NotOvertime,
    ClassificationUnconfirmed,
    WorkPayDuplicationUnconfirmed,
    SettlementUnconfirmed,
    UnknownSelection,
    MissingTableValue,
    MissingRate,
    AmountOverflow,
}
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum AnnexOvertimeResult<'a> {
    Unavailable { reason: OvertimeFailure },
    DraftConfirmedOvertime(Box<OvertimeAmount<'a>>),
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OvertimeAmount<'a> {
    pub status: &'static str,
    pub complete_gross: bool,
    pub date: &'a str,
    pub payout_month: Option<&'static str>,
    pub package_id: &'a str,
    pub version_id: &'a str,
    pub group_id: String,
    pub step_id: &'a str,
    pub cash_subtotal_cents: i64,
    pub source_ids: Vec<&'a str>,
    pub positions: [OvertimePosition; 2],
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OvertimeComponent {
    WorkHours,
    OvertimePremium,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OvertimePosition {
    pub component: OvertimeComponent,
    pub settlement: Settlement,
    pub minutes: i64,
    pub reference_hourly_cents: i64,
    pub percentage_basis_points: i64,
    pub nominal_amount_cents: i64,
    pub cash_amount_cents: i64,
}
pub fn calculate_annex_a_overtime<'a>(
    pkg: &'a RulePackage,
    input: &'a AnnexOvertimeInput,
) -> Result<AnnexOvertimeResult<'a>, DraftPayError> {
    use OvertimeFailure::*;
    if pkg.engine_contract_version != 16
        || pkg.status() != Some("DRAFT")
        || !FullNativePackageValidator
            .validate(pkg)
            .map_err(BaseError::from)?
    {
        return Ok(unavailable(InvalidPackage));
    }
    let Some(policy) = pkg.rules().get("tvoedAnnexAOvertimePolicy") else {
        return Ok(unavailable(MissingPolicy));
    };
    let date = input.date.as_str();
    if !valid_date(date)
        || date < pkg.valid_from.as_str()
        || pkg.valid_to.as_deref().is_some_and(|to| date > to)
        || date < text(policy, "validFrom")?
        || date > text(policy, "validTo")?
    {
        return Ok(unavailable(OutsideValidity));
    }
    if !input.applicability_confirmed {
        return Ok(unavailable(TariffApplicabilityUnconfirmed));
    }
    if !input.full_time_reference_confirmed
        || input.full_time_weekly_minutes != number(policy, "standardFullTimeWeeklyMinutes")?
    {
        return Ok(unavailable(FullTimeReferenceUnsupported));
    }
    if !safe(input.minutes) || input.minutes < 1.0 || input.minutes > 1440.0 {
        return Ok(unavailable(InvalidMinutes));
    }
    match input.classification {
        Classification::NotOvertime => return Ok(unavailable(NotOvertime)),
        Classification::Unknown => return Ok(unavailable(ClassificationUnconfirmed)),
        Classification::ConfirmedTvoedOvertime => {}
    }
    if !input.work_pay_not_already_included_confirmed {
        return Ok(unavailable(WorkPayDuplicationUnconfirmed));
    }
    if input.work_settlement == Settlement::Unknown
        || input.premium_settlement == Settlement::Unknown
    {
        return Ok(unavailable(SettlementUnconfirmed));
    }
    let group = input.group_id.to_lowercase();
    let selected = resolve_tariff_selection(pkg, &input.variant_id, "VKA");
    let Some(selected) = selected.filter(|s| {
        s.family_id == "tvoed-vka-annex-a"
            && s.engine_id == "tvoed-annex-a-v1"
            && s.groups
                .iter()
                .any(|g| g.id == group && g.levels.contains(&input.step_id))
    }) else {
        return Ok(unavailable(UnknownSelection));
    };
    let table = rows(pkg.rules(), "payTables")
        .iter()
        .find(|t| t["id"] == selected.region["payTableId"]);
    let step = input.step_id.as_bytes();
    if step.len() != 2 || step[0] != b's' || !(b'1'..=b'6').contains(&step[1]) {
        return Ok(unavailable(MissingTableValue));
    }
    let stage = i64::from(step[1] - b'0');
    let maximum = text(policy, "workPayMaximumStepId")?[1..]
        .parse::<i64>()
        .map_err(|_| DraftPayError::InvalidInput)?;
    let work_step = format!("s{}", stage.min(maximum));
    let reference_step = text(policy, "premiumReferenceStepId")?;
    let matching_pay = |step: &str| {
        table
            .into_iter()
            .flat_map(|t| rows(t, "entries"))
            .filter(|entry| entry["groupId"] == group && entry["stepId"] == step)
            .collect::<Vec<_>>()
    };
    let work_pay = matching_pay(&work_step);
    let premium_pay = matching_pay(reference_step);
    if work_pay.len() != 1 || premium_pay.len() != 1 {
        return Ok(unavailable(MissingTableValue));
    }
    let Some(rate) = rows(policy, "rateBands")
        .iter()
        .find(|rate| rows(rate, "groupIds").iter().any(|id| id == &group))
    else {
        return Ok(unavailable(MissingRate));
    };
    let divisor = number(policy, "standardFullTimeWeeklyMinutes")?
        * number(policy, "monthlyFactorThousandths")?;
    // Source Number products are formed in this exact order before the shared
    // exact integer-ratio rounding kernel; no epsilon or changed arithmetic.
    let work_numerator = number(work_pay[0], "monthlyCents")? * 60000.0;
    let premium_numerator = number(premium_pay[0], "monthlyCents")? * 60000.0;
    if !safe(work_numerator) || !safe(premium_numerator) {
        return Ok(unavailable(AmountOverflow));
    }
    let work_hourly = round_remuneration_cents(work_numerator, divisor)?;
    let premium_hourly = round_remuneration_cents(premium_numerator, divisor)?;
    let percentage = number(rate, "premiumBasisPoints")?;
    let work_nominal_numerator = work_hourly as f64 * input.minutes;
    let premium_nominal_numerator = premium_hourly as f64 * percentage * input.minutes;
    if !safe(work_nominal_numerator) || !safe(premium_nominal_numerator) {
        return Ok(unavailable(AmountOverflow));
    }
    let work_nominal = round_remuneration_cents(work_nominal_numerator, 60.0)?;
    let premium_nominal = round_remuneration_cents(premium_nominal_numerator, 600000.0)?;
    let work_cash = if input.work_settlement == Settlement::Cash {
        work_nominal
    } else {
        0
    };
    let premium_cash = if input.premium_settlement == Settlement::Cash {
        premium_nominal
    } else {
        0
    };
    let cash_total = work_cash as f64 + premium_cash as f64;
    if !safe(cash_total) {
        return Ok(unavailable(AmountOverflow));
    }
    Ok(AnnexOvertimeResult::DraftConfirmedOvertime(Box::new(
        OvertimeAmount {
            status: "estimated",
            complete_gross: false,
            date,
            payout_month: None,
            package_id: &pkg.package_id,
            version_id: &pkg.version_id,
            group_id: group,
            step_id: &input.step_id,
            cash_subtotal_cents: cash_total as i64,
            source_ids: rows(policy, "sourceIds")
                .iter()
                .map(|id| id.as_str().ok_or(DraftPayError::InvalidInput))
                .collect::<Result<_, _>>()?,
            positions: [
                OvertimePosition {
                    component: OvertimeComponent::WorkHours,
                    settlement: input.work_settlement,
                    minutes: input.minutes as i64,
                    reference_hourly_cents: work_hourly,
                    percentage_basis_points: 10000,
                    nominal_amount_cents: work_nominal,
                    cash_amount_cents: work_cash,
                },
                OvertimePosition {
                    component: OvertimeComponent::OvertimePremium,
                    settlement: input.premium_settlement,
                    minutes: input.minutes as i64,
                    reference_hourly_cents: premium_hourly,
                    percentage_basis_points: percentage as i64,
                    nominal_amount_cents: premium_nominal,
                    cash_amount_cents: premium_cash,
                },
            ],
        },
    )))
}
fn unavailable(reason: OvertimeFailure) -> AnnexOvertimeResult<'static> {
    AnnexOvertimeResult::Unavailable { reason }
}
fn number(value: &Value, key: &str) -> Result<f64, DraftPayError> {
    value[key].as_f64().ok_or(DraftPayError::InvalidInput)
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, DraftPayError> {
    value[key].as_str().ok_or(DraftPayError::InvalidInput)
}
fn valid_date(date: &str) -> bool {
    date.len() == 10
        && date.as_bytes()[4] == b'-'
        && date.as_bytes()[7] == b'-'
        && date
            .bytes()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
        && date
            .parse::<jiff::civil::Date>()
            .is_ok_and(|d| d.to_string() == date)
}
