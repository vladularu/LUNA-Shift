//! Existing monthly checks over the caller's exact loaded entry order.
//! This pure native kernel does not admit wire profiles or select SQL sources.
pub(crate) mod models;
pub(crate) mod profile;
use super::{
    dated::{PreparedDatedComplianceSource, calculate_monthly_compliance_with_basis},
    model::ComplianceError,
    profile::ComplianceProfile,
    selection::PreparedComplianceEntries,
};
use crate::{
    calendar::recurrence::CollationRanks,
    report::computation::Computation,
    rules::{RuleResolver, holidays::HolidayError},
};
use serde_json::{Value, json};
use std::sync::Arc;

fn capture<T>(value: Result<T, ComplianceError>) -> Result<Computation<T>, ComplianceError> {
    match value {
        Ok(value) => Ok(Computation::Ready(value)),
        Err(ComplianceError::Rules(error)) => Ok(Computation::rule(&error)),
        Err(ComplianceError::Holiday(HolidayError::Resolution(error))) => {
            Ok(Computation::rule(&error))
        }
        Err(error) => Err(error),
    }
}

pub fn calculate_monthly_details(
    month: &str,
    entries: Arc<Vec<Value>>,
    native_profile: &Value,
    observed_epoch_milliseconds: i64,
    youth_protection: bool,
    resolver: &RuleResolver,
    collation: Arc<CollationRanks>,
) -> Result<Value, ComplianceError> {
    let zone = native_profile["timeZone"]
        .as_str()
        .ok_or(ComplianceError::InvalidInput)?;
    let reference_date = jiff::Timestamp::from_millisecond(observed_epoch_milliseconds)
        .map_err(|_| ComplianceError::InvalidInput)?
        .to_zoned(crate::time_zone::zone(zone).map_err(|_| ComplianceError::InvalidInput)?)
        .date()
        .to_string();
    let window = capture((|| {
        // The original details route resolves the month's holiday package
        // before selecting its legal/planning window.
        resolver.resolve_holiday(&format!("{month}-01"))?;
        let prepared = PreparedComplianceEntries::from_shared(entries)?;
        prepared
            .select(month, resolver)
            .map(|entries| entries.into_iter().cloned().collect::<Vec<_>>())
    })())?;
    let compliance = if let Some(shifts) = window.value() {
        let source =
            PreparedDatedComplianceSource::with_shared_collation(shifts.clone().into(), collation);
        let mut options = serde_json::Map::new();
        options.insert("referenceDate".into(), json!(reference_date));
        options.insert("youthProtection".into(), json!(youth_protection));
        for key in [
            "federalState",
            "holidayRegion",
            "weeklyMinutes",
            "regularRotatingNightWork",
            "sundayHolidayWorkEligible",
            "allEmploymentWorkRecorded",
        ] {
            if let Some(value) = native_profile.get(key) {
                options.insert(key.into(), value.clone());
            }
        }
        Some(capture(
            calculate_monthly_compliance_with_basis(
                month,
                &source,
                zone,
                &Value::Object(options),
                &reference_date,
                resolver,
                ComplianceProfile::from_raw(native_profile),
            )
            .map(|result| result.into_json()),
        )?)
    } else {
        None
    };
    Ok(json!({"referenceDate":reference_date,"window":window,"compliance":compliance}))
}
