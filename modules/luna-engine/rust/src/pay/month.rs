//! Regular monthly gross, including dated employment periods. Special-duty
//! settlements are composed by the separate special-duty layer.
use super::{
    allowances::{self, AllowanceCalculationInput},
    families::{self, Family, FamilyMonthInput},
    legacy::{self, PayError, round_money},
    manual,
    pattern::{self, PatternError, WorkPatternSettings},
    periods::{self, PayrollPeriodsError},
    tariff::{self, TariffError, TariffProfile},
};
use crate::{
    EngineError,
    calendar::{month_range, parse_date},
    employment::{self, EmploymentError},
    rules::RuleResolver,
};
use jiff::ToSpan;
use serde::Deserialize;
use serde_json::{Value, json};

pub use super::families::{FamilyMonthEvidence as RegularMonthEvidence, FamilyPremiumEvidence};

fn without_evidence(estimate: Value) -> RegularMonthEvidence {
    RegularMonthEvidence {
        estimate,
        premium_evidence: vec![],
        expected_shift_ids: vec![],
        missing_trace_shift_ids: vec![],
    }
}

#[derive(Debug)]
pub enum MonthPayError {
    InvalidInput,
    Time(EngineError),
    Legacy(Box<PayError>),
    Family(Box<families::FamilyError>),
    Periods(PayrollPeriodsError),
    Pattern(PatternError),
    Employment(EmploymentError),
    Tariff(TariffError),
}
impl std::fmt::Display for MonthPayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidInput => f.write_str("Invalid monthly-pay inputs"),
            Self::Time(e) => e.fmt(f),
            Self::Legacy(e) => e.fmt(f),
            Self::Family(e) => e.fmt(f),
            Self::Periods(e) => e.fmt(f),
            Self::Pattern(e) => e.fmt(f),
            Self::Employment(e) => e.fmt(f),
            Self::Tariff(e) => e.fmt(f),
        }
    }
}
impl std::error::Error for MonthPayError {}
impl From<EngineError> for MonthPayError {
    fn from(e: EngineError) -> Self {
        Self::Time(e)
    }
}
impl From<PayError> for MonthPayError {
    fn from(e: PayError) -> Self {
        Self::Legacy(Box::new(e))
    }
}
impl From<families::FamilyError> for MonthPayError {
    fn from(e: families::FamilyError) -> Self {
        Self::Family(Box::new(e))
    }
}
impl From<PayrollPeriodsError> for MonthPayError {
    fn from(e: PayrollPeriodsError) -> Self {
        Self::Periods(e)
    }
}
impl From<PatternError> for MonthPayError {
    fn from(e: PatternError) -> Self {
        Self::Pattern(e)
    }
}
impl From<EmploymentError> for MonthPayError {
    fn from(e: EmploymentError) -> Self {
        Self::Employment(e)
    }
}
impl From<TariffError> for MonthPayError {
    fn from(e: TariffError) -> Self {
        Self::Tariff(e)
    }
}

