//! Complete source-bound BBiG/PflBG adult training assessment.
mod book;
mod days;
mod exam;
mod school;
use super::{PreparedTrainingProfiles, PreparedYouthEntries, TrainingError};
use crate::rules::RuleResolver;
use serde_json::Value;
use std::collections::BTreeMap;
#[derive(Default)]
pub struct AdultTrainingResult {
    pub findings: Vec<Value>,
    pub daily_credits: BTreeMap<String, Option<f64>>,
    pub block_weekly_credits: BTreeMap<String, Option<f64>>,
    pub assessed_dates: Vec<String>,
}
pub fn calculate_adult_training(
    month: &str,
    entries: &PreparedYouthEntries<'_>,
    profiles: &PreparedTrainingProfiles,
    resolver: &RuleResolver,
) -> Result<AdultTrainingResult, TrainingError> {
    let mut result = AdultTrainingResult::default();
    let mut book = book::Book::new(month);
    let days = days::prepare(month, entries, profiles, resolver, &mut book, &mut result)?;
    school::apply_bbig(&days, &mut book, &mut result)?;
    exam::assess(&days, &mut book, &mut result)?;
    for problem in entries.problems() {
        if days.iter().any(|d| d.adult && d.date == problem.date()) {
            result.daily_credits.insert(problem.date().into(), None);
            let week = super::week_start(problem.date())?;
            if result.block_weekly_credits.contains_key(&week) {
                result.block_weekly_credits.insert(week, None);
            }
        }
    }
    result.findings = book.findings;
    result.assessed_dates = days
        .iter()
        .filter(|d| d.adult && d.date.starts_with(month))
        .map(|d| d.date.clone())
        .collect();
    Ok(result)
}
