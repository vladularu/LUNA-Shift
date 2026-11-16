//! Rebuild only the private retained M3 basis and the corresponding raw child
//! reads. A current main-report snapshot is a catalog/publication owner only.
use crate::{
    contract::{
        SourceKind,
        checks_details::{ChecksDetailsIntent, ChildReadState},
    },
    input::{
        employment::RawEmploymentHistory,
        working_time_target::{RawSavedWorkingTimeTarget, map_working_time_target_row},
    },
    runtime::{ProfileClockEnvironment, facts::SnapshotFacts, report::ReportIssue},
    target::{
        InputStatus,
        profile::{create_working_time_calculation_profile, project_saved_target_snapshot},
    },
};
use serde_json::Value;
use std::sync::Arc;

pub(crate) fn calculate(
    facts: &SnapshotFacts,
    month: &str,
    input: &ChecksDetailsIntent,
) -> Result<Value, ReportIssue> {
    let invalid = || ReportIssue::new("CHECKS_DETAILS_SOURCE_UNAVAILABLE");
    let source = |kind| {
        input
            .basis
            .sources
            .iter()
            .find(|s| s.kind() == kind)
            .map(|s| s.state())
            .ok_or_else(invalid)
    };
    let environment = ProfileClockEnvironment::from_states(
        facts.snapshot().identity().owner_scope(),
        source(SourceKind::WorkProfile)?,
        source(SourceKind::RemunerationProfiles)?,
        input.basis.source_epoch_milliseconds,
    )
    .map_err(|_| invalid())?;
    if environment.source_clock_key() != input.basis.source_clock_key {
        return Err(ReportIssue::new("CHECKS_DETAILS_PROFILE_BASIS_CHANGED"));
    }
    let base = environment
        .calculation_profile_base(source(SourceKind::WorkPatternSettings)?)
        .map_err(|_| invalid())?
        .ok_or_else(invalid)?;
    let history =
        RawEmploymentHistory::try_from_rows(Arc::new(input.children.history_rows.clone()))
            .map_err(|_| invalid())?;
    let loaded = input.children.loaded_target.as_ref();
    let status = if loaded.is_none_or(|loaded| loaded.revision != input.children.target_revision)
        || input.children.history_state == ChildReadState::Loading
    {
        InputStatus::Loading
    } else if loaded.is_some_and(|loaded| loaded.state == ChildReadState::Failed)
        || input.children.history_state == ChildReadState::Failed
    {
        InputStatus::Error
    } else {
        InputStatus::Ready
    };
    let snapshot = if status == InputStatus::Ready {
        let read = loaded
            .and_then(|loaded| loaded.read.as_ref())
            .ok_or_else(invalid)?;
        let saved = read
            .saved_row
            .as_ref()
            .map(|row| {
                if row.get("settings_json_chunks").is_some() {
                    RawSavedWorkingTimeTarget::try_from_raw_row_chunks(row)
                        .map(|v| v.saved().clone())
                } else {
                    map_working_time_target_row(row)
                }
            })
            .transpose()
            .map_err(|_| invalid())?;
        Some(
            project_saved_target_snapshot(
                saved.as_ref(),
                read.time_zone.as_deref(),
                &read.plan_rows,
            )
            .map_err(|_| invalid())?,
        )
    } else {
        None
    };
    let profile = create_working_time_calculation_profile(
        &base,
        snapshot.as_ref(),
        history.profiles(),
        status,
        input.children.youth_protection,
        match input.children.youth_state {
            ChildReadState::Ready => InputStatus::Ready,
            ChildReadState::Loading => InputStatus::Loading,
            ChildReadState::Failed => InputStatus::Error,
        },
    )
    .map_err(|_| invalid())?;
    let resolver = facts.catalog()?.resolver();
    let mut result = super::calculate_monthly_details(
        month,
        Arc::clone(&input.entries),
        &profile,
        input.observed_epoch_milliseconds,
        input.youth_protection,
        resolver,
        Arc::clone(&input.ranks),
    )
    .map_err(|_| ReportIssue::new("CHECKS_DETAILS_CALCULATION_FAILED"))?;
    result["timeZone"] = profile["timeZone"].clone();
    let mut regular = serde_json::Map::new();
    if let Some(issues) = result["compliance"]["value"]["issues"].as_array() {
        for issue in issues {
            if let Some(date) = issue["date"].as_str() {
                let minutes = resolver
                    .resolve_legal(date)
                    .ok()
                    .and_then(|p| p.rules()["restPeriod"]["defaultMinutes"].as_i64());
                regular.insert(date.to_owned(), serde_json::json!(minutes));
            }
        }
    }
    result["regularRestMinutes"] = Value::Object(regular);
    Ok(result)
}