#[derive(Clone, Copy)]
pub struct MonthPayInput<'a> {
    pub month: &'a str,
    pub shifts: &'a [Value],
    pub profile: &'a Value,
    pub decision: Option<&'a Value>,
    pub assessment_shifts: &'a [Value],
    pub settings: &'a WorkPatternSettings,
}
fn string<'a>(v: &'a Value, key: &str) -> Result<&'a str, MonthPayError> {
    v.get(key)
        .and_then(Value::as_str)
        .ok_or(MonthPayError::InvalidInput)
}
fn numeric(v: &Value, key: &str) -> Result<f64, MonthPayError> {
    v.get(key)
        .and_then(Value::as_f64)
        .ok_or(MonthPayError::InvalidInput)
}
fn deleted(v: &Value) -> bool {
    v.get("deletedAt") != Some(&Value::Null)
}
fn selected_family(profile: &Value) -> Option<Family> {
    selected_family_from(|key| profile.get(key))
}
pub(crate) fn selected_family_from<'a>(
    field: impl Fn(&str) -> Option<&'a Value>,
) -> Option<Family> {
    [
        Family::Tval,
        Family::Tvh,
        Family::Tvuk,
        Family::Tvl,
        Family::VkaE,
        Family::Training,
    ]
    .into_iter()
    .find(|f| field(f.field()).is_some_and(|v| !v.is_null() && v != &Value::Bool(false)))
}
/// Same dated window as the legacy calculator, shared with native dependency keys.
pub(crate) fn select_legacy_assessment_shifts<'a>(
    month: &str,
    shifts: &'a [Value],
    package: &crate::rules::RulePackage,
) -> Result<Vec<&'a Value>, MonthPayError> {
    let first = parse_date(&format!("{month}-01"))?;
    let lookback = package.rules()["workPatternPolicy"]["assessmentLookbackMonths"]
        .as_i64()
        .ok_or(MonthPayError::InvalidInput)?;
    let from = first
        .checked_sub(lookback.months())
        .map_err(|_| MonthPayError::InvalidInput)?
        .to_string();
    let until = first.last_of_month().to_string();
    Ok(shifts
        .iter()
        .filter(|s| {
            !deleted(s)
                && s["date"]
                    .as_str()
                    .is_some_and(|d| d >= from.as_str() && d <= until.as_str())
        })
        .collect())
}
fn effective_settings(
    profile: &Value,
    fallback: &WorkPatternSettings,
    date: &str,
) -> Result<WorkPatternSettings, MonthPayError> {
    let value = employment::employment_work_pattern_at(profile, &json!(fallback), date)?;
    WorkPatternSettings::deserialize(&value).map_err(|_| MonthPayError::InvalidInput)
}

pub fn calculate_legacy_assessment(
    input: &MonthPayInput<'_>,
    resolver: &RuleResolver,
) -> Result<Value, MonthPayError> {
    let first = parse_date(&format!("{}-01", input.month))?;
    let date = first.to_string();
    let settings = effective_settings(input.profile, input.settings, &date)?;
    let Some(package) = tariff::get_tariff_rule_package(&date, resolver) else {
        return Ok(json!({"assessment":null,"available":false,"tariffLabel":null}));
    };
    let version =
        tariff::get_tariff_version(&date, resolver)?.ok_or(MonthPayError::InvalidInput)?;
    let relevant: Vec<Value> =
        select_legacy_assessment_shifts(input.month, input.assessment_shifts, package)?
            .into_iter()
            .cloned()
            .collect();
    if input.profile["tariff"]["sector"] == "BT_K" {
        let mut result = pattern::assess_tvoed_k_calendar_month(
            input.month,
            &relevant,
            &settings,
            resolver,
            string(input.profile, "timeZone")?,
            None,
            None,
        )?;
        result["available"] = json!(true);
        result["tariffLabel"] = json!(version.label);
        return Ok(result);
    }
    let has_work = input.shifts.iter().any(|s| {
        !deleted(s)
            && s["date"]
                .as_str()
                .is_some_and(|d| d.starts_with(&format!("{}-", input.month)))
            && pattern::is_pay_work_shift(s)
    });
    let work: Vec<&Value> = if has_work {
        relevant
            .iter()
            .filter(|s| pattern::is_pay_work_shift(s))
            .collect()
    } else {
        vec![]
    };
    let assessment =
        pattern::assess_tvoed_pattern_refs(&work, &settings, resolver, Some(&date), None, None)?;
    Ok(json!({"assessment":assessment,"available":true,"tariffLabel":version.label}))
}

