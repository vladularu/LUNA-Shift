//! ArbZG §6: preserved legacy and reviewed calendar/rolling night averages.
use super::{
    average::{
        AverageContext, add_days, add_months, duration_label, groups, known_holidays, range,
        statutory_workdays,
    },
    issue::{IssueSpec, create_issue},
    model::{ComplianceError, ComplianceInterval, integer, is_night_work, js_round, number, text},
};
use crate::calendar::parse_date;
use jiff::civil::Date;
use serde_json::{Value, json};
use std::collections::BTreeSet;

struct WorkedAverage {
    minutes: f64,
    workdays: usize,
}
fn worked_average(
    context: &AverageContext<'_>,
    start: Date,
    end: Date,
) -> Result<Option<WorkedAverage>, ComplianceError> {
    let holidays = known_holidays(start, end, context.options, context.resolver)?;
    let workdays = statutory_workdays(
        start,
        end,
        &holidays,
        integer(&context.rules["workingTime"], "workWeekLastDay")?,
    )?;
    if workdays == 0 {
        return Ok(None);
    }
    let worked = range(context.intervals, start, end)?
        .iter()
        .fold(0.0, |sum, item| sum + item.net_minutes);
    Ok(Some(WorkedAverage {
        minutes: worked / workdays as f64,
        workdays,
    }))
}
fn finding<'a>(
    context: &AverageContext<'_>,
    deadline: Date,
    description: &str,
    related: impl IntoIterator<Item = &'a Value>,
    date: Option<&str>,
) -> Result<Value, ComplianceError> {
    let overdue = context.reference_date > deadline;
    let mut spec = IssueSpec::new(
        if overdue { "critical" } else { "warning" },
        "LEGAL",
        "ARBZG_6_NIGHT_AVERAGE",
        if overdue {
            "Ausgleich der Nachtarbeitszeit fehlt"
        } else {
            "Ausgleich der Nachtarbeitszeit offen"
        },
        description,
    );
    if let Some(date) = date {
        spec = spec.on_date(date);
    }
    create_issue(spec, related)
}
fn legacy(
    context: &AverageContext<'_>,
    month_start: Date,
    month_end: Date,
    extended: &[Vec<&ComplianceInterval>],
) -> Result<Vec<Value>, ComplianceError> {
    let month_intervals = range(context.intervals, month_start, month_end)?;
    let holidays = known_holidays(month_start, month_end, context.options, context.resolver)?;
    let working = &context.rules["workingTime"];
    let workdays = statutory_workdays(
        month_start,
        month_end,
        &holidays,
        integer(working, "workWeekLastDay")?,
    )?;
    if workdays == 0 {
        return Ok(vec![]);
    }
    let worked_dates: BTreeSet<_> = month_intervals
        .iter()
        .map(|item| text(&item.shift, "date"))
        .collect::<Result<_, _>>()?;
    let worked = month_intervals
        .iter()
        .fold(0.0, |sum, item| sum + item.net_minutes);
    let mut absence = 0.0;
    if let Some(weekly) = context
        .options
        .get("weeklyMinutes")
        .and_then(Value::as_f64)
        .filter(|v| *v > 0.0)
    {
        let absence_days = integer(working, "absenceWorkdaysPerWeek")?;
        let daily = js_round(weekly / absence_days as f64)?;
        let mut credited = BTreeSet::new();
        for shift in context.shifts {
            if shift.get("deletedAt") != Some(&Value::Null) {
                continue;
            }
            let date = text(shift, "date")?;
            if !date.starts_with(&format!("{}-", context.month))
                || !matches!(text(shift, "type")?, "VACATION" | "SICK")
                || worked_dates.contains(date)
                || credited.contains(date)
            {
                continue;
            }
            if i64::from(parse_date(date)?.weekday().to_monday_one_offset()) <= absence_days
                && !holidays.contains(date)
            {
                credited.insert(date);
            }
        }
        absence = credited.len() as f64 * daily;
    }
    let average = (worked + absence) / workdays as f64;
    let limit = number(working, "nightAverageMinutes")?;
    if average <= limit {
        return Ok(vec![]);
    }
    let window = match context.rules["nightWork"].get("averageWindowDays") {
        Some(Value::Null) => "eines Kalendermonats".into(),
        Some(value) if value.as_i64() == Some(28) => "eines Kalendermonats oder vier Wochen".into(),
        Some(_) => format!(
            "eines Kalendermonats oder {} Tagen",
            integer(&context.rules["nightWork"], "averageWindowDays")?
        ),
        None => return Err(ComplianceError::InvalidInput),
    };
    let description = format!(
        "Der eingetragene Durchschnitt beträgt {} je Werktag bei {workdays} Werktagen. Für Nachtarbeit sind innerhalb {window} durchschnittlich höchstens {} zulässig.",
        duration_label(average)?,
        duration_label(limit)?
    );
    let mut issue = finding(
        context,
        month_end,
        &description,
        extended
            .iter()
            .flat_map(|group| group.iter().map(|item| item.shift.as_ref())),
        None,
    )?;
    issue["assessmentRanges"] = json!([{ "from":month_start.to_string(),"through":add_days(month_end,1)?.to_string() },{"from":format!("{}-01-01",month_start.year()),"through":format!("{}-01-01",month_start.year()+1)}]);
    Ok(vec![issue])
}
pub fn check_night_working_time_average(
    context: &AverageContext<'_>,
) -> Result<Vec<Value>, ComplianceError> {
    if !context.night_worker {
        return Ok(vec![]);
    }
    let start = parse_date(&format!("{}-01", context.month))?;
    let end = add_days(add_months(start, 1)?, -1)?;
    let limit = number(&context.rules["workingTime"], "nightAverageMinutes")?;
    let mut extended = vec![];
    for group in groups(context.intervals)? {
        let date = parse_date(text(&group[0].shift, "date")?)?;
        if date < start || date > end {
            continue;
        }
        let mut night = false;
        for item in &group {
            if is_night_work(item, context.rules)? {
                night = true;
                break;
            }
        }
        if night && group.iter().fold(0.0, |sum, item| sum + item.net_minutes) > limit {
            extended.push(group);
        }
    }
    if extended.is_empty() {
        return Ok(vec![]);
    }
    if context.version < 3 {
        return legacy(context, start, end, &extended);
    }
    let Some(calendar) =
        worked_average(context, start, end)?.filter(|average| average.minutes > limit)
    else {
        return Ok(vec![]);
    };
    for group in extended {
        let date = text(&group[0].shift, "date")?;
        let (deadline, rolling) =
            if context.rules["nightWork"].get("averageWindowDays") == Some(&Value::Null) {
                (end, None)
            } else {
                let days = integer(&context.rules["nightWork"], "averageWindowDays")?;
                let rolling_end = add_days(parse_date(date)?, days - 1)?;
                let Some(average) = worked_average(context, parse_date(date)?, rolling_end)?
                    .filter(|average| average.minutes > limit)
                else {
                    continue;
                };
                (end.max(rolling_end), Some((days, average)))
            };
        let rolling_description = match rolling {
            Some((days, average)) => format!(
                " Im zugehörigen {days}-Tage-Zeitraum sind es {} bei {} Werktagen.",
                duration_label(average.minutes)?,
                average.workdays
            ),
            None => String::new(),
        };
        let description = format!(
            "Im Kalendermonat sind durchschnittlich {} bei {} Werktagen erfasst.{rolling_description} Für Nachtarbeitnehmer sind durchschnittlich höchstens {} zulässig.",
            duration_label(calendar.minutes)?,
            calendar.workdays,
            duration_label(limit)?
        );
        let mut issue = finding(
            context,
            deadline,
            &description,
            group.iter().map(|item| item.shift.as_ref()),
            Some(date),
        )?;
        let mut ranges =
            vec![json!({"from":start.to_string(),"through":add_days(deadline,1)?.to_string()})];
        if context.options.get("regularRotatingNightWork") != Some(&Value::Bool(true)) {
            ranges.push(json!({"from":format!("{}-01-01",start.year()),"through":format!("{}-01-01",start.year()+1)}));
        }
        issue["assessmentRanges"] = json!(ranges);
        return Ok(vec![issue]);
    }
    Ok(vec![])
}
