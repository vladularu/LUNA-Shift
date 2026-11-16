//! Combined youth/adult training calculation; sorting is a separate platform step.
use super::{PreparedTrainingProfiles, PreparedYouthEntries, TrainingError};
use super::{
    TrainingEvent,
    youth_report::{Book, Context},
};
use crate::{EngineError, calendar::recurrence::CollationRanks, rules::RuleResolver};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
pub struct YouthComplianceDraft {
    status: &'static str,
    findings: Vec<Value>,
    assessed_dates: Vec<String>,
    training_time_days: Vec<Value>,
}
impl YouthComplianceDraft {
    pub fn finding_code_candidates(&self) -> Vec<String> {
        self.findings
            .iter()
            .map(|f| f["code"].as_str().expect("native finding code").to_owned())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }
    pub fn finish(self, ranks: &CollationRanks) -> Result<Value, EngineError> {
        let mut findings = self
            .findings
            .into_iter()
            .map(|f| {
                let date = f["date"].as_str().expect("native finding date").to_owned();
                let rank = ranks.rank(f["code"].as_str().expect("native finding code"))?;
                Ok((date, rank, f))
            })
            .collect::<Result<Vec<_>, EngineError>>()?;
        findings.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
        Ok(
            json!({"status":self.status,"findings":findings.into_iter().map(|(_,_,f)|f).collect::<Vec<_>>(),"assessedDates":self.assessed_dates,"trainingTimeDays":self.training_time_days}),
        )
    }
}
pub fn prepare_youth_compliance(
    month: &str,
    entries: &PreparedYouthEntries<'_>,
    profiles: &PreparedTrainingProfiles,
    resolver: &RuleResolver,
) -> Result<YouthComplianceDraft, TrainingError> {
    let context = super::prepare_youth_assessment(entries, profiles, month, resolver)?;
    let mut book = Book::new(month);
    for prelude in &context.preliminary {
        book.report(prelude.context, &prelude.event);
    }
    for event in &context.stage_events {
        let day = context
            .day_for_date(&event.day_date)
            .expect("native school/exam reporting day");
        book.report(Some(Context::day(day)), event);
    }
    for event in super::check_youth_daily(&context)? {
        let day = context
            .day_for_date(&event.day_date)
            .expect("native daily reporting day");
        book.report(Some(Context::day(day)), &event);
    }
    let mut periods = BTreeMap::<&str, Vec<&super::YouthEntry>>::new();
    for entry in entries.entries() {
        periods
            .entry(entry.shift()["date"].as_str().expect("native entry date"))
            .or_default()
            .push(entry);
    }
    let ordered = periods
        .iter()
        .map(|(date, entries)| (*date, entries))
        .collect::<Vec<_>>();
    for pair in ordered.windows(2) {
        let (_, before) = pair[0];
        let (date, after) = pair[1];
        let Some(target) = context.day_for_date(date) else {
            continue;
        };
        let before_end = before
            .iter()
            .map(|e| super::training_activity_bounds(e, entries.entries()).end_epoch_milliseconds())
            .max()
            .expect("nonempty occupation period");
        let after_start = after
            .iter()
            .map(|e| {
                super::training_activity_bounds(e, entries.entries()).start_epoch_milliseconds()
            })
            .min()
            .expect("nonempty occupation period");
        let rest = (after_start - before_end) as f64 / 60000.0;
        let limit = super::days::amount(&target.legal.rules()["youthProtection"], "restMinutes")?;
        if rest < limit {
            let event = TrainingEvent {
                day_date: target.date.clone(),
                date: target.date.clone(),
                code: "DAILY_REST",
                severity: "WARNING",
                message: format!(
                    "Zwischen den Beschäftigungstagen liegen weniger als {} Minuten ununterbrochene Freizeit.",
                    super::daily::label(limit)
                ),
                section: "§ 13 JArbSchG",
                shift_ids: before
                    .iter()
                    .chain(after)
                    .map(|e| e.shift()["id"].as_str().expect("native entry id").into())
                    .collect(),
            };
            book.report(Some(Context::day(target)), &event);
        }
    }
    for event in super::check_youth_weekly(&context)? {
        let day = context
            .day_for_date(&event.day_date)
            .expect("native weekly reporting day");
        book.report(Some(Context::day(day)), &event);
    }
    let adult = super::calculate_adult_training(month, entries, profiles, resolver)?;
    book.findings.extend(adult.findings);
    let mut activity = BTreeSet::<String>::new();
    for entry in entries.entries() {
        let date = entry.shift()["date"].as_str().expect("native entry date");
        if entry.school().is_some() || entry.exam().is_some() {
            activity.insert(date.into());
        }
        if let Some(exam) = entry
            .exam()
            .filter(|e| e["kind"] == "EXAM" && e["finalWritten"] == true)
            && let Some(prior) = exam["precedingWorkDate"].as_str()
        {
            let saved = profiles.for_date(date)?.map(|r| &r["data"]);
            let age = saved
                .map(|p| super::days::profile_age(p, date))
                .transpose()?
                .flatten();
            if age.is_some_and(|a| a < 18)
                || age.is_some() && saved.is_some_and(|p| p["training"]["legalBasis"] == "BBIG")
            {
                activity.insert(prior.into());
            }
        }
    }
    let mut training_time_days = vec![];
    for date in activity.iter().filter(|d| d.starts_with(month)) {
        let saved = profiles.for_date(date)?.map(|r| &r["data"]);
        let age = saved
            .map(|p| super::days::profile_age(p, date))
            .transpose()?
            .flatten();
        let basis = if age.is_some_and(|a| a < 18) {
            "JARBSCHG"
        } else if age.is_some()
            && saved
                .is_some_and(|p| p["status"] == "training" && p["training"]["legalBasis"] == "BBIG")
        {
            "BBIG"
        } else if age.is_some()
            && saved.is_some_and(|p| {
                p["status"] == "training" && p["training"]["legalBasis"] == "PFLBG"
            })
        {
            "PFLBG"
        } else {
            "UNKNOWN"
        };
        let minutes = match basis {
            "JARBSCHG" => context.daily.get(date).copied().flatten(),
            "UNKNOWN" => None,
            _ => adult.daily_credits.get(date).copied().flatten(),
        };
        training_time_days.push(json!({"date":date,"basis":basis,"minutes":minutes}));
    }
    let mut assessed_dates = context
        .days
        .iter()
        .filter(|d| d.date.starts_with(month))
        .map(|d| d.date.clone())
        .chain(adult.assessed_dates)
        .collect::<Vec<_>>();
    assessed_dates.sort();
    let status = if book.findings.iter().any(|f| f["severity"] == "INCOMPLETE") {
        "INCOMPLETE"
    } else if book.findings.iter().any(|f| f["severity"] == "WARNING") {
        "FINDINGS"
    } else if !assessed_dates.is_empty() {
        "NO_FINDINGS"
    } else {
        "NOT_APPLICABLE"
    };
    Ok(YouthComplianceDraft {
        status,
        findings: book.findings,
        assessed_dates,
        training_time_days,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn platform_equal_ranks_keep_original_same_date_report_order() {
        // The rank boundary defines comparator equality. Stable report order is
        // required even when different strings receive the same platform rank.
        let draft = YouthComplianceDraft {
            status: "FINDINGS",
            findings: vec![
                json!({"date":"2026-09-15","code":"WORKING_DAYS","id":"later-date"}),
                json!({"date":"2026-09-14","code":"WORKING_DAYS","id":"first"}),
                json!({"date":"2026-09-14","code":"WORK_IN_SCHOOL_BLOCK","id":"second"}),
            ],
            assessed_dates: vec![],
            training_time_days: vec![],
        };
        let ranks = CollationRanks::from(BTreeMap::from([
            ("WORKING_DAYS".into(), 0),
            ("WORK_IN_SCHOOL_BLOCK".into(), 0),
        ]));
        let result = draft.finish(&ranks).unwrap();
        let ids = result["findings"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["id"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["first", "second", "later-date"]);
    }
}
