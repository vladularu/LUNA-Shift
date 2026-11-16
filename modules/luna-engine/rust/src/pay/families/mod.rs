//! Current salary/training families. Native calculations are added and parity-tested per family.
mod common;
pub mod profile;
pub mod tvh;
pub mod tvl_tval;
pub mod tvuk;
pub mod vka_training;

use crate::{
    EngineError,
    rules::{RuleResolutionFailure, holidays::HolidayError},
};
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Family {
    VkaE,
    Training,
    Tvl,
    Tvuk,
    Tvh,
    Tval,
}
impl Family {
    pub fn field(self) -> &'static str {
        match self {
            Self::VkaE => "vkaETariff",
            Self::Training => "nursingTrainingTariff",
            Self::Tvl => "tvlKrTariff",
            Self::Tvuk => "tvUkNursingTariff",
            Self::Tvh => "tvhKrTariff",
            Self::Tval => "tvalPflegeTariff",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Self::VkaE => "TVöD VKA · E-Tabelle",
            Self::Training => "TVAöD Pflege",
            Self::Tvl => "TV-L Pflege",
            Self::Tvuk => "TV-UK Pflege (Baden-Württemberg)",
            Self::Tvh => "TV-H Pflege",
            Self::Tval => "TVA-L Pflege",
        }
    }
    pub fn package_id(self) -> &'static str {
        match self {
            Self::VkaE => "tvoed-vka-anlage-a",
            Self::Training => "tvaoed-pflege-vka",
            Self::Tvl => "tvl-kr-tdl",
            Self::Tvuk => "tv-uk-nursing",
            Self::Tvh => "tvh-kr-tdl",
            Self::Tval => "tval-pflege-tdl",
        }
    }
}

#[derive(Debug)]
pub enum FamilyError {
    Calculation(EngineError),
    Profile(profile::FamilyProfileError),
    Rule(Box<RuleResolutionFailure>),
    Holiday(HolidayError),
    Pattern(super::pattern::PatternError),
    Premium(super::premium_minutes::PremiumError),
    Trace(crate::net::premium_trace::PremiumTraceError),
    Message(&'static str),
}
impl fmt::Display for FamilyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Calculation(e) => e.fmt(f),
            Self::Profile(e) => e.fmt(f),
            Self::Rule(e) => e.fmt(f),
            Self::Holiday(e) => e.fmt(f),
            Self::Pattern(e) => e.fmt(f),
            Self::Premium(e) => e.fmt(f),
            Self::Trace(e) => e.fmt(f),
            Self::Message(e) => f.write_str(e),
        }
    }
}
impl std::error::Error for FamilyError {}
impl FamilyError {
    pub fn rule_failure(&self) -> Option<&RuleResolutionFailure> {
        match self {
            Self::Rule(failure) => Some(failure),
            Self::Holiday(HolidayError::Resolution(failure)) => Some(failure),
            Self::Premium(super::premium_minutes::PremiumError::Holiday(
                HolidayError::Resolution(failure),
            )) => Some(failure),
            Self::Calculation(_)
            | Self::Profile(_)
            | Self::Holiday(
                HolidayError::InvalidDate
                | HolidayError::InvalidRule
                | HolidayError::InvalidCollation,
            )
            | Self::Pattern(_)
            | Self::Premium(_)
            | Self::Trace(_)
            | Self::Message(_) => None,
        }
    }
}
impl From<EngineError> for FamilyError {
    fn from(e: EngineError) -> Self {
        Self::Calculation(e)
    }
}
impl From<profile::FamilyProfileError> for FamilyError {
    fn from(e: profile::FamilyProfileError) -> Self {
        Self::Profile(e)
    }
}
impl From<HolidayError> for FamilyError {
    fn from(e: HolidayError) -> Self {
        Self::Holiday(e)
    }
}
impl From<super::pattern::PatternError> for FamilyError {
    fn from(e: super::pattern::PatternError) -> Self {
        Self::Pattern(e)
    }
}
impl From<super::premium_minutes::PremiumError> for FamilyError {
    fn from(e: super::premium_minutes::PremiumError) -> Self {
        Self::Premium(e)
    }
}
impl From<crate::net::premium_trace::PremiumTraceError> for FamilyError {
    fn from(e: crate::net::premium_trace::PremiumTraceError) -> Self {
        Self::Trace(e)
    }
}