fn calculate_legacy_month(
    input: &MonthPayInput<'_>,
    resolver: &RuleResolver,
    capture: bool,
) -> Result<RegularMonthEvidence, MonthPayError> {
    if input.profile.get("tariff") == Some(&Value::Null)
        && input
            .profile
            .get("manualMonthlyGrossCents")
            .is_some_and(|v| !v.is_null())
    {
        let cents = input.profile["manualMonthlyGrossCents"]
            .as_i64()
            .ok_or(MonthPayError::InvalidInput)?;
        return Ok(without_evidence(
            manual::create_manual_monthly_pay_estimate(input.month, cents)?,
        ));
    }
    let first = format!("{}-01", input.month);
    parse_date(&first)?;
    let package = tariff::get_tariff_rule_package(&first, resolver);
    let version = tariff::get_tariff_version(&first, resolver)?;
    let assessment_result = calculate_legacy_assessment(input, resolver)?;
    let assessment = if assessment_result["assessment"].is_null() {
        pattern::assess_tvoed_pattern(&[], input.settings, resolver, Some(&first), None, None)?
    } else {
        assessment_result["assessment"].clone()
    };
    let confirmed = input
        .decision
        .and_then(|d| d.get("allowanceStatus"))
        .and_then(Value::as_str);
    let tariff = match input.profile.get("tariff") {
        Some(Value::Null) => None,
        Some(v) => Some(TariffProfile::deserialize(v).map_err(|_| MonthPayError::InvalidInput)?),
        None => return Err(MonthPayError::InvalidInput),
    };
    let table = tariff
        .as_ref()
        .map(|t| tariff::get_monthly_table_amount(t, &first, resolver))
        .transpose()?
        .flatten();
    let (Some(version), Some(tariff), Some(package), Some(table)) =
        (version, tariff, package, table)
    else {
        let mut evidence = without_evidence(
            json!({"month":input.month,"tariffLabel":package.and_then(|p|p.label()),"available":false,"fullTimeTableAmount":null,"personalBaseAmount":null,"shiftBreakdowns":[],"timePremiumAmount":0,"overtimeAmount":0,"allowanceAmount":0,"tvoedAllowanceAmount":0,"careAllowanceAmount":0,"estimatedGrossAmount":null,"assessment":assessment,"confirmedAllowance":confirmed}),
        );
        if capture {
            for shift in month_work(input) {
                let id = string(shift, "id")?.to_owned();
                evidence.expected_shift_ids.push(id.clone());
                evidence.missing_trace_shift_ids.push(id);
            }
        }
        return Ok(evidence);
    };
    let mut evidence = without_evidence(Value::Null);
    let mut breakdowns = Vec::new();
    for shift in month_work(input) {
        if capture {
            let id = string(shift, "id")?.to_owned();
            evidence.expected_shift_ids.push(id.clone());
            match super::trace::tariff_payroll_trace(
                shift,
                input.profile,
                &super::trace::TariffPayrollOptions::default(),
                resolver,
            ) {
                Ok(priced) => {
                    breakdowns.push(priced.breakdown.clone());
                    evidence.premium_evidence.push(FamilyPremiumEvidence {
                        shift_id: id,
                        breakdown: priced.breakdown,
                        trace: priced.trace,
                        night_compensatory_minutes: priced.night_compensatory_minutes,
                    });
                    continue;
                }
                // Optional tax evidence must not remove a calculable gross result.
                // The missing identity prevents the provider from claiming complete SFN facts.
                Err(_) => evidence.missing_trace_shift_ids.push(id),
            }
        }
        breakdowns.push(
            serde_json::to_value(legacy::calculate_shift_for_profile(
                shift,
                input.profile,
                resolver,
            )?)
            .map_err(|_| MonthPayError::InvalidInput)?,
        );
    }
    let full_time = tariff::get_tariff_full_time_weekly_minutes(&tariff, &first, resolver)?
        .ok_or(MonthPayError::InvalidInput)?;
    let personal = round_money(table * (numeric(input.profile, "weeklyMinutes")? / full_time));
    let premiums = round_money(
        breakdowns
            .iter()
            .map(|b| {
                b["premiumLines"]
                    .as_array()
                    .map(|lines| {
                        lines
                            .iter()
                            .map(|l| l["amount"].as_f64().unwrap_or(0.0))
                            .sum::<f64>()
                    })
                    .unwrap_or(0.0)
            })
            .sum(),
    );
    let overtime = round_money(breakdowns.iter().fold(0.0, |sum, b| {
        sum + b["overtimeBaseAmount"].as_f64().unwrap_or(0.0)
            + b["overtimePremiumAmount"].as_f64().unwrap_or(0.0)
    }));
    let minutes = breakdowns
        .iter()
        .map(|b| b["netMinutes"].as_f64().unwrap_or(0.0))
        .sum();
    let status = confirmed.or_else(|| assessment["suggestedAllowance"].as_str());
    let allowance = allowances::calculate_monthly_allowance_amounts(&AllowanceCalculationInput {
        date: &first,
        full_time_weekly_minutes: full_time,
        tariff: Some(&tariff),
        weekly_minutes: numeric(input.profile, "weeklyMinutes")?,
        federal_state: string(input.profile, "federalState")?,
        rule_package: package,
        status,
        work_minutes: minutes,
    })?;
    evidence.estimate = json!({"month":input.month,"tariffLabel":version.label,"available":true,"fullTimeTableAmount":table,"personalBaseAmount":personal,"shiftBreakdowns":breakdowns,"timePremiumAmount":premiums,"overtimeAmount":overtime,"allowanceAmount":allowance.allowance_amount,"tvoedAllowanceAmount":allowance.tvoed_allowance_amount,"careAllowanceAmount":allowance.care_allowance_amount,"estimatedGrossAmount":round_money(personal+premiums+overtime+allowance.allowance_amount+allowance.tvoed_allowance_amount+allowance.care_allowance_amount),"assessment":assessment,"confirmedAllowance":confirmed});
    Ok(evidence)
}

