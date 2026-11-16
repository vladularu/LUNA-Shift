//! Full raw/native Sunday and holiday assessment; prepared facts never cross the host wire.
use super::{
    average::{add_days, add_months, date_label},
    holiday_coverage::{self, truthy},
    issue::{IssueSpec, create_issue},
    model::{ComplianceError, ComplianceInterval, integer, number_label, text},
    profile::ComplianceProfile,
    rest_calendar,
    rest_intervals::RestIntervalIndex,
    rest_kernel::{self, ObligationKind, Output},
};
use crate::{calendar::parse_date, rules::RuleResolver};
use jiff::civil::Date;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
pub struct SundayContext<'a> {
    pub month: &'a str,
    pub intervals: &'a [ComplianceInterval],
    pub shifts: &'a [Arc<Value>],
    pub options: &'a Value,
    pub reference_date: Date,
    pub rules: &'a Value,
    pub resolver: &'a RuleResolver,
    pub version: u32,
    pub time_zone: &'a str,
    pub coverage_start: &'a str,
    pub coverage_end: &'a str,
}
fn issue(
    spec: IssueSpec<'_>,
    ids: &[String],
    pool: &BTreeMap<&str, &Value>,
) -> Result<Value, ComplianceError> {
    let entries = ids
        .iter()
        .map(|id| {
            pool.get(id.as_str())
                .copied()
                .ok_or(ComplianceError::InvalidInput)
        })
        .collect::<Result<Vec<_>, _>>()?;
    create_issue(spec, entries)
}
fn coverage_issue(
    month: &str,
    years: &BTreeSet<i16>,
    related: &[String],
    pool: &BTreeMap<&str, &Value>,
) -> Result<Value, ComplianceError> {
    let description = format!(
        "Für {} fehlt ein gültiges Feiertagspaket. Sonntage werden weiter geprüft; Feiertagsprüfungen sind unvollständig.",
        years
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(", ")
    );
    issue(
        IssueSpec::new(
            "warning",
            "LEGAL",
            "HOLIDAY_CATALOG_COVERAGE",
            "Feiertagskatalog unvollständig",
            &description,
        )
        .on_date(&format!("{month}-01")),
        related,
        pool,
    )
}
fn free_sundays(
    c: &SundayContext<'_>,
    output: &Output,
    pool: &BTreeMap<&str, &Value>,
) -> Result<Vec<Value>, ComplianceError> {
    let first = parse_date(&format!("{}-01-01", &c.month[..4]))?;
    let year = first.year();
    let mut date = first;
    let mut count = 0;
    let mut worked = vec![];
    while date.year() == year {
        if date.weekday().to_monday_one_offset() == 7 {
            count += 1;
            if let Ok(index) = output
                .work_dates
                .binary_search_by_key(&rest_calendar::ordinal(date)?, |w| w.day)
            {
                worked.push((date, &output.work_dates[index].shift_ids));
            }
        }
        date = add_days(date, 1)?;
    }
    let minimum = integer(
        &c.rules["sundayHolidayRest"],
        "minimumFreeSundaysPerCalendarYear",
    )?;
    let permitted = (count - minimum).max(0) as usize;
    let mut issues = vec![];
    for (date, ids) in worked.into_iter().skip(permitted) {
        let completed = date <= c.reference_date;
        let description = format!(
            "Mit diesem Dienst bleiben im Kalenderjahr {year} weniger als {minimum} Sonntage beschäftigungsfrei."
        );
        let mut finding = issue(
            IssueSpec::new(
                if completed { "critical" } else { "warning" },
                "LEGAL",
                "ARBZG_11_FREE_SUNDAYS",
                if completed {
                    "Zu wenige beschäftigungsfreie Sonntage"
                } else {
                    "Mindestzahl freier Sonntage gefährdet"
                },
                &description,
            )
            .on_date(&date.to_string()),
            ids,
            pool,
        )?;
        finding["assessmentRanges"] =
            json!([{ "from":format!("{year}-01-01"),"through":format!("{}-01-01",year+1) }]);
        issues.push(finding);
    }
    Ok(issues)
}
pub fn check_sunday_holiday_rest(c: &SundayContext<'_>) -> Result<Vec<Value>, ComplianceError> {
    check_sunday_holiday_rest_with_profile(
        c,
        c.options
            .get("employmentProfile")
            .map(ComplianceProfile::from_raw),
    )
}
pub(crate) fn check_sunday_holiday_rest_with_profile(
    c: &SundayContext<'_>,
    employment_profile: Option<ComplianceProfile<'_>>,
) -> Result<Vec<Value>, ComplianceError> {
    let Some(rules) = c.rules.get("sundayHolidayRest") else {
        return Ok(vec![]);
    };
    let sector = c
        .options
        .get("sectorId")
        .and_then(Value::as_str)
        .unwrap_or("care");
    if c.version < 5
        || !c
            .options
            .as_object()
            .is_some_and(|o| o.contains_key("federalState"))
        || !rules
            .get("eligibleSectorIds")
            .and_then(Value::as_array)
            .ok_or(ComplianceError::InvalidInput)?
            .iter()
            .any(|v| v.as_str() == Some(sector))
    {
        return Ok(vec![]);
    }
    let state = text(c.options, "federalState")?;
    let region = c
        .options
        .get("holidayRegion")
        .and_then(Value::as_str)
        .unwrap_or("NONE");
    let profile = employment_profile.filter(|v| v.truthy());
    let mut request = rest_calendar::prepare_request(c, &BTreeSet::new())?;
    let mut years = BTreeSet::from([parse_date(&format!("{}-01", c.month))?.year()]);
    for interval in &request.intervals {
        let start = request
            .days
            .partition_point(|d| d.end_ms <= interval.start_ms);
        for day in &request.days[start..] {
            if day.start_ms >= interval.end_ms {
                break;
            }
            years.insert(parse_date(&day.date)?.year());
        }
    }
    for shift in c.shifts {
        years.insert(parse_date(text(shift, "date")?)?.year());
    }
    let coverage = holiday_coverage::known_holidays(&years, state, region, c.resolver, profile)?;
    request.holidays = coverage
        .dates
        .iter()
        .map(|v| rest_calendar::ordinal(parse_date(v)?))
        .collect::<Result<_, ComplianceError>>()?;
    let output = rest_kernel::calculate(&request);
    let mut pool = BTreeMap::new();
    for shift in c.shifts {
        pool.insert(text(shift, "id")?, shift.as_ref());
    }
    for interval in c.intervals {
        pool.insert(text(&interval.shift, "id")?, interval.shift.as_ref());
    }
    let mut issues = vec![];
    if !coverage.missing_years.is_empty() {
        let related = output
            .obligations
            .first()
            .map(|o| o.shift_ids.as_slice())
            .unwrap_or(&[]);
        issues.push(coverage_issue(
            c.month,
            &coverage.missing_years,
            related,
            &pool,
        )?);
    }
    if c.intervals.is_empty() && c.shifts.is_empty() {
        issues.extend(free_sundays(c, &output, &pool)?);
        return Ok(issues);
    }
    let required = request.required_rest_minutes;
    let dated = profile
        .and_then(|p| p.get("employmentTimeline"))
        .and_then(Value::as_array)
        .is_some_and(|rows| rows.iter().any(|r| r.get("employment").is_some_and(truthy)));
    for obligation in output
        .obligations
        .iter()
        .take(if dated { usize::MAX } else { 1 })
    {
        let date = rest_calendar::date(obligation.day)?.to_string();
        let eligible = if let Some(profile) = profile {
            profile.fields_at(&date)?.get("sundayHolidayWorkEligible")
        } else {
            c.options.get("sundayHolidayWorkEligible")
        };
        if eligible == Some(&Value::Bool(true)) {
            continue;
        }
        let forbidden = eligible == Some(&Value::Bool(false));
        issues.push(issue(IssueSpec::new(if forbidden{"critical"}else{"warning"},"LEGAL","ARBZG_10_ELIGIBILITY",if forbidden{"Sonn- oder Feiertagsarbeit nicht als zulässig erfasst"}else{"Zulässigkeit der Sonn- oder Feiertagsarbeit offen"},"Bitte prüfen und bestätigen, ob die erfasste Sonn- oder Feiertagsarbeit unter eine Ausnahme nach § 10 ArbZG oder eine andere wirksame Ausnahme fällt.").on_date(&date),&obligation.shift_ids,&pool)?);
    }
    for index in &output.unmatched {
        let obligation = &output.obligations[*index];
        let date = rest_calendar::date(obligation.day)?;
        let start = rest_calendar::date(obligation.window_start)?;
        let end = rest_calendar::date(obligation.window_end)?;
        let overdue = c.reference_date > end;
        let sunday = obligation.kind == ObligationKind::Sunday;
        let days = if sunday {
            request.sunday_period_days
        } else {
            request.holiday_period_days
        };
        let title = match (overdue, sunday) {
            (true, true) => "Ersatzruhetag für Sonntagsarbeit fehlt",
            (true, false) => "Ersatzruhetag für Feiertagsarbeit fehlt",
            (false, true) => "Ersatzruhetag für Sonntagsarbeit offen",
            (false, false) => "Ersatzruhetag für Feiertagsarbeit offen",
        };
        let description = format!(
            "Für die Beschäftigung am {} ist innerhalb eines den Beschäftigungstag einschließenden Zeitraums von {days} Tagen ein arbeitsfreier Werktag als Ersatzruhetag erforderlich. Tage ohne Arbeitseintrag werden als arbeitsfrei gewertet. Der mögliche Zuordnungsbereich reicht vom {} bis {}.",
            date_label(date),
            date_label(start),
            date_label(end)
        );
        issues.push(issue(
            IssueSpec::new(
                if overdue { "critical" } else { "warning" },
                "LEGAL",
                if sunday {
                    "ARBZG_11_SUNDAY_REST"
                } else {
                    "ARBZG_11_HOLIDAY_REST"
                },
                title,
                &description,
            )
            .on_date(&date.to_string()),
            &obligation.shift_ids,
            &pool,
        )?);
    }
    for matched in &output.matched {
        let candidate = &output.candidates[matched.candidate_index];
        if candidate
            .observed_rest_minutes
            .is_some_and(|v| v >= required)
        {
            continue;
        }
        let obligation = &output.obligations[matched.obligation_index];
        let date = rest_calendar::date(candidate.day)?;
        let description = if let Some(minutes) = candidate.observed_rest_minutes {
            format!(
                "Der Ersatzruhetag am {} ist mit {} Stunden erfasster zusammenhängender Ruhe kürzer als die regulären {} Stunden aus Ersatzruhetag und §-5-Ruhezeit. Prüfen, ob technische oder arbeitsorganisatorische Gründe nach § 11 Abs. 4 ArbZG entgegenstehen.",
                date_label(date),
                number_label(minutes as f64 / 60.0)?,
                number_label(required as f64 / 60.0)?
            )
        } else {
            format!(
                "Für den Ersatzruhetag am {} reicht der geladene Zeitraum nicht aus, um die Verbindung mit der §-5-Ruhezeit nachzuweisen.",
                date_label(date)
            )
        };
        let mut ids = obligation.shift_ids.clone();
        ids.extend(candidate.evidence_shift_ids.iter().cloned());
        issues.push(issue(
            IssueSpec::new(
                "warning",
                "LEGAL",
                "ARBZG_11_REST_CONNECTION",
                "Verbindung des Ersatzruhetags prüfen",
                &description,
            )
            .on_date(&rest_calendar::date(obligation.day)?.to_string()),
            &ids,
            &pool,
        )?);
    }
    let start = parse_date(&format!("{}-01", c.month))?;
    let end = add_days(add_months(start, 1)?, -1)?;
    let index = RestIntervalIndex::new(c.intervals);
    let mut date = start;
    while date <= end {
        let day = rest_calendar::ordinal(date)?;
        if output
            .work_dates
            .binary_search_by_key(&day, |w| w.day)
            .is_err()
            && (rest_calendar::sunday(day) || coverage.dates.contains(&date.to_string()))
        {
            let (from, through) = rest_calendar::bounds(date, c.time_zone)?;
            if let Some(rest) = index.observed_rest(from, through).filter(|v| *v < required) {
                let description = format!(
                    "Die arbeitsfreie Sonn- oder Feiertagsruhe am {} ist mit {} Stunden erfasster zusammenhängender Ruhe kürzer als die regulären {} Stunden einschließlich §-5-Ruhezeit.",
                    date_label(date),
                    number_label(rest as f64 / 60.0)?,
                    number_label(required as f64 / 60.0)?
                );
                issues.push(issue(
                    IssueSpec::new(
                        "warning",
                        "LEGAL",
                        "ARBZG_11_REST_CONNECTION",
                        "Verbindung der Sonn- oder Feiertagsruhe prüfen",
                        &description,
                    )
                    .on_date(&date.to_string()),
                    &[],
                    &pool,
                )?);
            }
        }
        if date == end {
            break;
        }
        date = add_days(date, 1)?;
    }
    issues.extend(free_sundays(c, &output, &pool)?);
    Ok(issues)
}
