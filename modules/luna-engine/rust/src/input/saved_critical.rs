//! Native post-save notice selection, using the full native monthly compliance kernel.
use crate::{
    calendar::recurrence::CollationRanks,
    compliance::{
        dated::{self, PreparedDatedComplianceSource},
        model::ComplianceError,
        profile::ComplianceProfile,
    },
    rules::RuleResolver,
};
use serde_json::Value;
use std::sync::Arc;
pub fn critical_issue(
    saved: &Value,
    entries: &[Value],
    profile: &Value,
    clock_date: &str,
    ranks: CollationRanks,
    resolver: &RuleResolver,
) -> Result<Value, ComplianceError> {
    let id = saved["id"].as_str().ok_or(ComplianceError::InvalidInput)?;
    let month = saved["date"]
        .as_str()
        .and_then(|v| v.get(..7))
        .ok_or(ComplianceError::InvalidInput)?;
    let time_zone = profile["timeZone"]
        .as_str()
        .ok_or(ComplianceError::InvalidInput)?;
    let shifts: Vec<Value> = entries
        .iter()
        .filter(|e| e["kind"] == "SHIFT" && e["id"] != id)
        .cloned()
        .chain(std::iter::once(saved.clone()))
        .collect();
    let source = PreparedDatedComplianceSource::new(Arc::from(shifts), ranks);
    let mut options = serde_json::Map::new();
    for key in [
        "allEmploymentWorkRecorded",
        "federalState",
        "holidayRegion",
        "regularRotatingNightWork",
        "sundayHolidayWorkEligible",
        "weeklyMinutes",
    ] {
        if let Some(value) = profile.get(key) {
            options.insert(key.to_owned(), value.clone());
        }
    }
    let assessed = dated::calculate_monthly_compliance_with_basis(
        month,
        &source,
        time_zone,
        &Value::Object(options),
        clock_date,
        resolver,
        ComplianceProfile::from_raw(profile),
    )?;
    let issues = assessed.result()["issues"]
        .as_array()
        .ok_or(ComplianceError::InvalidInput)?;
    Ok(issues
        .iter()
        .find(|issue| {
            issue["severity"] == "critical"
                && issue["relatedShiftIds"]
                    .as_array()
                    .is_some_and(|ids| ids.iter().any(|value| value == id))
        })
        .cloned()
        .unwrap_or(Value::Null))
}
