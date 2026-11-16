//! Monthly work-credit and contractual target summaries.
use super::{
    context::{DailyCreditContextCache, DailyCreditError},
    prepared::PreparedCreditEntries,
    string,
};
use crate::{
    EngineError,
    calendar::recurrence::CollationRanks,
    pay::special::SpecialDutyError,
    rules::RuleResolver,
    target::{PreparedTargetContext, PreparedTargetProfile, TargetContext, TargetError},
};
use bigdecimal::BigDecimal;
use serde_json::{Value, json};
use std::{collections::BTreeSet, fmt};

#[derive(Debug)]
pub enum MetricsError {
    Calculation(EngineError),
    Daily(DailyCreditError),
    Target(TargetError),
    Special(SpecialDutyError),
}
impl fmt::Display for MetricsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Calculation(e) => fmt::Display::fmt(e, f),
            Self::Daily(e) => fmt::Display::fmt(e, f),
            Self::Target(e) => fmt::Display::fmt(e, f),
            Self::Special(e) => fmt::Display::fmt(e, f),
        }
    }
}
impl std::error::Error for MetricsError {}
impl From<EngineError> for MetricsError {
    fn from(e: EngineError) -> Self {
        Self::Calculation(e)
    }
}
impl From<DailyCreditError> for MetricsError {
    fn from(e: DailyCreditError) -> Self {
        Self::Daily(e)
    }
}
impl From<TargetError> for MetricsError {
    fn from(e: TargetError) -> Self {
        Self::Target(e)
    }
}
impl From<SpecialDutyError> for MetricsError {
    fn from(e: SpecialDutyError) -> Self {
        Self::Special(e)
    }
}
impl MetricsError {
    pub fn source_error_name(&self) -> &'static str {
        match self {
            Self::Target(_) | Self::Daily(DailyCreditError::Target(_)) => "WorkingTimeTargetError",
            _ => "Error",
        }
    }
}
pub(crate) fn decimal_minutes(value: &BigDecimal) -> Result<f64, MetricsError> {
    let value = value
        .to_string()
        .parse::<f64>()
        .map_err(|_| EngineError::Overflow)?;
    if !value.is_finite() {
        return Err(EngineError::Overflow.into());
    }
    Ok(value)
}
pub(crate) fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(v)) => *v,
        Some(Value::Number(v)) => v.as_f64().is_some_and(|v| v != 0.0),
        Some(Value::String(v)) => !v.is_empty(),
        Some(Value::Array(_) | Value::Object(_)) => true,
    }
}
#[derive(Default)]
struct Category {
    minutes: f64,
    entry_count: usize,
}
impl Category {
    fn json(&self) -> Value {
        json!({"minutes":self.minutes,"entryCount":self.entry_count})
    }
}

pub fn calculate_monthly_summary(
    month: &str,
    entries: &[Value],
    profile: &Value,
    resolver: &RuleResolver,
    context: Option<&TargetContext>,
    collation: &CollationRanks,
) -> Result<Value, MetricsError> {
    let pay = crate::pay::special::calculate_special_duty_pay(month, entries, profile, resolver)?;
    calculate_monthly_summary_with_pay(month, entries, profile, resolver, context, collation, &pay)
}

/// Internal composition only: `pay_lines` must be the native result for these
/// same raw facts. The app snapshot accepts no precomputed financial results.
pub fn calculate_monthly_summary_with_pay(
    month: &str,
    entries: &[Value],
    profile: &Value,
    resolver: &RuleResolver,
    context: Option<&TargetContext>,
    collation: &CollationRanks,
    pay_lines: &[Value],
) -> Result<Value, MetricsError> {
    let mut cache = DailyCreditContextCache::new(profile, resolver);
    monthly_summary_with_cache(
        month,
        entries,
        &mut cache,
        SummaryContext::Borrowed(context),
        collation,
        pay_lines,
    )
}