fn month_work<'a>(input: &'a MonthPayInput<'a>) -> impl Iterator<Item = &'a Value> {
    let prefix = format!("{}-", input.month);
    input.shifts.iter().filter(move |s| {
        !deleted(s)
            && s["date"].as_str().is_some_and(|d| d.starts_with(&prefix))
            && pattern::is_pay_work_shift(s)
    })
}

fn calculate_uncached(
    input: &MonthPayInput<'_>,
    resolver: &RuleResolver,
    capture: bool,
) -> Result<RegularMonthEvidence, MonthPayError> {
    if let Some(family) = selected_family(input.profile) {
        let request = FamilyMonthInput {
            month: input.month,
            shifts: input.shifts,
            profile: input.profile,
            decision: input.decision,
            assessment_shifts: input.assessment_shifts,
            settings: input.settings,
        };
        return if capture {
            Ok(families::calculate_monthly_pay_with_evidence(
                family, &request, resolver,
            )?)
        } else {
            Ok(without_evidence(families::calculate_monthly_pay(
                family, &request, resolver,
            )?))
        };
    }
    calculate_legacy_month(input, resolver, capture)
}

/// One result is composed from dated periods; fixed components are rounded per
/// equal-cent group as in the source, rather than prorating each day separately.
pub fn calculate_regular_month(
    input: &MonthPayInput<'_>,
    resolver: &RuleResolver,
) -> Result<Value, MonthPayError> {
    calculate_regular_month_impl(input, resolver, false).map(|e| e.estimate)
}

/// Retains tax-premium facts from the same pricing traversal. The estimate has
/// exactly the ordinary public shape; evidence stays in a Rust-only side channel.
pub fn calculate_regular_month_with_evidence(
    input: &MonthPayInput<'_>,
    resolver: &RuleResolver,
) -> Result<RegularMonthEvidence, MonthPayError> {
    calculate_regular_month_impl(input, resolver, true)
}

