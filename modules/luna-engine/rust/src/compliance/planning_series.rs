use super::{
    issue::{IssueSpec, create_issue, german_quantity},
    model::{ComplianceError, ComplianceInterval, is_night_work},
    policy,
    sequences::consecutive_date_streaks,
};
use serde_json::{Value, json};
use std::sync::Arc;
pub fn check_planning_series(
    intervals: &[ComplianceInterval],
    rules: &Value,
    include_legacy_nights: bool,
) -> Result<Vec<Value>, ComplianceError> {
    let shifts = intervals
        .iter()
        .map(|item| Arc::clone(&item.shift))
        .collect::<Vec<_>>();
    let mut issues = Vec::new();
    for streak in consecutive_date_streaks(&shifts)? {
        if streak.len() >= policy::FIRST_WORK_SERIES_HINT {
            issues.push(create_issue(
                IssueSpec::new(
                    "warning",
                    "PLANNING",
                    "PLANNING_7_DAYS",
                    &format!(
                        "{} oder mehr Arbeitstage in Folge",
                        german_quantity(policy::FIRST_WORK_SERIES_HINT as f64, true)?
                    ),
                    &format!(
                        "{} aufeinanderfolgende Arbeitstage wurden erkannt.",
                        streak.len()
                    ),
                )
                .with_facts(&json!({"rule":"PLANNING_7_DAYS","count":streak.len()})),
                streak.iter().map(Arc::as_ref),
            )?);
        }
    }
    if !include_legacy_nights {
        return Ok(issues);
    }
    let mut nights = Vec::new();
    for interval in intervals {
        if is_night_work(interval, rules)? {
            nights.push(Arc::clone(&interval.shift));
        }
    }
    for streak in consecutive_date_streaks(&nights)? {
        if streak.len() >= policy::FIRST_NIGHT_HINT {
            issues.push(create_issue(
                IssueSpec::new(
                    "warning",
                    "PLANNING",
                    "PLANNING_NIGHT_SERIES",
                    &format!(
                        "{} oder mehr Nachtdienste in Folge",
                        german_quantity(policy::FIRST_NIGHT_HINT as f64, true)?
                    ),
                    &format!(
                        "{} aufeinanderfolgende Nachtdienste wurden erkannt.",
                        streak.len()
                    ),
                )
                .with_facts(&json!({"rule":"PLANNING_NIGHT_SERIES","count":streak.len()})),
                streak.iter().map(Arc::as_ref),
            )?);
        }
    }
    Ok(issues)
}
