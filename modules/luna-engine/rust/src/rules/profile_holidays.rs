//! Statutory holidays filtered by the employment location effective per date.
use super::{
    RuleResolver,
    holidays::{HolidayError, HolidayMonthResolution, resolve_holiday_map_for_month},
};
use crate::employment::{
    EmploymentError, employment_month_boundaries, profile_view::EmploymentProfileRef,
};
use serde_json::Value;
use std::collections::BTreeMap;
#[derive(Debug, Clone)]
pub enum ProfileHolidayError {
    Employment(EmploymentError),
    Holiday(HolidayError),
}
impl std::fmt::Display for ProfileHolidayError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Employment(error) => error.fmt(formatter),
            Self::Holiday(error) => error.fmt(formatter),
        }
    }
}
impl std::error::Error for ProfileHolidayError {}
impl From<EmploymentError> for ProfileHolidayError {
    fn from(error: EmploymentError) -> Self {
        Self::Employment(error)
    }
}
impl From<HolidayError> for ProfileHolidayError {
    fn from(error: HolidayError) -> Self {
        Self::Holiday(error)
    }
}
pub fn resolve_profile_holiday_map_for_month(
    month: &str,
    profile: &Value,
    resolver: &RuleResolver,
) -> Result<HolidayMonthResolution, ProfileHolidayError> {
    let periods = employment_month_boundaries(profile, month, &format!("{month}-31"))?;
    // Original employmentMonthPeriods constructs every effective profile before
    // any holiday lookup. Keep that validation/failure order with borrowed views.
    let effective = periods
        .iter()
        .map(|period| EmploymentProfileRef::at(profile, &period.from))
        .collect::<Result<Vec<_>, _>>()?;
    let mut result = HolidayMonthResolution {
        status: "AVAILABLE",
        holidays: BTreeMap::new(),
        failure: None,
    };
    for (period, profile) in periods.iter().zip(effective) {
        let state = profile
            .get("federalState")
            .and_then(Value::as_str)
            .unwrap_or("");
        let region = profile
            .get("holidayRegion")
            .map_or("NONE", |v| v.as_str().unwrap_or(""));
        let resolution = resolve_holiday_map_for_month(month, state, region, resolver)?;
        for (date, holiday) in resolution.holidays {
            if date >= period.from && period.until.as_ref().is_none_or(|until| date < *until) {
                result.holidays.insert(date, holiday);
            }
        }
        if result.failure.is_none() {
            result.failure = resolution.failure;
        }
    }
    if result.failure.is_some() {
        result.status = "UNAVAILABLE";
    }
    Ok(result)
}
