use super::model;
use crate::{
    contract::ReportPeriod,
    input::draft_rows::DraftRowsKind,
    remuneration::{
        caritas::candidate::{self, AnnualClaims, CandidateSnapshot},
        context::{
            model::{ContextKind, FullNativePackageValidator},
            periods::resolve_month,
        },
        drk,
    },
    runtime::{
        facts::SnapshotFacts,
        report::{ReportIssue, SectionOutput},
    },
};
use serde_json::{Value, json};
fn caritas(facts: &SnapshotFacts, month: &str) -> Result<Value, ReportIssue> {
    let profile = facts
        .profile()?
        .ok_or_else(|| ReportIssue::new("PROFILE_MISSING"))?;
    let calendar = facts.calendar()?;
    let shifts = calendar
        .payroll_shifts()
        .map_err(|_| ReportIssue::new("PAYROLL_HISTORY_INVALID"))?;
    let pauses = facts.annex_pause_details()?;
    let profiles = facts.employment_history()?;
    let decisions = facts.scoped_allowances()?;
    let allocations = facts.overtime_allocations()?;
    let overtime = facts.draft_evidence(DraftRowsKind::CaritasOvertime)?;
    let months = facts.draft_evidence(DraftRowsKind::CaritasMonth)?;
    let days = facts.draft_evidence(DraftRowsKind::CaritasWorkDay)?;
    let claims = facts.tariff_annual_claims()?;
    let catalog = facts.catalog()?;
    candidate::calculate(
        &CandidateSnapshot {
            profile: Some(profile.flat_profile()),
            shifts,
            pause_details: pauses.saved(),
            remuneration_profiles: profiles.profiles(),
            allowance_decisions: decisions.saved(),
            overtime_allocations: allocations.saved(),
            overtime_confirmations: overtime.saved(),
            month_facts: months.saved(),
            work_day_confirmations: days.saved(),
            annual_claims: AnnualClaims::Checked(claims.validated()),
            entries_complete: true,
            history_complete: true,
        },
        month,
        catalog.resolver(),
        &FullNativePackageValidator,
    )
    .map_err(|_| ReportIssue::new("CARITAS_CALCULATION_FAILED"))
}
fn drk(facts: &SnapshotFacts, month: &str, training: bool) -> Result<Value, ReportIssue> {
    let profiles = facts.employment_history()?;
    let catalog = facts.catalog()?;
    let confirmations = facts.draft_evidence(if training {
        DraftRowsKind::DrkTraining
    } else {
        DraftRowsKind::DrkEmployee
    })?;
    if training {
        let training = facts.training_profiles()?;
        drk::from_saved::calculate_training(
            month,
            profiles.profiles(),
            training.saved(),
            catalog.resolver(),
            confirmations.saved(),
            &FullNativePackageValidator,
        )
    } else {
        drk::from_saved::calculate_employee(
            month,
            profiles.profiles(),
            catalog.resolver(),
            confirmations.saved(),
            &FullNativePackageValidator,
        )
    }
    .map_err(|_| ReportIssue::new("DRK_CALCULATION_FAILED"))
}
fn month(facts: &SnapshotFacts, month: &str) -> Result<Vec<Value>, ReportIssue> {
    let history = facts.employment_history()?;
    if history.profiles().is_empty() {
        return Ok(vec![]);
    }
    let catalog = facts.catalog()?;
    let periods = resolve_month(
        month,
        history.profiles(),
        catalog.resolver(),
        &FullNativePackageValidator,
    )
    .map_err(|_| ReportIssue::new("REMUNERATION_CONTEXT_INVALID"))?;
    let ids = periods
        .iter()
        .filter_map(|period| {
            period
                .context
                .profile
                .and_then(|profile| profile["data"]["selection"]["packageId"].as_str())
        })
        .collect::<std::collections::BTreeSet<_>>();
    let mut candidates = vec![];
    if ids.iter().any(|id| id.starts_with("avr-caritas-p-")) {
        candidates.push(json!({"month":month,"family":"CARITAS","completeGross":false,"result":SectionOutput::from_result(caritas(facts,month))}));
    }
    if ids
        .iter()
        .any(|id| matches!(*id, "drk-rtv-e" | "drk-rtv-p" | "drk-rtv-s"))
    {
        candidates.push(json!({"month":month,"family":"DRK_EMPLOYEE","completeGross":false,"result":SectionOutput::from_result(drk(facts,month,false))}));
    }
    if ids.contains("drk-rtv-training") {
        candidates.push(json!({"month":month,"family":"DRK_TRAINING","completeGross":false,"result":SectionOutput::from_result(drk(facts,month,true))}));
    }
    // The original generic context has no saved AVR-DD applicability/full-month
    // facts. Keep its original unavailable issue; never manufacture confirmations.
    for period in &periods {
        if period.context.profile.is_some_and(|profile| {
            profile["data"]["selection"]["packageId"]
                .as_str()
                .is_some_and(|id| id.starts_with("avr-dd"))
        }) {
            let value = match &period.context.kind {
                ContextKind::Unavailable { .. } => model::output(&period.context.kind),
                _ => Err(ReportIssue::new("AVRDD_DRAFT_FACTS_REQUIRED")),
            };
            candidates.push(json!({"month":month,"family":"AVR_DD","from":period.from,"through":period.through,"completeGross":false,"result":SectionOutput::from_result(value)}));
        }
    }
    Ok(candidates)
}
pub(super) fn gross(facts: &SnapshotFacts, period: &ReportPeriod) -> Result<Value, ReportIssue> {
    match period {
        ReportPeriod::Month { month: requested } => Ok(json!(month(facts, requested)?)),
        ReportPeriod::Year { year } => {
            let mut candidates = vec![];
            for index in 1..=12 {
                candidates.extend(month(facts, &format!("{year}-{index:02}"))?);
            }
            Ok(json!(candidates))
        }
    }
}
