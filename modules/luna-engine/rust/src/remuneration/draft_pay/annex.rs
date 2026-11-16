use super::{DraftPayError, day_bounds, rows, safe};
use crate::{
    remuneration::{
        base::round_remuneration_cents,
        context::{
            model::{FullNativePackageValidator, NativePackageValidator},
            selection::resolve_tariff_selection,
        },
    },
    rules::RulePackage,
};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AnnexFailure {
    InvalidPackage,
    InvalidMonth,
    OutsideValidity,
    TariffApplicabilityUnconfirmed,
    FullTimeReferenceUnsupported,
    WorkDataIncomplete,
    CashPaymentUnconfirmed,
    LocalAgreementUnsupported,
    UnknownSelection,
    MissingPolicy,
    MissingReferencePay,
    AmountOverflow,
    InvalidWorkedSlice,
    DstDayUnsupported,
    SpecialWorkUnsupported,
    HolidayUnknown,
    HolidayTimeOffUnknown,
    OverlappingWork,
    ShiftWorkUnknown,
    LegacyClassUnknown,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Premium {
    Night,
    Sunday,
    HolidayWithTimeOff,
    HolidayWithoutTimeOff,
    PreHoliday,
    Saturday,
}
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum AnnexPremiumResult<'a> {
    Unavailable { reason: AnnexFailure },
    DraftTimePremiums(AnnexPremiumAmount<'a>),
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnexPremiumAmount<'a> {
    pub complete_gross: bool,
    pub status: &'static str,
    pub amount_cents: i64,
    pub reference_hourly_cents: i64,
    pub package_id: &'a str,
    pub version_id: &'a str,
    pub source_ids: Vec<&'a str>,
    pub excluded_components: [&'static str; 4],
    pub positions: Vec<AnnexPremiumPosition>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnexPremiumPosition {
    pub date: String,
    pub premium: Premium,
    pub minutes: i64,
    pub percentage_basis_points: i64,
    pub amount_cents: i64,
}
pub struct AnnexPremiumInput<'a> {
    pub month: &'a str,
    pub variant_id: &'a str,
    pub group_id: &'a str,
    pub full_time_weekly_minutes: f64,
    pub full_time_reference_confirmed: bool,
    pub applicability_confirmed: bool,
    pub work_data_complete: bool,
    pub cash_payment_confirmed: bool,
    pub local_agreement: &'a str,
    pub worked_slices: &'a [Value],
}
fn unavailable(reason: AnnexFailure) -> AnnexPremiumResult<'static> {
    AnnexPremiumResult::Unavailable { reason }
}
fn number(value: &Value, key: &str) -> Result<i64, DraftPayError> {
    value[key].as_i64().ok_or(DraftPayError::InvalidInput)
}
fn window(minute: i64, value: &Value) -> Result<bool, DraftPayError> {
    let start = number(value, "startMinute")?;
    let end = number(value, "endMinute")?;
    Ok(if start < end {
        minute >= start && minute < end
    } else {
        minute >= start || minute < end
    })
}
struct Bucket {
    date: String,
    premium: Premium,
    minutes: i64,
    rate: i64,
}
fn count<'a>(
    buckets: &mut Vec<Bucket>,
    indices: &mut BTreeMap<(&'a str, Premium), usize>,
    date: &'a str,
    premium: Premium,
    rate: i64,
) {
    let key = (date, premium);
    if let Some(index) = indices.get(&key) {
        buckets[*index].minutes += 1;
    } else {
        indices.insert(key, buckets.len());
        buckets.push(Bucket {
            date: date.into(),
            premium,
            minutes: 1,
            rate,
        });
    }
}
pub fn calculate_annex_a_time_premiums<'a>(
    pkg: &'a RulePackage,
    input: &AnnexPremiumInput<'_>,
) -> Result<AnnexPremiumResult<'a>, DraftPayError> {
    use AnnexFailure::*;
    if pkg.engine_contract_version != 16
        || pkg.status() != Some("DRAFT")
        || !FullNativePackageValidator
            .validate(pkg)
            .map_err(crate::remuneration::base::BaseError::from)?
    {
        return Ok(unavailable(InvalidPackage));
    }
    let month = input.month;
    if month.len() != 7
        || month.as_bytes()[4] != b'-'
        || month
            .bytes()
            .enumerate()
            .any(|(i, b)| i != 4 && !b.is_ascii_digit())
    {
        return Ok(unavailable(InvalidMonth));
    }
    let Ok(first) = format!("{month}-01").parse::<jiff::civil::Date>() else {
        return Ok(unavailable(InvalidMonth));
    };
    if first.to_string() < pkg.valid_from
        || pkg
            .valid_to
            .as_ref()
            .is_some_and(|to| first.last_of_month().to_string() > *to)
    {
        return Ok(unavailable(OutsideValidity));
    }
    if !input.applicability_confirmed {
        return Ok(unavailable(TariffApplicabilityUnconfirmed));
    }
    if !input.full_time_reference_confirmed || input.full_time_weekly_minutes != 2340.0 {
        return Ok(unavailable(FullTimeReferenceUnsupported));
    }
    if !input.work_data_complete {
        return Ok(unavailable(WorkDataIncomplete));
    }
    if !input.cash_payment_confirmed {
        return Ok(unavailable(CashPaymentUnconfirmed));
    }
    if input.local_agreement != "NONE_CONFIRMED" {
        return Ok(unavailable(LocalAgreementUnsupported));
    }
    let Some(selected) = resolve_tariff_selection(pkg, input.variant_id, "VKA")
        .filter(|s| s.family_id == "tvoed-vka-annex-a" && s.engine_id == "tvoed-annex-a-v1")
    else {
        return Ok(unavailable(UnknownSelection));
    };
    let Some(policy) = pkg.rules().get("tvoedAnnexATimePremiumPolicy") else {
        return Ok(unavailable(MissingPolicy));
    };
    let group = input.group_id.to_lowercase();
    let reference: Vec<_> = rows(pkg.rules(), "payTables")
        .iter()
        .find(|t| t["id"] == selected.region["payTableId"])
        .into_iter()
        .flat_map(|t| rows(t, "entries"))
        .filter(|e| e["groupId"] == group && e["stepId"] == policy["referenceStepId"])
        .collect();
    if reference.len() != 1 {
        return Ok(unavailable(MissingReferencePay));
    }
    let numerator = number(reference[0], "monthlyCents")? as f64 * 60000.0;
    if !safe(numerator) {
        return Ok(unavailable(AmountOverflow));
    }
    let hourly = round_remuneration_cents(
        numerator,
        input.full_time_weekly_minutes * number(policy, "monthlyFactorThousandths")? as f64,
    )?;
    if input.worked_slices.len() > 100_000 {
        return Err(DraftPayError::InvalidInput);
    }
    let mut buckets = vec![];
    let mut indices = BTreeMap::new();
    let mut prior: BTreeMap<&str, Vec<(i64, i64)>> = BTreeMap::new();
    for slice in input.worked_slices {
        let date = slice["date"].as_str().unwrap_or("");
        let parsed = date.parse::<jiff::civil::Date>();
        let valid_number = |key: &str| slice[key].as_f64().filter(|n| safe(*n));
        let from = valid_number("fromMinute");
        let through = valid_number("throughMinute");
        let elapsed = valid_number("actualElapsedMinutes");
        if date.len() != 10
            || !date.starts_with(&format!("{month}-"))
            || parsed.as_ref().map_or(true, |d| d.to_string() != date)
            || !from
                .zip(through)
                .zip(elapsed)
                .is_some_and(|((f, t), e)| f >= 0.0 && t <= 1440.0 && f < t && e == t - f)
        {
            return Ok(unavailable(InvalidWorkedSlice));
        }
        let day = parsed.map_err(|_| DraftPayError::InvalidInput)?;
        let (start, end) = day_bounds(date, "Europe/Berlin")?;
        if end - start != 86_400_000 {
            return Ok(unavailable(DstDayUnsupported));
        }
        if slice["workKind"] != "REGULAR_ACTIVE" {
            return Ok(unavailable(SpecialWorkUnsupported));
        }
        let Some(holiday) = slice["publicHoliday"].as_bool() else {
            return Ok(unavailable(HolidayUnknown));
        };
        if holiday && !slice["holidayTimeOff"].is_boolean() {
            return Ok(unavailable(HolidayTimeOffUnknown));
        }
        let from = from.ok_or(DraftPayError::InvalidInput)? as i64;
        let through = through.ok_or(DraftPayError::InvalidInput)? as i64;
        let previous = prior.entry(date).or_default();
        if previous.iter().any(|(a, b)| from < *b && through > *a) {
            return Ok(unavailable(OverlappingWork));
        }
        previous.push((from, through));
        for minute in from..through {
            if window(minute, &policy["nightWindow"])? {
                count(
                    &mut buckets,
                    &mut indices,
                    date,
                    Premium::Night,
                    number(policy, "nightBasisPoints")?,
                );
            }
            let mut winner = None;
            let mut consider = |premium, rate| {
                if winner.is_none_or(|(_, prior)| rate > prior) {
                    winner = Some((premium, rate));
                }
            };
            if day.weekday().to_monday_one_offset() == 7 {
                consider(Premium::Sunday, number(policy, "sundayBasisPoints")?);
            }
            if holiday {
                if slice["holidayTimeOff"] == true {
                    consider(
                        Premium::HolidayWithTimeOff,
                        number(policy, "holidayWithTimeOffBasisPoints")?,
                    );
                } else {
                    consider(
                        Premium::HolidayWithoutTimeOff,
                        number(policy, "holidayWithoutTimeOffBasisPoints")?,
                    );
                }
            }
            if rows(policy, "preHolidayMonthDays")
                .iter()
                .any(|s| s.as_str() == Some(&date[5..]))
                && window(minute, &policy["preHolidayWindow"])?
            {
                consider(
                    Premium::PreHoliday,
                    number(policy, "preHolidayBasisPoints")?,
                );
            }
            if day.weekday().to_monday_one_offset() == 6
                && window(minute, &policy["saturdayWindow"])?
            {
                let Some(shift_work) = slice["shiftWork"].as_bool() else {
                    return Ok(unavailable(ShiftWorkUnknown));
                };
                if shift_work && !slice["legacyAngestellteClass"].is_boolean() {
                    return Ok(unavailable(LegacyClassUnknown));
                }
                if !shift_work || slice["legacyAngestellteClass"] == true {
                    consider(Premium::Saturday, number(policy, "saturdayBasisPoints")?);
                }
            }
            if let Some((premium, rate)) = winner {
                count(&mut buckets, &mut indices, date, premium, rate);
            }
        }
    }
    let positions = buckets
        .into_iter()
        .map(|b| {
            Ok(AnnexPremiumPosition {
                date: b.date,
                premium: b.premium,
                minutes: b.minutes,
                percentage_basis_points: b.rate,
                amount_cents: round_remuneration_cents(
                    hourly as f64 * b.rate as f64 * b.minutes as f64,
                    600000.0,
                )?,
            })
        })
        .collect::<Result<Vec<_>, DraftPayError>>()?;
    let amount = positions.iter().map(|p| p.amount_cents as f64).sum::<f64>();
    if !safe(amount) {
        return Ok(unavailable(AmountOverflow));
    }
    Ok(AnnexPremiumResult::DraftTimePremiums(AnnexPremiumAmount {
        complete_gross: false,
        status: "estimated",
        amount_cents: amount as i64,
        reference_hourly_cents: hourly,
        package_id: &pkg.package_id,
        version_id: &pkg.version_id,
        source_ids: rows(policy, "sourceIds")
            .iter()
            .filter_map(Value::as_str)
            .collect(),
        excluded_components: [
            "OVERTIME",
            "ALLOWANCES",
            "ANNUAL_PAYMENT",
            "OTHER_INDIVIDUAL_TERMS",
        ],
        positions,
    }))
}
