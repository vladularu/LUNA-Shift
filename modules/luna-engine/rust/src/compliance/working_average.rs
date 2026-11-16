//! ArbZG §3: both authoritative alternative compensation windows, in source order.
use super::{
    average::{
        AverageContext, add_days, add_months, date_label, duration_label, groups, known_holidays,
    },
    issue::{IssueSpec, create_issue},
    model::{ComplianceError, integer, is_night_work, number, text},
};
use crate::calendar::parse_date;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

struct WindowAverage {
    minutes: f64,
    workdays: usize,
    neutral: usize,
}
struct Prefix {
    indexes: BTreeMap<String, usize>,
    worked: Vec<f64>,
    days: Vec<usize>,
    neutral: Vec<usize>,
}
impl Prefix {
    fn average(&self, start: jiff::civil::Date, end: jiff::civil::Date) -> Option<WindowAverage> {
        let first = *self.indexes.get(&start.to_string())?;
        let last = *self.indexes.get(&end.to_string())? + 1;
        let days = self.days[last] - self.days[first];
        if days == 0 {
            return None;
        }
        Some(WindowAverage {
            minutes: (self.worked[last] - self.worked[first]) / days as f64,
            workdays: days,
            neutral: self.neutral[last] - self.neutral[first],
        })
    }
}
pub fn check_working_time_average(
    context: &AverageContext<'_>,
) -> Result<Vec<Value>, ComplianceError> {
    let working = &context.rules["workingTime"];
    let Some(average) = working.get("standardAverage") else {
        return Ok(vec![]);
    };
    if context.version < 4 {
        return Ok(vec![]);
    }
    let standard = number(working, "standardDailyMinutes")?;
    let maximum = number(working, "maxDailyMinutes")?;
    let mut candidates = vec![];
    for group in groups(context.intervals)? {
        if !text(&group[0].shift, "date")?.starts_with(&format!("{}-", context.month)) {
            continue;
        }
        let minutes = group.iter().fold(0.0, |sum, item| sum + item.net_minutes);
        if minutes <= standard || minutes > maximum {
            continue;
        }
        let mut night = false;
        if context.night_worker {
            for item in &group {
                if is_night_work(item, context.rules)? {
                    night = true;
                    break;
                }
            }
        }
        if !night {
            candidates.push(group);
        }
    }
    if candidates.is_empty() {
        return Ok(vec![]);
    }
    let mut worked = BTreeMap::<&str, f64>::new();
    for item in context.intervals {
        *worked.entry(text(&item.shift, "date")?).or_default() += item.net_minutes;
    }
    let neutral_types: BTreeSet<&str> = average
        .get("neutralAbsenceTypes")
        .and_then(Value::as_array)
        .ok_or(ComplianceError::InvalidInput)?
        .iter()
        .map(|v| v.as_str().ok_or(ComplianceError::InvalidInput))
        .collect::<Result<_, _>>()?;
    let mut neutral_dates = BTreeSet::new();
    for shift in context.shifts {
        if shift.get("deletedAt") == Some(&Value::Null)
            && neutral_types.contains(text(shift, "type")?)
            && !worked.contains_key(text(shift, "date")?)
        {
            neutral_dates.insert(text(shift, "date")?);
        }
    }
    let months = integer(average, "calendarMonths")?;
    let weeks = integer(average, "weeks")?;
    let first = parse_date(text(&candidates[0][0].shift, "date")?)?;
    let last_candidate = parse_date(text(
        &candidates.last().ok_or(ComplianceError::InvalidInput)?[0].shift,
        "date",
    )?)?;
    let last = add_days(add_months(last_candidate, months)?, -1)?
        .max(add_days(last_candidate, weeks * 7 - 1)?);
    let holidays = known_holidays(first, last, context.options, context.resolver)?;
    let last_weekday = integer(working, "workWeekLastDay")?;
    let mut prefix = Prefix {
        indexes: BTreeMap::new(),
        worked: vec![0.0],
        days: vec![0],
        neutral: vec![0],
    };
    let mut date = first;
    let mut index = 0;
    while date <= last {
        let key = date.to_string();
        prefix.indexes.insert(key.clone(), index);
        let statutory = i64::from(date.weekday().to_monday_one_offset()) <= last_weekday
            && !holidays.contains(&key);
        let neutral = statutory && neutral_dates.contains(key.as_str());
        prefix
            .worked
            .push(prefix.worked[index] + worked.get(key.as_str()).copied().unwrap_or(0.0));
        prefix
            .days
            .push(prefix.days[index] + usize::from(statutory && !neutral));
        prefix
            .neutral
            .push(prefix.neutral[index] + usize::from(neutral));
        if date == last {
            break;
        }
        date = add_days(date, 1)?;
        index += 1;
    }
    for group in candidates {
        let date = text(&group[0].shift, "date")?;
        let start = parse_date(date)?;
        let calendar_end = add_days(add_months(start, months)?, -1)?;
        let week_end = add_days(start, weeks * 7 - 1)?;
        if let (Some(calendar), Some(week)) = (
            prefix.average(start, calendar_end),
            prefix.average(start, week_end),
        ) && calendar.minutes > standard
            && week.minutes > standard
        {
            let deadline = calendar_end.max(week_end);
            let overdue = context.reference_date > deadline;
            let neutral = calendar.neutral.max(week.neutral);
            let absence = if neutral == 0 {
                String::new()
            } else {
                format!(
                    " Urlaub und Krankheit wurden mit {neutral} neutralen Werktagen nicht als Ausgleich verwendet."
                )
            };
            let description = format!(
                "Ab {} liegen die erfassten Durchschnitte bei {} in {months} Kalendermonaten ({} Werktage) und {} in {weeks} Wochen ({} Werktage). Zulässig sind höchstens {} je Werktag; eine der beiden Alternativen muss bis {} eingehalten sein.{absence}",
                date_label(start),
                duration_label(calendar.minutes)?,
                calendar.workdays,
                duration_label(week.minutes)?,
                week.workdays,
                duration_label(standard)?,
                date_label(deadline)
            );
            let mut finding = create_issue(
                IssueSpec::new(
                    if overdue { "critical" } else { "warning" },
                    "LEGAL",
                    "ARBZG_3_OVER_8H",
                    if overdue {
                        "Ausgleich der Tagesarbeitszeit fehlt"
                    } else {
                        "Ausgleich der Tagesarbeitszeit offen"
                    },
                    &description,
                )
                .on_date(date),
                group.iter().map(|item| item.shift.as_ref()),
            )?;
            finding["assessmentRanges"] =
                json!([{ "from":date,"through":add_days(deadline,1)?.to_string() }]);
            return Ok(vec![finding]);
        }
    }
    Ok(vec![])
}
