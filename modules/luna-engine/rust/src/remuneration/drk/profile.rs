//! Dated raw remuneration/training facts select DRK candidate tables without a salary fallback.
use super::base::{
    calculate_employee_table_base, calculate_training_table_base, category, month_bounds,
    unavailable,
};
use crate::{
    employment::{ResolutionStatus, resolve_remuneration_profile_ref},
    remuneration::{
        context::model::{ContextError, NativePackageValidator},
        profile::{Selection, validate_profile},
    },
    rules::RuleResolver,
    training,
};
use serde_json::{Value, json};
use std::collections::BTreeSet;
fn payload(confirmations: &Value) -> Value {
    let mut result = json!({});
    for field in [
        "drkApplicabilityConfirmed",
        "annexAssignmentConfirmed",
        "payGroupAndStepConfirmed",
        "weeklyTimeBasisConfirmed",
        "fullMonthBaseEntitlementConfirmed",
        "trainingCategoryConfirmed",
        "trainingYearConfirmed",
        "fullTimeTrainingConfirmed",
    ] {
        if let Some(value) = confirmations.get(field) {
            result[field] = value.clone();
        }
    }
    result
}
pub fn calculate_employee_from_profile(
    month: &str,
    profiles: &[Value],
    resolver: &RuleResolver,
    confirmations: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, ContextError> {
    let Some(bounds) = month_bounds(month) else {
        return Ok(unavailable("INVALID_MONTH"));
    };
    let (Ok(start), Ok(end)) = (
        resolve_remuneration_profile_ref(profiles, &bounds.start),
        resolve_remuneration_profile_ref(profiles, &bounds.end),
    ) else {
        return Ok(unavailable("PROFILE_INVALID"));
    };
    if start.status != ResolutionStatus::Dated || end.status != ResolutionStatus::Dated {
        return Ok(unavailable("PROFILE_MISSING_OR_UNDATED"));
    }
    let start = start.profile.expect("dated profile");
    let end = end.profile.expect("dated profile");
    if !std::ptr::eq(start, end) {
        return Ok(unavailable("PROFILE_CHANGES_IN_MONTH"));
    }
    let Ok(data) = validate_profile(&start["data"]) else {
        return Ok(unavailable("PROFILE_INVALID"));
    };
    let Selection::Tariff(selection) = data.selection() else {
        return Ok(unavailable("NOT_DRK_EMPLOYEE_PROFILE"));
    };
    if !matches!(
        selection.package_id.as_str(),
        "drk-rtv-e" | "drk-rtv-p" | "drk-rtv-s"
    ) {
        return Ok(unavailable("NOT_DRK_EMPLOYEE_PROFILE"));
    }
    if selection.region != "BTG" {
        return Ok(unavailable("PROFILE_REGION_MISMATCH"));
    }
    let (Ok(from), Ok(to)) = (
        resolver.resolve_tariff(&bounds.start, Some(&selection.package_id)),
        resolver.resolve_tariff(&bounds.end, Some(&selection.package_id)),
    ) else {
        return Ok(unavailable("RULE_PACKAGE_UNAVAILABLE"));
    };
    if !std::ptr::eq(from, to) {
        return Ok(unavailable("RULE_VERSION_CHANGES_IN_MONTH"));
    }
    let mut input = payload(confirmations);
    input["month"] = json!(month);
    input["variantId"] = json!(selection.variant);
    input["groupId"] = json!(selection.group);
    input["stepId"] = json!(format!("s{}", selection.level));
    input["contractedWeeklyMinutes"] = json!(data.weekly_minutes());
    input["fullTimeWeeklyMinutes"] = json!(selection.full_time_weekly_minutes);
    calculate_employee_table_base(from, &input, validator)
}
pub fn calculate_training_from_profile(
    month: &str,
    profiles: &[Value],
    training_profiles: &[Value],
    resolver: &RuleResolver,
    confirmations: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, ContextError> {
    let Some(bounds) = month_bounds(month) else {
        return Ok(unavailable("INVALID_MONTH"));
    };
    let (Ok(start), Ok(end)) = (
        resolve_remuneration_profile_ref(profiles, &bounds.start),
        resolve_remuneration_profile_ref(profiles, &bounds.end),
    ) else {
        return Ok(unavailable("PROFILE_INVALID"));
    };
    if start.status != ResolutionStatus::Dated || end.status != ResolutionStatus::Dated {
        return Ok(unavailable("PROFILE_MISSING_OR_UNDATED"));
    }
    let start = start.profile.expect("dated profile");
    let end = end.profile.expect("dated profile");
    if !std::ptr::eq(start, end) {
        return Ok(unavailable("PROFILE_CHANGES_IN_MONTH"));
    }
    let Ok(data) = validate_profile(&start["data"]) else {
        return Ok(unavailable("PROFILE_INVALID"));
    };
    let Selection::Tariff(selection) = data.selection() else {
        return Ok(unavailable("NOT_DRK_TRAINING_PROFILE"));
    };
    if selection.package_id != "drk-rtv-training" {
        return Ok(unavailable("NOT_DRK_TRAINING_PROFILE"));
    }
    if selection.region != "BTG" {
        return Ok(unavailable("PROFILE_REGION_MISMATCH"));
    }
    let mut dates = BTreeSet::new();
    for profile in training_profiles {
        if !dates.insert(profile["data"]["effectiveFrom"].to_string()) {
            return Ok(unavailable("TRAINING_PROFILE_INVALID"));
        }
    }
    let (Ok(training_start), Ok(training_end)) = (
        training::training_profile_for_date(training_profiles, &bounds.start),
        training::training_profile_for_date(training_profiles, &bounds.end),
    ) else {
        return Ok(unavailable("TRAINING_PROFILE_INVALID"));
    };
    let (Some(training_start), Some(training_end)) = (training_start, training_end) else {
        return Ok(unavailable("TRAINING_PROFILE_MISSING"));
    };
    if training_start["data"]["effectiveFrom"] != training_end["data"]["effectiveFrom"] {
        return Ok(unavailable("TRAINING_PROFILE_CHANGES_IN_MONTH"));
    }
    let Ok(training) = training::validate_training_profile(&training_start["data"]) else {
        return Ok(unavailable("TRAINING_PROFILE_INVALID"));
    };
    if training["status"] != "training" || training["training"].is_null() {
        return Ok(unavailable("TRAINING_STATUS_MISSING"));
    }
    let training = &training["training"];
    if training["startedOn"].as_str() > Some(bounds.start.as_str())
        || (!training["expectedEndOn"].is_null()
            && training["expectedEndOn"].as_str() < Some(bounds.end.as_str()))
    {
        return Ok(unavailable("TRAINING_NOT_FULL_MONTH"));
    }
    if training["legalBasis"] == "UNKNOWN" {
        return Ok(unavailable("TRAINING_LEGAL_BASIS_UNKNOWN"));
    }
    // The shared validator bounds years to 1..=6. Preserve String(year),
    // including rejecting profile levels such as "01", without allocating.
    let year_level = match training["year"].as_i64() {
        Some(1) => Some("1"),
        Some(2) => Some("2"),
        Some(3) => Some("3"),
        Some(4) => Some("4"),
        Some(5) => Some("5"),
        Some(6) => Some("6"),
        _ => None,
    };
    if training["year"].is_null()
        || training["yearConfirmedFrom"].is_null()
        || training["yearConfirmedFrom"].as_str() > Some(bounds.start.as_str())
        || Some(selection.level.as_str()) != year_level
    {
        return Ok(unavailable("TRAINING_YEAR_CONFLICT"));
    }
    if category(&selection.variant) != Some(selection.group.to_lowercase().as_str())
        || selection.variant == "ANLAGE_3" && training["legalBasis"] == "PFLBG"
    {
        return Ok(unavailable("TRAINING_CATEGORY_CONFLICT"));
    }
    if data.weekly_minutes() != selection.full_time_weekly_minutes {
        return Ok(unavailable("NON_FULL_TIME_SEPARATE_CALCULATION"));
    }
    let (Ok(from), Ok(to)) = (
        resolver.resolve_tariff(&bounds.start, Some(&selection.package_id)),
        resolver.resolve_tariff(&bounds.end, Some(&selection.package_id)),
    ) else {
        return Ok(unavailable("RULE_PACKAGE_UNAVAILABLE"));
    };
    if !std::ptr::eq(from, to) {
        return Ok(unavailable("RULE_VERSION_CHANGES_IN_MONTH"));
    }
    let mut input = payload(confirmations);
    input["month"] = json!(month);
    input["variantId"] = json!(selection.variant);
    input["trainingYear"] = training["year"].clone();
    calculate_training_table_base(from, &input, validator)
}
