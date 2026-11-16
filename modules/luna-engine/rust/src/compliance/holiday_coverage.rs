//! Dated state/region selection preserves partial holiday coverage and source order.
use super::{model::ComplianceError, profile::ComplianceProfile};
use crate::rules::{
    RuleResolver,
    holidays::{HolidayError, holiday_calendar},
};
use serde_json::Value;
use std::collections::BTreeSet;
pub(super) struct HolidayCoverage {
    pub dates: BTreeSet<String>,
    pub missing_years: BTreeSet<i16>,
}
pub(super) fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|v| v != 0.0),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}
pub(super) fn known_holidays(
    years: &BTreeSet<i16>,
    state: &str,
    region: &str,
    resolver: &RuleResolver,
    profile: Option<ComplianceProfile<'_>>,
) -> Result<HolidayCoverage, ComplianceError> {
    let base_state = Value::String(state.into());
    let base_region = Value::String(region.into());
    let mut contexts = vec![(Some(&base_state), Some(&base_region))];
    if let Some(profile) = profile
        && let Some(history) = profile.get("employmentTimeline").and_then(Value::as_array)
    {
        for row in history {
            if let Some(e) = row.get("employment").filter(|v| truthy(v)) {
                // An original partial history row is a separate holiday context.
                // Keep missing/null distinct for JS strict field equality; only
                // the calendar's optional region argument receives its default.
                contexts.push((e.get("federalState"), e.get("holidayRegion")));
            }
        }
    }
    let mut out = HolidayCoverage {
        dates: BTreeSet::new(),
        missing_years: BTreeSet::new(),
    };
    for year in years {
        for (source_state, source_region) in &contexts {
            let state = source_state.and_then(Value::as_str).unwrap_or("");
            let region = source_region.and_then(Value::as_str).unwrap_or("NONE");
            let calendar = match holiday_calendar(i32::from(*year), state, region, resolver) {
                Ok(c) => c,
                Err(HolidayError::Resolution(_)) => {
                    out.missing_years.insert(*year);
                    break;
                }
                Err(e) => return Err(e.into()),
            };
            for holiday in calendar.entries() {
                let matches = if let Some(profile) = profile {
                    let fields = profile.fields_at(&holiday.date)?;
                    let field = |key: &str| fields.get(key);
                    field("federalState") == *source_state
                        && field("holidayRegion") == *source_region
                } else {
                    true
                };
                if matches {
                    out.dates.insert(holiday.date.clone());
                }
            }
        }
    }
    Ok(out)
}
