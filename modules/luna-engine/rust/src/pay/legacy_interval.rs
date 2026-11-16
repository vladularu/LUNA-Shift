//! The original pay.ts interval path, with an explicitly selected dated package.
//! Classification and optional minute evidence share one traversal; overtime is never allocated here.
use super::{
    legacy::round_money,
    pattern::is_pay_work_shift,
    premium_minutes::{self, ClassifiedMinutes, PremiumError, PremiumMinuteInterval, PremiumRules},
    tariff::{self, TariffError, TariffProfile},
};
use crate::{
    EngineError,
    rules::{RulePackage, RuleResolutionFailure, RuleResolver, holidays::HolidayError},
};
use num_traits::ToPrimitive;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug)]
pub enum IntervalError {
    MissingRate,
    InvalidInput,
    InvalidInterval,
    Time(EngineError),
    Tariff(TariffError),
    Premium(PremiumError),
    MissingReferenceStep(String),
}
impl From<TariffError> for IntervalError {
    fn from(e: TariffError) -> Self {
        Self::Tariff(e)
    }
}
impl From<PremiumError> for IntervalError {
    fn from(e: PremiumError) -> Self {
        Self::Premium(e)
    }
}
impl From<EngineError> for IntervalError {
    fn from(e: EngineError) -> Self {
        Self::Time(e)
    }
}
impl IntervalError {
    pub fn rule_failure(&self) -> Option<&RuleResolutionFailure> {
        match self {
            Self::Premium(PremiumError::Holiday(HolidayError::Resolution(f))) => Some(f),
            _ => None,
        }
    }
}
impl std::fmt::Display for IntervalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingRate => {
                f.write_str("Die Stundenbasis für den Zeitzuschlag ist nicht verfügbar.")
            }
            Self::InvalidInput => f.write_str("Invalid interval-pay inputs"),
            Self::InvalidInterval => f.write_str("Ungültiges Zuschlagsintervall."),
            Self::Time(e) => e.fmt(f),
            Self::Tariff(e) => e.fmt(f),
            Self::Premium(e) => e.fmt(f),
            Self::MissingReferenceStep(id) => {
                write!(f, "Premium rule {id} requires a reference step.")
            }
        }
    }
}
impl std::error::Error for IntervalError {}
fn scalar<S: serde::Serializer>(n: &f64, s: S) -> Result<S::Ok, S::Error> {
    if n.fract() == 0.0 && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64 {
        s.serialize_i64(*n as i64)
    } else {
        s.serialize_f64(*n)
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct TimePremiumInterval {
    pub from: f64,
    pub until: f64,
    pub date: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntervalPremiumLine {
    pub key: String,
    pub label: String,
    pub minutes: i64,
    #[serde(serialize_with = "scalar")]
    pub percentage: f64,
    #[serde(serialize_with = "scalar")]
    pub hourly_rate: f64,
    #[serde(serialize_with = "scalar")]
    pub amount: f64,
    pub rule_id: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntervalBreakdown {
    pub shift_id: String,
    pub date: String,
    #[serde(serialize_with = "scalar")]
    pub net_minutes: f64,
    pub premium_lines: Vec<IntervalPremiumLine>,
    pub overtime_base_amount: i64,
    pub overtime_premium_amount: i64,
    #[serde(serialize_with = "scalar")]
    pub total_amount: f64,
}
#[derive(Debug)]
pub struct IntervalCalculation {
    pub breakdown: IntervalBreakdown,
    pub classified: ClassifiedMinutes,
}
struct Rule<'a> {
    id: &'a str,
    label: &'a str,
    premium_type: &'a str,
    rate_basis: &'a str,
    reference_step_id: Option<&'a str>,
    basis_points: f64,
}
/// Reuse once per request/package when pricing several dated day sections.
pub struct PreparedIntervalRules<'a> {
    package: &'a RulePackage,
    rules: Vec<Rule<'a>>,
    classifier: PremiumRules,
}
fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str, IntervalError> {
    v.get(key)
        .and_then(Value::as_str)
        .ok_or(IntervalError::InvalidInput)
}
fn empty(shift: &Value) -> Result<IntervalCalculation, IntervalError> {
    Ok(IntervalCalculation {
        breakdown: IntervalBreakdown {
            shift_id: text(shift, "id")?.into(),
            date: text(shift, "date")?.into(),
            net_minutes: 0.0,
            premium_lines: vec![],
            overtime_base_amount: 0,
            overtime_premium_amount: 0,
            total_amount: 0.0,
        },
        classified: ClassifiedMinutes::default(),
    })
}
impl<'a> PreparedIntervalRules<'a> {
    pub fn new(package: &'a RulePackage) -> Result<Self, IntervalError> {
        let body = package.rules();
        let mut rules = vec![];
        for r in body["premiumRules"]
            .as_array()
            .ok_or(IntervalError::InvalidInput)?
        {
            rules.push(Rule {
                id: text(r, "id")?,
                label: text(r, "label")?,
                premium_type: text(r, "premiumType")?,
                rate_basis: text(r, "rateBasis")?,
                reference_step_id: r.get("referenceStepId").and_then(Value::as_str),
                basis_points: r["percentageBasisPoints"]
                    .as_f64()
                    .ok_or(IntervalError::InvalidInput)?,
            });
        }
        Ok(Self {
            package,
            rules,
            classifier: PremiumRules::from_json(body)?,
        })
    }
    pub fn calculate(
        &self,
        shift: &Value,
        profile: &Value,
        resolver: &RuleResolver,
        interval: &TimePremiumInterval,
        capture_minutes: bool,
    ) -> Result<IntervalCalculation, IntervalError> {
        let raw_tariff = profile.get("tariff").ok_or(IntervalError::InvalidInput)?;
        if raw_tariff.is_null()
            || resolver
                .resolve_tariff(&interval.date, Some(&self.package.package_id))
                .ok()
                .is_none_or(|p| !std::ptr::eq(p, self.package))
        {
            return Err(IntervalError::MissingRate);
        }
        if !is_pay_work_shift(shift) {
            return empty(shift);
        }
        let tariff =
            TariffProfile::deserialize(raw_tariff).map_err(|_| IntervalError::InvalidInput)?;
        let individual = tariff::get_individual_hourly_rate_from_package(self.package, &tariff)?;
        let span = premium_minutes::span_from_shift(shift, profile)?;
        if !interval.from.is_finite()
            || !interval.until.is_finite()
            || interval.from.fract() != 0.0
            || interval.until.fract() != 0.0
            || interval.from < 0.0
            || interval.until < interval.from
            || interval.until > span.gross_minutes as f64
        {
            return Err(IntervalError::InvalidInterval);
        }
        let mut selected = PremiumMinuteInterval::new(interval.from as i64, interval.until as i64);
        selected.capture_minutes = capture_minutes;
        let classified = premium_minutes::count_premium_minutes(
            shift,
            profile,
            &span,
            &self.classifier,
            resolver,
            Some(&selected),
        )?;
        let mut lines = vec![];
        for rule in &self.rules {
            let minutes = classified.by_rule_id.get(rule.id).copied().unwrap_or(0);
            if rule.premium_type == "OVERTIME" || minutes <= 0 {
                continue;
            }
            let hourly = if rule.rate_basis == "INDIVIDUAL_HOURLY" {
                individual.ok_or(IntervalError::MissingRate)?
            } else {
                let step = rule
                    .reference_step_id
                    .ok_or_else(|| IntervalError::MissingReferenceStep(rule.id.into()))?;
                tariff::get_hourly_table_amount_for_step_from_package(self.package, &tariff, step)?
                    .ok_or(IntervalError::MissingRate)?
            };
            let percentage = rule.basis_points / 100.0;
            let amount = round_money((minutes as f64 / 60.0) * hourly * (percentage / 100.0));
            let key = match rule.premium_type {
                "HOLIDAY_WITH_TIME_OFF" | "HOLIDAY_WITHOUT_TIME_OFF" => "holiday".into(),
                "PRE_HOLIDAY" => "preholiday".into(),
                other => other.to_lowercase(),
            };
            lines.push(IntervalPremiumLine {
                key,
                label: rule.label.into(),
                minutes,
                percentage,
                hourly_rate: hourly,
                amount,
                rule_id: rule.id.into(),
            });
        }
        let break_start = span
            .break_start
            .to_f64()
            .ok_or(IntervalError::InvalidInput)?;
        let break_end = span.break_end.to_f64().ok_or(IntervalError::InvalidInput)?;
        let overlap = (interval.until.min(break_end) - interval.from.max(break_start)).max(0.0);
        let total = round_money(lines.iter().fold(0.0, |sum, l| sum + l.amount));
        Ok(IntervalCalculation {
            breakdown: IntervalBreakdown {
                shift_id: text(shift, "id")?.into(),
                date: interval.date.clone(),
                net_minutes: interval.until - interval.from - overlap,
                premium_lines: lines,
                overtime_base_amount: 0,
                overtime_premium_amount: 0,
                total_amount: total,
            },
            classified,
        })
    }
}
fn calculate(
    shift: &Value,
    profile: &Value,
    resolver: &RuleResolver,
    interval: &TimePremiumInterval,
    requested_package: Option<&str>,
    capture: bool,
) -> Result<IntervalCalculation, IntervalError> {
    let tariff = profile.get("tariff").ok_or(IntervalError::InvalidInput)?;
    let package = resolver
        .resolve_tariff(&interval.date, requested_package)
        .ok();
    if tariff.is_null() || package.is_none() {
        return Err(IntervalError::MissingRate);
    }
    if !is_pay_work_shift(shift) {
        return empty(shift);
    }
    PreparedIntervalRules::new(package.ok_or(IntervalError::MissingRate)?)?
        .calculate(shift, profile, resolver, interval, capture)
}
pub fn calculate_time_premium_interval(
    shift: &Value,
    profile: &Value,
    resolver: &RuleResolver,
    interval: &TimePremiumInterval,
    requested_package: Option<&str>,
) -> Result<IntervalBreakdown, IntervalError> {
    calculate(shift, profile, resolver, interval, requested_package, false).map(|r| r.breakdown)
}
pub fn calculate_time_premium_interval_with_evidence(
    shift: &Value,
    profile: &Value,
    resolver: &RuleResolver,
    interval: &TimePremiumInterval,
    requested_package: Option<&str>,
) -> Result<IntervalCalculation, IntervalError> {
    calculate(shift, profile, resolver, interval, requested_package, true)
}
