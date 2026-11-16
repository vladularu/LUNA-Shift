use super::days::YouthDay;
use crate::{
    EngineError,
    calendar::parse_date,
    compliance::{
        average::add_days,
        issue::{IssueSpec, create_issue},
        model::{ComplianceError, ComplianceInterval, js_round, number},
    },
    rules::{
        RuleResolver,
        holidays::{easter_sunday, holiday_calendar},
    },
};
use jiff::{ToSpan, civil::Time, tz::Disambiguation};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
fn unique_intervals<'a>(week: &[&YouthDay<'a>]) -> Vec<&'a ComplianceInterval> {
    let mut result = Vec::new();
    let mut seen = BTreeSet::new();
    for day in week {
        for item in &day.intervals {
            if seen.insert(*item as *const ComplianceInterval as usize) {
                result.push(*item);
            }
        }
    }
    result
}
fn week_minutes(week: &[&YouthDay<'_>]) -> Result<f64, ComplianceError> {
    let date = parse_date(&week[0].date)?;
    let monday = add_days(date, 1 - i64::from(date.weekday().to_monday_one_offset()))?;
    let intervals = unique_intervals(week);
    let mut parts = Vec::new();
    for item in &intervals {
        let from = item
            .start
            .time_zone()
            .to_ambiguous_zoned(monday.to_datetime(Time::midnight()))
            .disambiguate(Disambiguation::Compatible)
            .map_err(|_| EngineError::InvalidTime)?;
        let through = from
            .checked_add(7.days())
            .map_err(|_| EngineError::InvalidTime)?;
        let start = item.start.timestamp().max(from.timestamp());
        let end = item.end.timestamp().min(through.timestamp());
        if start < end {
            parts.push((start.as_millisecond(), end.as_millisecond()));
        }
    }
    parts.sort_by_key(|p| p.0);
    let Some(first) = parts.first() else {
        return Ok(0.0);
    };
    let mut end = first.1;
    let mut gross = (end - first.0) as f64 / 60_000.0;
    for part in &parts[1..] {
        gross += ((part.1 - part.0.max(end)) as f64 / 60_000.0).max(0.0);
        end = end.max(part.1);
    }
    let mut pauses = 0.0;
    for item in intervals {
        pauses += number(&item.shift, "breakMinutes")?;
    }
    Ok((js_round(gross)? - pauses).max(0.0))
}
fn weekly(month: &str, days: &[YouthDay<'_>]) -> Result<Vec<Value>, ComplianceError> {
    let prefix = format!("{month}-");
    let mut weeks = BTreeMap::<String, Vec<&YouthDay<'_>>>::new();
    for day in days.iter().filter(|d| d.work > 0.0) {
        let date = parse_date(&day.date)?;
        let monday =
            add_days(date, 1 - i64::from(date.weekday().to_monday_one_offset()))?.to_string();
        weeks.entry(monday).or_default().push(day);
    }
    let mut findings = Vec::new();
    for week in weeks.values() {
        let Some(display) = week.iter().rev().find(|d| d.date.starts_with(&prefix)) else {
            continue;
        };
        let mut related = Vec::new();
        let mut seen = BTreeSet::new();
        for day in week {
            for item in &day.intervals {
                if seen.insert(Arc::as_ptr(&item.shift) as usize) {
                    related.push(item.shift.as_ref());
                }
            }
        }
        if week_minutes(week)? > 2400.0 {
            findings.push(create_issue(IssueSpec::new("warning","LEGAL","JARBSCHG_8_WEEK","Mehr als 40 Wochenstunden","Die erfassten Dienste überschreiten 40 Stunden in der Woche von Montag bis Sonntag. Das ist die reguläre Grenze für Jugendliche; Feiertagsbrücken brauchen einen besonderen Ausgleich (§ 8). Nicht erfasste Arbeit und anzurechnende Feiertagsstunden können hinzukommen.").on_date(&display.date),related.iter().copied())?);
        }
        if week.len() > 5 {
            findings.push(create_issue(IssueSpec::new("warning","LEGAL","JARBSCHG_15_FIVE_DAYS","Mehr als 5 Arbeitstage in einer Woche","Jugendliche dürfen regulär an höchstens fünf Tagen von Montag bis Sonntag arbeiten (§ 15). Auch Dienste über Mitternacht berühren beide Kalendertage.").on_date(&display.date),related.iter().copied())?);
        }
    }
    Ok(findings)
}
fn holidays(
    month: &str,
    days: &[YouthDay<'_>],
    options: &Value,
    resolver: &RuleResolver,
) -> Result<Vec<Value>, ComplianceError> {
    let first = parse_date(&format!("{month}-01"))?;
    let year = i32::from(first.year());
    let prefix = format!("{month}-");
    let protected = BTreeSet::from([
        format!("{year}-01-01"),
        format!("{year}-05-01"),
        format!("{year}-12-25"),
        easter_sunday(year)?,
    ]);
    let state = options
        .get("federalState")
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty());
    let calendar = state
        .map(|state| {
            holiday_calendar(
                year,
                state,
                options
                    .get("holidayRegion")
                    .and_then(Value::as_str)
                    .unwrap_or("NONE"),
                resolver,
            )
        })
        .transpose()?;
    let mut findings = Vec::new();
    for day in days
        .iter()
        .filter(|d| d.date.starts_with(&prefix) && d.work > 0.0)
    {
        let date = parse_date(&day.date)?;
        let related = || day.intervals.iter().map(|v| v.shift.as_ref());
        let mut afternoon = false;
        if day.date == format!("{year}-12-24") || day.date == format!("{year}-12-31") {
            for item in &day.intervals {
                let boundary = item
                    .start
                    .time_zone()
                    .to_ambiguous_zoned(date.at(14, 0, 0, 0))
                    .disambiguate(Disambiguation::Compatible)
                    .map_err(|_| EngineError::InvalidTime)?;
                let end = boundary
                    .start_of_day()
                    .and_then(|z| z.checked_add(1.days()))
                    .map_err(|_| EngineError::InvalidTime)?;
                let from = boundary.timestamp().max(item.start.timestamp());
                let to = item.end.timestamp().min(end.timestamp());
                if (to.as_millisecond() - from.as_millisecond()) as f64 / 60_000.0
                    > number(&item.shift, "breakMinutes")?
                {
                    afternoon = true;
                    break;
                }
            }
        }
        if protected.contains(&day.date) || afternoon {
            findings.push(create_issue(IssueSpec::new("warning","LEGAL","JARBSCHG_18_PROTECTED","Geschützter Feiertag für Jugendliche","An Neujahr, am 1. Mai, Ostersonntag und am 25. Dezember dürfen Jugendliche regulär auch in Krankenhäusern nicht arbeiten. Am 24. und 31. Dezember gilt dies nach 14 Uhr (§ 18).").on_date(&day.date),related())?);
        } else if let Some(holiday) = calendar
            .as_ref()
            .and_then(|c| c.entries().iter().find(|h| h.date == day.date))
        {
            findings.push(create_issue(IssueSpec::new("info","LEGAL","JARBSCHG_18_HOLIDAY","Feiertagsdienst für Jugendliche prüfen",&format!("{}: Arbeit ist nur mit gesetzlicher Ausnahme zulässig, etwa in Krankenhäusern oder entsprechenden Pflegeeinrichtungen. Für einen Feiertagsdienst an einem Werktag ist ein anderer berufsschulfreier Arbeitstag derselben oder der folgenden Woche als Ausgleich nötig (§ 18).",holiday.name)).on_date(&day.date),related())?);
        } else if date.weekday().to_monday_one_offset() >= 6 {
            findings.push(create_issue(IssueSpec::new("info","LEGAL","JARBSCHG_16_17_WEEKEND","Wochenenddienst für Jugendliche prüfen","Samstags- und Sonntagsarbeit ist nur mit gesetzlicher Ausnahme zulässig, etwa in Krankenhäusern oder entsprechenden Pflegeeinrichtungen. Zum Ausgleich muss ein anderer berufsschulfreier Arbeitstag derselben Woche frei bleiben. Zwei Samstage im Monat sollen, mindestens zwei Sonntage müssen frei sein (§§ 16–17).").on_date(&day.date),related())?);
        }
    }
    let sunday_work = days
        .iter()
        .filter(|d| {
            d.date.starts_with(&prefix)
                && d.work > 0.0
                && parse_date(&d.date).is_ok_and(|d| d.weekday().to_monday_one_offset() == 7)
        })
        .collect::<Vec<_>>();
    let mut sundays = 0;
    for day in 1..=first.days_in_month() {
        if first
            .with()
            .day(day)
            .build()
            .map_err(|_| EngineError::InvalidDate)?
            .weekday()
            .to_monday_one_offset()
            == 7
        {
            sundays += 1;
        }
    }
    if sunday_work.len() > sundays - 2 {
        findings.push(create_issue(IssueSpec::new("warning","LEGAL","JARBSCHG_17_FREE_SUNDAYS","Mindestens 2 freie Sonntage nötig","Die erfassten Dienste lassen in diesem Monat weniger als zwei Sonntage frei. Mindestens zwei müssen beschäftigungsfrei bleiben, auch bei einer zulässigen Ausnahme (§ 17).").on_date(&sunday_work.last().ok_or(ComplianceError::InvalidInput)?.date),sunday_work.iter().flat_map(|d|&d.intervals).map(|v|v.shift.as_ref()))?);
    }
    if let Some(day) = days.iter().find(|d| d.date.starts_with(&prefix))
        && (state.is_none() || options["holidayRegion"] == "UNKNOWN")
    {
        findings.push(create_issue(IssueSpec::new("info","LEGAL","JARBSCHG_HOLIDAY_LOCATION","Regionale Feiertage nicht vollständig geprüft","Für örtlich unterschiedliche Feiertage fehlt eine eindeutige Region. Bundesweit geschützte Tage werden trotzdem geprüft.").on_date(&day.date),[])?);
    }
    Ok(findings)
}
pub(super) fn findings(
    month: &str,
    days: &[YouthDay<'_>],
    options: &Value,
    resolver: &RuleResolver,
) -> Result<Vec<Value>, ComplianceError> {
    let mut result = weekly(month, days)?;
    result.extend(holidays(month, days, options, resolver)?);
    Ok(result)
}