/// Uses the same source-bound target preparation and monthly results as the
/// surrounding daily, hours and annual reports.
pub fn calculate_monthly_summary_prepared(
    month: &str,
    entries: &[Value],
    cache: &mut DailyCreditContextCache<'_>,
    context: Option<&PreparedTargetContext>,
    collation: &CollationRanks,
) -> Result<Value, MetricsError> {
    let pay = crate::pay::special::calculate_special_duty_pay(
        month,
        entries,
        cache.profile(),
        cache.resolver(),
    )?;
    calculate_monthly_summary_prepared_with_pay(month, entries, cache, context, collation, &pay)
}

/// Native composition only: cash and time-account evidence must originate from
/// the same raw source and pricing pass; no host-supplied amounts are accepted.
pub fn calculate_monthly_summary_prepared_with_pay(
    month: &str,
    entries: &[Value],
    cache: &mut DailyCreditContextCache<'_>,
    context: Option<&PreparedTargetContext>,
    collation: &CollationRanks,
    pay_lines: &[Value],
) -> Result<Value, MetricsError> {
    monthly_summary_with_cache(
        month,
        entries,
        cache,
        SummaryContext::Prepared(context),
        collation,
        pay_lines,
    )
}

enum SummaryContext<'a> {
    Borrowed(Option<&'a TargetContext>),
    Prepared(Option<&'a PreparedTargetContext>),
    Basis(MonthlySummaryBasis<'a>),
}
/// Opaque native basis from the same immutable target source. Not a wire DTO.
pub struct MonthlySummaryBasis<'a> {
    pub profile: &'a PreparedTargetProfile,
    pub context: Option<&'a PreparedTargetContext>,
}
pub fn calculate_monthly_summary_prepared_with_basis(
    month: &str,
    entries: &[Value],
    cache: &mut DailyCreditContextCache<'_>,
    basis: MonthlySummaryBasis<'_>,
    collation: &CollationRanks,
    pay_lines: &[Value],
) -> Result<Value, MetricsError> {
    monthly_summary_with_cache(
        month,
        entries,
        cache,
        SummaryContext::Basis(basis),
        collation,
        pay_lines,
    )
}
pub fn calculate_monthly_summary_refs_prepared_with_basis(
    month: &str,
    entries: &[&Value],
    cache: &mut DailyCreditContextCache<'_>,
    basis: MonthlySummaryBasis<'_>,
    collation: &CollationRanks,
    pay_lines: &[Value],
) -> Result<Value, MetricsError> {
    monthly_summary_with_refs(
        month,
        entries,
        cache,
        SummaryContext::Basis(basis),
        collation,
        pay_lines,
    )
}
impl SummaryContext<'_> {
    fn is_some(&self) -> bool {
        match self {
            Self::Borrowed(context) => context.is_some(),
            Self::Prepared(context) => context.is_some(),
            Self::Basis(basis) => basis.context.is_some(),
        }
    }
    fn has_input(&self, profile: &Value) -> bool {
        match self {
            Self::Basis(basis) => basis.profile.profile().working_time_target.is_some(),
            _ => truthy(profile.get("workingTimeTarget")),
        }
    }
}

