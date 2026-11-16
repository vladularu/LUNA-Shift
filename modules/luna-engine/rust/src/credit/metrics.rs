//! Pure calendar progress, hours series and shift distributions.
use super::{
    context::DailyCreditContextCache,
    duty::project_duty_calendar_days,
    string,
    summary::{MetricsError, decimal_minutes, truthy},
};
use crate::{
    EngineError,
    calendar::{parse_date, recurrence::CollationRanks},
    rules::RuleResolver,
};
use jiff::ToSpan;
use serde_json::{Value, json};

pub fn daily_summary(
    date: &str,
    entries: &[Value],
    profile: &Value,
    resolver: &RuleResolver,
    collation: &CollationRanks,
) -> Result<Value, MetricsError> {
    let mut cache = DailyCreditContextCache::new(profile, resolver);
    daily_summary_prepared(date, entries, &mut cache, collation)
}

pub fn daily_summary_prepared(
    date: &str,
    entries: &[Value],
    cache: &mut DailyCreditContextCache<'_>,
    collation: &CollationRanks,
) -> Result<Value, MetricsError> {
    let shifts: Vec<Value> = entries
        .iter()
        .filter(|entry| entry["kind"] == "SHIFT")
        .cloned()
        .collect();
    daily_with_cache(date, &shifts, collation, cache, &mut None)
}
fn daily_with_cache(
    date: &str,
    entries: &[Value],
    collation: &CollationRanks,
    cache: &mut DailyCreditContextCache<'_>,
    status: &mut Option<Value>,
) -> Result<Value, MetricsError> {
    let daily = cache.calculate(date, entries, collation)?.summary;
    let mut result = json!({"date":date,"targetMinutes":decimal_minutes(&daily.target_minutes)?,"actualMinutes":decimal_minutes(&daily.actual_minutes)?,"balanceMinutes":decimal_minutes(&daily.balance_minutes)?});
    if truthy(cache.profile().get("workingTimeTarget")) {
        if status.is_none() {
            let target = cache.base_monthly_target(&date[..7], None)?;
            *status = Some(
                serde_json::to_value(target.status)
                    .map_err(|_| EngineError::InvalidCalendarEntry)?,
            );
        }
        result
            .as_object_mut()
            .ok_or(EngineError::InvalidCalendarEntry)?
            .insert(
                "targetStatus".into(),
                status
                    .as_ref()
                    .ok_or(EngineError::InvalidCalendarEntry)?
                    .clone(),
            );
    }
    Ok(result)
}
pub fn monthly_hours_series(
    month: &str,
    entries: &[Value],
    profile: &Value,
    resolver: &RuleResolver,
    collation: &CollationRanks,
) -> Result<Value, MetricsError> {
    let mut cache = DailyCreditContextCache::new(profile, resolver);
    monthly_hours_series_prepared(month, entries, &mut cache, collation)
}

pub fn monthly_hours_series_prepared(
    month: &str,
    entries: &[Value],
    cache: &mut DailyCreditContextCache<'_>,
    collation: &CollationRanks,
) -> Result<Value, MetricsError> {
    let range = crate::calendar::month_range(month)?;
    let first = parse_date(&range.start)?;
    let shifts: Vec<Value> = entries
        .iter()
        .filter(|entry| entry["kind"] == "SHIFT")
        .cloned()
        .collect();
    // Projection and grouping happen once for the whole series.
    let projected = project_duty_calendar_days(&shifts)?;
    let mut dates = std::collections::BTreeMap::<String, Vec<Value>>::new();
    for entry in projected {
        dates
            .entry(string(&entry, "date")?.to_owned())
            .or_default()
            .push(entry);
    }
    let mut status = None;
    let mut result = Vec::new();
    for day in 1..=first.days_in_month() {
        let date = first
            .checked_add(i32::from(day - 1).days())
            .map_err(|_| EngineError::InvalidDate)?
            .to_string();
        let shifts = dates.get(&date).map(Vec::as_slice).unwrap_or(&[]);
        let mut point = daily_with_cache(&date, shifts, collation, cache, &mut status)?;
        point
            .as_object_mut()
            .ok_or(EngineError::InvalidCalendarEntry)?
            .insert("day".into(), json!(day));
        result.push(point);
    }
    Ok(Value::Array(result))
}
pub fn month_progress(actual: f64, target: f64) -> Result<Value, MetricsError> {
    if !actual.is_finite() || !target.is_finite() {
        return Err(EngineError::InvalidDuration.into());
    }
    let percent = if target <= 0.0 {
        0.0
    } else {
        let value = (actual / target) * 100.0;
        let floor = value.floor();
        (if value - floor >= 0.5 {
            floor + 1.0
        } else {
            floor
        })
        .max(0.0)
    };
    if !percent.is_finite() {
        return Err(EngineError::Overflow.into());
    }
    Ok(json!({"displayPercent":percent,"fillPercent":percent.min(100.0)}))
}
fn distribution(month: &str, entries: &[&Value]) -> Result<Vec<(String, usize)>, MetricsError> {
    let mut result: Vec<(String, usize)> = Vec::new();
    let prefix = format!("{month}-");
    for entry in entries {
        if entry["kind"] != "SHIFT"
            || !entry.get("deletedAt").is_some_and(Value::is_null)
            || !string(entry, "date")?.starts_with(&prefix)
        {
            continue;
        }
        let kind = string(entry, "type")?;
        if let Some((_, count)) = result.iter_mut().find(|(key, _)| key == kind) {
            *count += 1;
        } else {
            result.push((kind.to_owned(), 1));
        }
    }
    Ok(result)
}
/// Canonical Map representation used by frozen-reference comparisons.
pub fn shift_type_distribution(month: &str, entries: &[Value]) -> Result<Value, MetricsError> {
    let mut entries = distribution(month, &entries.iter().collect::<Vec<_>>())?;
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(json!({"$type":"Map","entries":entries}))
}
/// Preserves the source Map's first-seen order at the native host boundary.
pub fn shift_type_distribution_entries(
    month: &str,
    entries: &[Value],
) -> Result<Value, MetricsError> {
    shift_type_distribution_entries_refs(month, &entries.iter().collect::<Vec<_>>())
}
pub fn shift_type_distribution_entries_refs(
    month: &str,
    entries: &[&Value],
) -> Result<Value, MetricsError> {
    Ok(json!(distribution(month, entries)?))
}
pub fn clamp_date_to_month(date: &str, month: &str) -> Result<String, MetricsError> {
    let source = parse_date(date)?;
    let range = crate::calendar::month_range(month)?;
    let first = parse_date(&range.start)?;
    first
        .with()
        .day(source.day().min(first.days_in_month()))
        .build()
        .map(|date| date.to_string())
        .map_err(|_| EngineError::InvalidDate.into())
}
