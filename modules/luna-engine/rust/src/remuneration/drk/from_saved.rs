//! Saved answers unlock only source-isolated draft components, after exact native freshness checks.
use super::{
    base::{month_bounds, unavailable},
    profile, saved,
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
fn answers(value: &Value, training: bool) -> Value {
    let mut out = json!({});
    let keys = if training {
        [
            "drkApplicabilityConfirmed",
            "trainingCategoryConfirmed",
            "trainingYearConfirmed",
            "fullMonthBaseEntitlementConfirmed",
            "fullTimeTrainingConfirmed",
        ]
    } else {
        [
            "drkApplicabilityConfirmed",
            "annexAssignmentConfirmed",
            "payGroupAndStepConfirmed",
            "weeklyTimeBasisConfirmed",
            "fullMonthBaseEntitlementConfirmed",
        ]
    };
    for key in keys {
        out[key] = json!(value[key] == true);
    }
    out
}
pub fn calculate_employee(
    month: &str,
    profiles: &[Value],
    resolver: &RuleResolver,
    confirmations: &[Value],
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
    let mut matching = confirmations.iter().filter(|v| v["month"] == month);
    let Some(value) = matching.next() else {
        return Ok(unavailable("CONFIRMATION_MISSING"));
    };
    if matching.next().is_some() {
        return Ok(unavailable("CONFIRMATION_AMBIGUOUS"));
    }
    if !saved::is_current_employee(value, start, &from.version_id) {
        return Ok(unavailable("CONFIRMATION_STALE"));
    }
    profile::calculate_employee_from_profile(
        month,
        profiles,
        resolver,
        &answers(value, false),
        validator,
    )
}
pub fn calculate_training(
    month: &str,
    profiles: &[Value],
    training_profiles: &[Value],
    resolver: &RuleResolver,
    confirmations: &[Value],
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
    for value in training_profiles {
        if !dates.insert(value["data"]["effectiveFrom"].to_string()) {
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
    let (Ok(from), Ok(to)) = (
        resolver.resolve_tariff(&bounds.start, Some(&selection.package_id)),
        resolver.resolve_tariff(&bounds.end, Some(&selection.package_id)),
    ) else {
        return Ok(unavailable("RULE_PACKAGE_UNAVAILABLE"));
    };
    if !std::ptr::eq(from, to) {
        return Ok(unavailable("RULE_VERSION_CHANGES_IN_MONTH"));
    }
    let mut matching = confirmations.iter().filter(|v| v["month"] == month);
    let Some(value) = matching.next() else {
        return Ok(unavailable("CONFIRMATION_MISSING"));
    };
    if matching.next().is_some() {
        return Ok(unavailable("CONFIRMATION_AMBIGUOUS"));
    }
    if !saved::is_current_training(value, start, &training_start, &from.version_id) {
        return Ok(unavailable("CONFIRMATION_STALE"));
    }
    profile::calculate_training_from_profile(
        month,
        profiles,
        training_profiles,
        resolver,
        &answers(value, true),
        validator,
    )
}