fn monthly_summary_with_cache(
    month: &str,
    entries: &[Value],
    cache: &mut DailyCreditContextCache<'_>,
    context: SummaryContext<'_>,
    collation: &CollationRanks,
    pay_lines: &[Value],
) -> Result<Value, MetricsError> {
    monthly_summary_with_refs(
        month,
        &entries.iter().collect::<Vec<_>>(),
        cache,
        context,
        collation,
        pay_lines,
    )
}
fn monthly_summary_with_refs(
    month: &str,
    entries: &[&Value],
    cache: &mut DailyCreditContextCache<'_>,
    context: SummaryContext<'_>,
    collation: &CollationRanks,
    pay_lines: &[Value],
) -> Result<Value, MetricsError> {
    let profile = cache.profile();
    let account = crate::pay::special::time_account::special_duty_time_account_with_pay_refs(
        month, entries, profile, pay_lines,
    )?;
    let projected = PreparedCreditEntries::from_refs(entries.to_vec())?;
    let mut work = Category::default();
    let mut training = Category::default();
    let mut vacation = Category::default();
    let mut sick = Category::default();
    let mut free = Category::default();
    let mut dates: Vec<(String, Vec<&Value>)> = Vec::new();
    let mut counted = BTreeSet::new();
    let prefix = format!("{month}-");
    for entry in projected.entries() {
        let date = string(entry, "date")?;
        if !date.starts_with(&prefix) || !entry.get("deletedAt").is_some_and(Value::is_null) {
            continue;
        }
        if let Some((_, entries)) = dates.iter_mut().find(|(key, _)| key == date) {
            entries.push(entry);
        } else {
            dates.push((date.to_owned(), vec![entry]));
        }
        if !counted.insert(string(entry, "id")?.to_owned()) {
            continue;
        }
        match string(entry, "type")? {
            "FREE" => free.entry_count += 1,
            "VACATION" => vacation.entry_count += 1,
            "SICK" => sick.entry_count += 1,
            "TRAINING" => training.entry_count += 1,
            _ => work.entry_count += 1,
        }
    }
    let mut overlap_minutes = 0.0;
    let mut ordinary_minutes = 0.0;
    for (date, entries) in dates {
        let prepared = PreparedCreditEntries::from_refs(entries.clone())?;
        let day = cache.summary_prepared(&date, &prepared, collation)?;
        work.minutes += decimal_minutes(&day.timed.work_minutes)?;
        training.minutes += decimal_minutes(&day.timed.training_minutes)?;
        vacation.minutes += decimal_minutes(&day.vacation_minutes)?;
        sick.minutes += decimal_minutes(&day.sick_minutes)?;
        overlap_minutes += decimal_minutes(&day.timed.overlap_minutes)?;
        ordinary_minutes += if entries.iter().any(|entry| {
            entry["id"]
                .as_str()
                .is_some_and(|id| account.ids.contains(id))
        }) {
            let ordinary: Vec<&Value> = entries
                .into_iter()
                .filter(|entry| {
                    !entry["id"]
                        .as_str()
                        .is_some_and(|id| account.ids.contains(id))
                })
                .collect();
            let ordinary = PreparedCreditEntries::from_refs(ordinary)?;
            decimal_minutes(
                &cache
                    .summary_prepared(&date, &ordinary, collation)?
                    .actual_minutes,
            )?
        } else {
            decimal_minutes(&day.actual_minutes)?
        };
    }
    let actual_minutes = work.minutes + training.minutes + vacation.minutes + sick.minutes;
    let target = match &context {
        SummaryContext::Borrowed(value) => cache.base_monthly_target_borrowed(month, *value)?,
        SummaryContext::Prepared(value) => cache.base_monthly_target(month, *value)?,
        SummaryContext::Basis(basis) => {
            cache.monthly_target_with_basis(month, basis.profile, basis.context)?
        }
    };
    let target_minutes = crate::target::require_target_minutes(&target)?;
    let time_account_minutes = account
        .credited_minutes
        .map(|minutes| ordinary_minutes + minutes);
    let mut result = json!({"month":month,"targetMinutes":target_minutes,"actualMinutes":actual_minutes,"balanceMinutes":time_account_minutes.unwrap_or(actual_minutes)-target_minutes as f64,"overlapMinutes":overlap_minutes,"work":work.json(),"training":training.json(),"vacation":vacation.json(),"sick":sick.json(),"free":free.json()});
    let out = result
        .as_object_mut()
        .ok_or(EngineError::InvalidCalendarEntry)?;
    if !account.notes.is_empty() {
        out.insert("specialDutyNotes".into(), json!(account.notes));
    }
    if !account.lines.is_empty() {
        out.insert("timeAccountMinutes".into(), json!(time_account_minutes));
        out.insert("specialDutyTimeCredits".into(), json!(account.lines));
    }
    if context.is_some() || context.has_input(profile) {
        out.insert(
            "targetCalculation".into(),
            serde_json::to_value(target.as_ref()).map_err(|_| EngineError::InvalidCalendarEntry)?,
        );
    }
    Ok(result)
}
