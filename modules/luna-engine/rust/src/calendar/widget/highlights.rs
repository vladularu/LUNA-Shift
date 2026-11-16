//! Compose the existing native holiday and target kernels. This leaf only
//! returns day labels; no new entitlement or UI/source readiness is inferred.
use crate::{
    EngineError,
    calendar::parse_date,
    credit::{
        context::{DailyCreditContextCache, DailyCreditError},
        summary::MetricsError,
    },
    employment::{employment_month_boundaries, employment_overlay_at},
    rules::holidays::{HolidayError, holiday_calendar},
    target::{AdjustmentKind, TargetError, TargetStatus},
};
use jiff::ToSpan;
use serde_json::Value;
use std::collections::HashMap;
fn set(
    labels: &mut Vec<(String, String)>,
    positions: &mut HashMap<String, usize>,
    date: &str,
    label: &str,
) {
    if let Some(index) = positions.get(date) {
        labels[*index].1 = label.to_owned();
    } else {
        positions.insert(date.to_owned(), labels.len());
        labels.push((date.to_owned(), label.to_owned()));
    }
}
pub fn widget_calendar_highlights(
    start_date: &str,
    end_date: &str,
    cache: &mut DailyCreditContextCache<'_>,
) -> Result<Vec<(String, String)>, MetricsError> {
    let start = parse_date(start_date)?;
    let end = parse_date(end_date)?;
    let mut month = start.first_of_month();
    let mut labels = Vec::new();
    let mut positions = HashMap::new();
    let mut visited = 0usize;
    while month <= end {
        visited += 1;
        if visited > 120 {
            return Err(EngineError::Overflow.into());
        }
        let key = format!("{:04}-{:02}", month.year(), month.month());
        // The original display omits special-day classifications while target input
        // is absent, loading or failed; public holidays are resolved independently.
        let special_ready = cache
            .profile()
            .get("workingTimeTarget")
            .and_then(|i| i.get("status"))
            .and_then(Value::as_str)
            == Some("ready");
        if special_ready
            && let Ok(target) = cache.base_monthly_target(&key, None)
            && target.status != TargetStatus::Unavailable
        {
            for day in &target.adjustments {
                if day.kind == AdjustmentKind::TariffSpecialDay {
                    set(&mut labels, &mut positions, &day.date, &day.label);
                }
            }
        }
        let profile = cache.profile();
        let periods = employment_month_boundaries(profile, &key, &format!("{key}-31"))
            .map_err(DailyCreditError::Employment)?;
        for period in periods {
            let overlay = employment_overlay_at(profile, &period.from)
                .map_err(DailyCreditError::Employment)?;
            let field = |key| {
                overlay
                    .and_then(|p| p.get(key))
                    .or_else(|| profile.get(key))
            };
            let state = field("federalState")
                .and_then(Value::as_str)
                .ok_or(TargetError::InvalidInput)?;
            let region = match field("holidayRegion") {
                None | Some(Value::Null) => "NONE",
                Some(value) => value.as_str().ok_or(TargetError::InvalidInput)?,
            };
            let calendar =
                match holiday_calendar(i32::from(month.year()), state, region, cache.resolver()) {
                    Ok(value) => value,
                    Err(HolidayError::Resolution(_)) => continue,
                    Err(error) => return Err(TargetError::Holiday(error).into()),
                };
            for day in calendar.entries() {
                if day.date.starts_with(&key)
                    && day.date >= period.from
                    && period.until.as_ref().is_none_or(|until| day.date < *until)
                {
                    set(&mut labels, &mut positions, &day.date, &day.name);
                }
            }
        }
        month = month
            .checked_add(1.months())
            .map_err(|_| EngineError::InvalidDate)?;
    }
    crate::report::cache_budget::serialized_bytes(&labels, 16_515_072)
        .ok_or(EngineError::Overflow)?;
    Ok(labels)
}
