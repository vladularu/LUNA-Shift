//! Source-owned four-week planning evidence, distinct from legal rest limits.
use super::model::ComplianceError;
use super::profile::ComplianceProfile;
use serde_json::Value;
mod assessment;
mod evidence;
pub fn check_planning_weekends(
    month: &str,
    shifts: &[Value],
    time_zone: &str,
    options: &Value,
) -> Result<Value, ComplianceError> {
    assessment::check(
        month,
        shifts,
        time_zone,
        options,
        None,
        options
            .get("employmentProfile")
            .map(ComplianceProfile::from_raw),
    )
}
/// Native monthly orchestration supplies its loaded horizon without copying
/// the immutable employment profile (including large saved target contexts).
pub fn check_planning_weekends_with_coverage(
    month: &str,
    shifts: &[Value],
    time_zone: &str,
    options: &Value,
    coverage_start: &str,
    coverage_end: &str,
) -> Result<Value, ComplianceError> {
    assessment::check(
        month,
        shifts,
        time_zone,
        options,
        Some((coverage_start, coverage_end)),
        options
            .get("employmentProfile")
            .map(ComplianceProfile::from_raw),
    )
}
pub(super) fn check_planning_weekends_for_profile(
    month: &str,
    shifts: &[Value],
    time_zone: &str,
    options: &Value,
    coverage: Option<(&str, &str)>,
    profile: Option<ComplianceProfile<'_>>,
) -> Result<Value, ComplianceError> {
    assessment::check(month, shifts, time_zone, options, coverage, profile)
}