#[derive(Debug, Clone)]
pub struct FamilyShiftOptions {
    pub saturday_shift_work: bool,
    pub regular_shift_work: bool,
    pub paid_night_breaks: bool,
    pub allowance_status: String,
}

#[derive(Clone, Copy)]
pub struct FamilyMonthInput<'a> {
    pub month: &'a str,
    pub shifts: &'a [serde_json::Value],
    pub profile: &'a serde_json::Value,
    pub decision: Option<&'a serde_json::Value>,
    pub assessment_shifts: &'a [serde_json::Value],
    pub settings: &'a crate::pay::pattern::WorkPatternSettings,
}

pub fn calculate_monthly_pay(
    family: Family,
    input: &FamilyMonthInput<'_>,
    resolver: &crate::rules::RuleResolver,
) -> Result<serde_json::Value, FamilyError> {
    match family {
        Family::VkaE | Family::Training => vka_training::calculate_month(family, input, resolver),
        Family::Tvl | Family::Tval => tvl_tval::calculate_month(family, input, resolver),
        Family::Tvuk => tvuk::calculate_month(
            input.month,
            input.shifts,
            input.profile,
            input.assessment_shifts,
            resolver,
        ),
        Family::Tvh => tvh::calculate_month(
            input.month,
            input.shifts,
            input.profile,
            input.decision,
            input.assessment_shifts,
            input.settings,
            resolver,
        ),
    }
}

/// Financial facts captured by the very same pricing traversal used for the estimate.
/// The provider can construct PayrollTrace directly; it must not price this shift again.
#[derive(Debug)]
pub struct FamilyPremiumEvidence {
    pub shift_id: String,
    pub breakdown: serde_json::Value,
    pub trace: serde_json::Value,
    pub night_compensatory_minutes: f64,
}
#[derive(Debug)]
pub struct FamilyMonthEvidence {
    pub estimate: serde_json::Value,
    pub premium_evidence: Vec<FamilyPremiumEvidence>,
    pub expected_shift_ids: Vec<String>,
    pub missing_trace_shift_ids: Vec<String>,
}
pub fn calculate_monthly_pay_with_evidence(
    family: Family,
    input: &FamilyMonthInput<'_>,
    resolver: &crate::rules::RuleResolver,
) -> Result<FamilyMonthEvidence, FamilyError> {
    let mut estimate = match family {
        Family::VkaE | Family::Training => {
            vka_training::calculate_month_with_capture(family, input, resolver, true)?
        }
        Family::Tvl | Family::Tval => {
            tvl_tval::calculate_month_with_capture(family, input, resolver, true)?
        }
        Family::Tvuk => tvuk::calculate_month_with_capture(
            input.month,
            input.shifts,
            input.profile,
            input.assessment_shifts,
            resolver,
            true,
        )?,
        Family::Tvh => tvh::calculate_month_with_capture(input, resolver, true)?,
    };
    let prefix = format!("{}-", input.month);
    let expected_shift_ids: Vec<String> = input
        .shifts
        .iter()
        .filter(|s| common::work(s) && s["date"].as_str().is_some_and(|d| d.starts_with(&prefix)))
        .map(|s| {
            s["id"]
                .as_str()
                .map(str::to_owned)
                .ok_or(FamilyError::Message("Invalid family shift identity"))
        })
        .collect::<Result<_, _>>()?;
    let mut premium_evidence = vec![];
    if let Some(breakdowns) = estimate
        .get_mut("shiftBreakdowns")
        .and_then(serde_json::Value::as_array_mut)
    {
        for breakdown in breakdowns {
            let trace = breakdown
                .as_object_mut()
                .and_then(|m| m.remove("payrollTrace"));
            if let Some(trace) = trace.filter(serde_json::Value::is_object) {
                let shift_id = breakdown["shiftId"]
                    .as_str()
                    .ok_or(FamilyError::Message("Invalid family shift identity"))?
                    .to_owned();
                premium_evidence.push(FamilyPremiumEvidence {
                    shift_id,
                    night_compensatory_minutes: breakdown["nightCompensatoryMinutes"]
                        .as_f64()
                        .unwrap_or(0.0),
                    breakdown: breakdown.clone(),
                    trace,
                });
            }
        }
    }
    let captured: std::collections::BTreeSet<_> = premium_evidence
        .iter()
        .map(|e| e.shift_id.as_str())
        .collect();
    let missing_trace_shift_ids = expected_shift_ids
        .iter()
        .filter(|id| !captured.contains(id.as_str()))
        .cloned()
        .collect();
    Ok(FamilyMonthEvidence {
        estimate,
        premium_evidence,
        expected_shift_ids,
        missing_trace_shift_ids,
    })
}
impl Default for FamilyShiftOptions {
    fn default() -> Self {
        Self {
            saturday_shift_work: false,
            regular_shift_work: false,
            paid_night_breaks: false,
            allowance_status: "NONE".into(),
        }
    }
}