fn calculate_regular_month_impl(
    input: &MonthPayInput<'_>,
    resolver: &RuleResolver,
    capture: bool,
) -> Result<RegularMonthEvidence, MonthPayError> {
    let range = month_range(input.month)?;
    let first = parse_date(&range.start)?;
    let periods = periods::payroll_employment_periods(input.profile, input.month, &range.end)?;
    let periods = periods.as_array().ok_or(MonthPayError::InvalidInput)?;
    if periods.len() == 1 {
        let profile = &periods[0]["profile"];
        let settings = effective_settings(profile, input.settings, &range.start)?;
        return calculate_uncached(
            &MonthPayInput {
                profile,
                settings: &settings,
                ..*input
            },
            resolver,
            capture,
        );
    }
    if periods.is_empty() {
        return Err(MonthPayError::InvalidInput);
    }
    struct Part {
        estimate: Value,
        fixed: Value,
        days: i64,
    }
    let mut evidence = without_evidence(Value::Null);
    let next = first
        .checked_add(1.months())
        .map_err(|_| MonthPayError::InvalidInput)?
        .to_string();
    let mut parts = Vec::new();
    for period in periods {
        let from = string(period, "from")?;
        let until = period["until"].as_str().unwrap_or(&next);
        let mut profile = period["profile"].clone();
        profile
            .as_object_mut()
            .ok_or(MonthPayError::InvalidInput)?
            .remove("employmentTimeline");
        let days = parse_date(until)?
            .since(parse_date(from)?)
            .map_err(|_| MonthPayError::InvalidInput)?
            .get_days();
        let shifts: Vec<Value> = input
            .shifts
            .iter()
            .filter(|s| s["date"].as_str().is_some_and(|d| d >= from && d < until))
            .cloned()
            .collect();
        let settings = effective_settings(&period["profile"], input.settings, from)?;
        let current = MonthPayInput {
            profile: &profile,
            shifts: &shifts,
            settings: &settings,
            ..*input
        };
        let captured = calculate_uncached(&current, resolver, capture)?;
        let fixed = calculate_uncached(
            &MonthPayInput {
                shifts: &[],
                ..current
            },
            resolver,
            false,
        )?;
        evidence.premium_evidence.extend(captured.premium_evidence);
        evidence
            .expected_shift_ids
            .extend(captured.expected_shift_ids);
        evidence
            .missing_trace_shift_ids
            .extend(captured.missing_trace_shift_ids);
        parts.push(Part {
            estimate: captured.estimate,
            fixed: fixed.estimate,
            days: i64::from(days),
        });
    }
    let available = parts
        .iter()
        .all(|p| p.estimate["available"] == true && p.fixed["available"] == true);
    let fixed_amount = |key: &str| {
        let mut groups: Vec<(i64, i64)> = vec![];
        let mut variable = 0.0;
        for p in &parts {
            let cents = ((p.fixed[key].as_f64().unwrap_or(0.0) * 100.0) + 0.5).floor() as i64;
            if let Some(group) = groups.iter_mut().find(|g| g.0 == cents) {
                group.1 += p.days;
            } else {
                groups.push((cents, p.days));
            }
            if key != "personalBaseAmount" {
                variable +=
                    p.estimate[key].as_f64().unwrap_or(0.0) - p.fixed[key].as_f64().unwrap_or(0.0);
            }
        }
        round_money(groups.iter().fold(variable, |sum, (cents, days)| {
            sum + ((*cents as f64 * *days as f64 / f64::from(first.days_in_month())) + 0.5).floor()
                / 100.0
        }))
    };
    let personal = available.then(|| fixed_amount("personalBaseAmount"));
    let allowance = fixed_amount("allowanceAmount");
    let tvoed = fixed_amount("tvoedAllowanceAmount");
    let care = fixed_amount("careAllowanceAmount");
    let premiums = round_money(
        parts
            .iter()
            .map(|p| p.estimate["timePremiumAmount"].as_f64().unwrap_or(0.0))
            .sum(),
    );
    let overtime = round_money(
        parts
            .iter()
            .map(|p| p.estimate["overtimeAmount"].as_f64().unwrap_or(0.0))
            .sum(),
    );
    let mut result = parts[0].estimate.clone();
    let mut labels = Vec::new();
    let mut breakdowns = Vec::new();
    for p in &parts {
        if let Some(label) = p.estimate["tariffLabel"].as_str().filter(|l| !l.is_empty())
            && !labels.contains(&label)
        {
            labels.push(label);
        }
        if let Some(rows) = p.estimate["shiftBreakdowns"].as_array() {
            breakdowns.extend(rows.iter().cloned());
        }
    }
    let object = result.as_object_mut().ok_or(MonthPayError::InvalidInput)?;
    for (key, value) in [
        ("available", json!(available)),
        ("fullTimeTableAmount", Value::Null),
        ("personalBaseAmount", json!(personal)),
        ("tariffLabel", json!(labels.join(" / "))),
        ("shiftBreakdowns", json!(breakdowns)),
        ("timePremiumAmount", json!(premiums)),
        ("overtimeAmount", json!(overtime)),
        ("allowanceAmount", json!(allowance)),
        ("tvoedAllowanceAmount", json!(tvoed)),
        ("careAllowanceAmount", json!(care)),
        (
            "estimatedGrossAmount",
            json!(
                personal
                    .map(|base| round_money(base + premiums + overtime + allowance + tvoed + care))
            ),
        ),
    ] {
        object.insert(key.to_owned(), value);
    }
    evidence.estimate = result;
    Ok(evidence)
}
