//! Source-bound native training-time basis reused by legal youth checks.
use super::{
    PreparedTrainingProfiles, PreparedYouthEntries, TrainingDay, TrainingError, TrainingEvent,
    YouthEntry,
};
use crate::calendar::parse_date;
use crate::rules::RuleResolver;
use jiff::ToSpan;
use serde_json::Value;
use std::collections::BTreeMap;
pub struct PreparedYouthAssessment<'a> {
    pub(super) month: String,
    pub(super) profile: &'a Value,
    pub(super) entries: &'a [&'a YouthEntry],
    pub(super) raw_shifts: &'a [Value],
    pub(super) resolver: &'a RuleResolver,
    pub(super) days: Vec<TrainingDay<'a>>,
    pub(super) daily: BTreeMap<String, Option<f64>>,
    pub(super) block_weekly: BTreeMap<String, Option<f64>>,
    pub(super) stage_events: Vec<TrainingEvent>,
    pub(super) preliminary: Vec<super::youth_report::Prelude<'a>>,
    days_by_date: BTreeMap<String, usize>,
    schools_by_date: BTreeMap<&'a str, Vec<&'a YouthEntry>>,
}
impl PreparedYouthAssessment<'_> {
    pub(super) fn day_for_date(&self, date: &str) -> Option<&TrainingDay<'_>> {
        self.days_by_date.get(date).map(|i| &self.days[*i])
    }
    pub fn month(&self) -> &str {
        &self.month
    }
    pub fn profile(&self) -> &Value {
        self.profile
    }
    pub fn original_entries(&self) -> &[&YouthEntry] {
        self.entries
    }
    pub fn days(&self) -> &[TrainingDay<'_>] {
        &self.days
    }
    pub fn daily_credits(&self) -> &BTreeMap<String, Option<f64>> {
        &self.daily
    }
    pub fn block_weekly_credits(&self) -> &BTreeMap<String, Option<f64>> {
        &self.block_weekly
    }
    pub fn stage_events(&self) -> &[TrainingEvent] {
        &self.stage_events
    }
    pub fn shortened_dates<'a>(
        &self,
        day: &'a TrainingDay<'_>,
    ) -> Result<Vec<&'a str>, TrainingError> {
        let limit = day.legal.rules()["youthProtection"]["workingTime"]["dailyMinutes"]
            .as_f64()
            .ok_or_else(|| TrainingError::invalid("Ungültiger Ausbildungsregelstand."))?;
        Ok(day.facts_context["shortenedWorkingDays"]
            .as_array()
            .expect("normalized confirmed dates")
            .iter()
            .filter_map(|date| {
                let date = date.as_str().expect("normalized confirmed date");
                let other = &self.days[*self.days_by_date.get(date)?];
                let minutes = self.daily.get(date).copied().flatten()?;
                (!other.work_entries().is_empty() && minutes < limit).then_some(date)
            })
            .collect())
    }
    pub fn next_early_school(&self, day: &TrainingDay<'_>) -> Result<bool, TrainingError> {
        let next = parse_date(&day.date)
            .map_err(|_| super::helpers::temporal())?
            .checked_add(1.days())
            .map_err(|_| super::helpers::temporal())?
            .to_string();
        let limit = day.school_rules["earlyStartMinute"]
            .as_f64()
            .ok_or_else(|| TrainingError::invalid("Ungültiger Ausbildungsregelstand."))?;
        let zone = self.profile["timeZone"]
            .as_str()
            .ok_or_else(super::helpers::temporal)?;
        for entry in self
            .schools_by_date
            .get(next.as_str())
            .into_iter()
            .flatten()
        {
            if (super::clock_minutes(entry.start_epoch_milliseconds(), zone)? as f64) < limit {
                return Ok(true);
            }
        }
        Ok(false)
    }
}
pub fn prepare_youth_assessment<'a>(
    prepared: &'a PreparedYouthEntries<'_>,
    profiles: &'a PreparedTrainingProfiles,
    month: &str,
    resolver: &'a RuleResolver,
) -> Result<PreparedYouthAssessment<'a>, TrainingError> {
    let prepared_days = super::days::prepare_youth_days(prepared, profiles, month, resolver)?;
    let days = prepared_days.days;
    let school = super::school_credits(&days, month, super::SchoolMode::Youth)?;
    let exams = super::assess_youth_exams(&days, &school.daily)?;
    let mut daily = exams.daily;
    let mut block_weekly = school.block_weekly;
    for problem in prepared.problems() {
        daily.insert(problem.date().into(), None);
        let week = super::week_start(problem.date())?;
        if block_weekly.contains_key(&week) {
            block_weekly.insert(week, None);
        }
    }
    let mut stage_events = school.events;
    stage_events.extend(exams.events);
    let days_by_date = days
        .iter()
        .enumerate()
        .map(|(i, d)| (d.date.clone(), i))
        .collect();
    let mut schools_by_date = BTreeMap::<&str, Vec<&YouthEntry>>::new();
    for entry in prepared
        .entries()
        .iter()
        .copied()
        .filter(|e| e.school().is_some())
    {
        schools_by_date
            .entry(entry.shift()["date"].as_str().expect("native entry date"))
            .or_default()
            .push(entry);
    }
    Ok(PreparedYouthAssessment {
        month: month.into(),
        profile: prepared.profile(),
        entries: prepared.entries(),
        raw_shifts: prepared.raw_shifts(),
        resolver,
        days,
        daily,
        block_weekly,
        stage_events,
        preliminary: prepared_days.preliminary,
        days_by_date,
        schools_by_date,
    })
}