/// One monetary policy implementation for normal rendering and the optional SFN side channel.
pub fn calculate_shift_breakdown(
    family: Family,
    shift: &serde_json::Value,
    profile: &serde_json::Value,
    resolver: &crate::rules::RuleResolver,
    options: &FamilyShiftOptions,
    capture_payroll_trace: bool,
) -> Result<serde_json::Value, FamilyError> {
    match family {
        Family::VkaE | Family::Training => {
            vka_training::calculate_shift(family, shift, profile, resolver, capture_payroll_trace)
        }
        Family::Tvl | Family::Tval => tvl_tval::calculate_shift(
            family,
            shift,
            profile,
            options.saturday_shift_work,
            resolver,
            capture_payroll_trace,
        ),
        Family::Tvuk => tvuk::calculate_shift(
            shift,
            profile,
            options.regular_shift_work,
            options.paid_night_breaks,
            resolver,
            capture_payroll_trace,
        ),
        Family::Tvh => tvh::calculate_shift(
            shift,
            profile,
            options.saturday_shift_work,
            &options.allowance_status,
            resolver,
            capture_payroll_trace,
        ),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DutyOvertimeRates {
    pub base_hourly_cents: i64,
    pub premium_hourly_cents: i64,
    pub premium_basis_points: i64,
}

pub fn duty_hourly_cents(
    family: Family,
    date: &str,
    profile: &serde_json::Value,
    resolver: &crate::rules::RuleResolver,
) -> Result<Option<i64>, FamilyError> {
    let value = match family {
        Family::VkaE | Family::Training => {
            vka_training::duty_hourly(family, date, profile, resolver)?
        }
        Family::Tvl | Family::Tval => tvl_tval::duty_hourly(family, date, profile, resolver)?,
        Family::Tvuk => tvuk::duty_hourly(date, profile, resolver)?,
        Family::Tvh => tvh::duty_hourly(date, profile, resolver)?,
    };
    if value.is_null() {
        Ok(None)
    } else {
        value
            .as_i64()
            .map(Some)
            .ok_or(FamilyError::Message("Invalid family hourly rate"))
    }
}

/// TV-UK has no separate source overtime-rate getter; its caller retains its own duty policy.
pub fn duty_overtime_rates(
    family: Family,
    date: &str,
    profile: &serde_json::Value,
    resolver: &crate::rules::RuleResolver,
) -> Result<Option<DutyOvertimeRates>, FamilyError> {
    let value = match family {
        Family::VkaE | Family::Training => {
            vka_training::duty_overtime_rates(family, date, profile, resolver)?
        }
        Family::Tvl | Family::Tval => {
            tvl_tval::duty_overtime_rates(family, date, profile, resolver)?
        }
        Family::Tvh => tvh::duty_overtime_rates(date, profile, resolver)?,
        Family::Tvuk => return Ok(None),
    };
    if value.is_null() {
        Ok(None)
    } else {
        serde_json::from_value(value)
            .map(Some)
            .map_err(|_| FamilyError::Message("Invalid family overtime rates"))
    }
}

pub fn select_assessment_shifts<'a>(
    family: Family,
    entries: &'a [serde_json::Value],
    month: &str,
) -> Result<Vec<&'a serde_json::Value>, FamilyError> {
    use jiff::ToSpan;
    let first = crate::calendar::parse_date(&common::month_first(month)?)?;
    let from = if matches!(family, Family::VkaE | Family::Training) {
        first
            .checked_sub(2.months())
            .map_err(|_| crate::EngineError::InvalidDate)?
            .to_string()
    } else {
        first.to_string()
    };
    let through = crate::calendar::month_range(month)?.end;
    Ok(entries
        .iter()
        .filter(|entry| {
            entry["kind"] == "SHIFT"
                && entry.get("deletedAt") == Some(&serde_json::Value::Null)
                && entry["date"]
                    .as_str()
                    .is_some_and(|date| date >= from.as_str() && date <= through.as_str())
        })
        .collect())
}
