//! Statutory per-day and rest checks over native prepared intervals.
use super::{
    issue::{IssueSpec, create_issue, german_quantity},
    model::{
        ComplianceError, ComplianceInterval, array, integer, is_night_work, js_round,
        minutes_between, number, number_label, text,
    },
    sequences::{self, RestDeviation},
    split::{self, SplitDutyBreakCheck},
};
use crate::{EngineError, calendar::parse_date};
use jiff::{ToSpan, civil::Date};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn hours(minutes: f64) -> Result<String, ComplianceError> {
    Ok(format!(
        "{} h",
        number_label(js_round((minutes / 60.0) * 100.0)? / 100.0)?
    ))
}
fn date_label(date: Date) -> String {
    format!("{:02}.{:02}.{}", date.day(), date.month(), date.year())
}

pub fn check_duplicates(intervals: &[ComplianceInterval]) -> Result<Vec<Value>, ComplianceError> {
    let mut seen = BTreeMap::new();
    let mut issues = Vec::new();
    for item in intervals {
        let shift = item.shift.as_ref();
        let pause = number(shift, "breakMinutes")?;
        let key = (
            text(shift, "date")?,
            text(shift, "startTime")?,
            text(shift, "endTime")?,
            if pause == 0.0 { 0 } else { pause.to_bits() },
            text(shift, "type")?,
        );
        if let Some(previous) = seen.get(&key) {
            issues.push(create_issue(IssueSpec::new("critical","LEGAL","DATA_DUPLICATE","Doppelter Kalendereintrag","Derselbe Dienst wurde mit identischer Zeit, Pause und Dienstart mehrfach erfasst."),[*previous,shift])?);
        } else {
            seen.insert(key, shift);
        }
    }
    Ok(issues)
}
pub fn check_overlaps(intervals: &[ComplianceInterval]) -> Result<Vec<Value>, ComplianceError> {
    let mut issues = Vec::new();
    for pair in intervals.windows(2) {
        let current = &pair[0];
        let next = &pair[1];
        let duplicate = current.start.timestamp() == next.start.timestamp()
            && current.end.timestamp() == next.end.timestamp()
            && number(&current.shift, "breakMinutes")? == number(&next.shift, "breakMinutes")?
            && text(&current.shift, "type")? == text(&next.shift, "type")?;
        if !duplicate && next.start.timestamp() < current.end.timestamp() {
            issues.push(create_issue(
                IssueSpec::new(
                    "critical",
                    "LEGAL",
                    "SHIFT_OVERLAP",
                    "Dienste überschneiden sich",
                    "Zwei arbeitszeitrelevante Einträge liegen zeitlich übereinander.",
                ),
                [current.shift.as_ref(), next.shift.as_ref()],
            )?);
        }
    }
    Ok(issues)
}

fn continuous_work_over_threshold(
    items: &[&ComplianceInterval],
    threshold: f64,
    minimum_segment: i64,
) -> Result<bool, ComplianceError> {
    let mut block: Option<(&jiff::Zoned, &jiff::Zoned)> = None;
    for item in items {
        if number(&item.shift, "breakMinutes")? > 0.0 {
            block = None;
            continue;
        }
        let replace = match block {
            None => true,
            Some((_, end)) => minutes_between(end, &item.start)? >= minimum_segment as f64,
        };
        if replace {
            block = Some((&item.start, &item.end));
        } else if let Some((start, end)) = block
            && item.end.timestamp() > end.timestamp()
        {
            block = Some((start, &item.end));
        }
        if let Some((start, end)) = block
            && minutes_between(start, end)? > threshold
        {
            return Ok(true);
        }
    }
    Ok(false)
}
pub fn check_working_time(
    intervals: &[ComplianceInterval],
    rules: &Value,
    version: u32,
    night_worker: bool,
    split_check: &SplitDutyBreakCheck,
) -> Result<Vec<Value>, ComplianceError> {
    let mut issues = Vec::new();
    let groups = split::work_groups_by_recorded_date(intervals)?;
    if groups.is_empty() {
        return Ok(issues);
    }
    let tiers = array(&rules["breaks"], "tiers")?
        .iter()
        .map(|tier| {
            Ok((
                number(tier, "overMinutes")?,
                number(tier, "requiredMinutes")?,
            ))
        })
        .collect::<Result<Vec<_>, ComplianceError>>()?;
    let continuous_threshold = tiers
        .iter()
        .map(|tier| tier.0)
        .reduce(f64::min)
        .ok_or(ComplianceError::InvalidInput)?;
    let minimum_segment = integer(&rules["breaks"], "minimumSegmentMinutes")?;
    let maximum = number(&rules["workingTime"], "maxDailyMinutes")?;
    let standard = number(&rules["workingTime"], "standardDailyMinutes")?;
    let gross_warning = number(&rules["workingTime"], "grossPlanningWarningMinutes")?;
    for items in groups {
        let shifts = items
            .iter()
            .map(|item| item.shift.as_ref())
            .collect::<Vec<_>>();
        let date = text(shifts.last().ok_or(ComplianceError::InvalidInput)?, "date")?;
        let net = items.iter().fold(0.0, |sum, item| sum + item.net_minutes);
        let mut contains_night = false;
        for item in &items {
            if is_night_work(item, rules)? {
                contains_night = true;
                break;
            }
        }
        let interruptions =
            split::interruption_minutes(&items, minimum_segment, split_check, intervals)?;
        let recorded = shifts.iter().try_fold(0.0, |sum, shift| {
            number(shift, "breakMinutes").map(|pause| sum + pause)
        })? + interruptions.planned;
        if net > maximum {
            issues.push(create_issue(
                IssueSpec::new(
                    "critical",
                    "LEGAL",
                    "ARBZG_3_MAX_10H",
                    "Tagesarbeitszeit über 10 Stunden",
                    &format!(
                        "{} Nettoarbeitszeit überschreiten die {}-Stunden-Grenze.",
                        hours(net)?,
                        number_label(maximum / 60.0)?
                    ),
                )
                .on_date(date)
                .with_facts(
                    &json!({"rule":"ARBZG_3_MAX_10H","netMinutes":net,"maximumMinutes":maximum}),
                ),
                shifts.iter().copied(),
            )?);
        } else if version < 4 && net > standard && !(contains_night && night_worker) {
            issues.push(create_issue(
                IssueSpec::new(
                    "warning",
                    "LEGAL",
                    "ARBZG_3_OVER_8H",
                    "Tagesarbeitszeit über 8 Stunden",
                    &format!(
                        "{} Nettoarbeitszeit erfordern einen zulässigen Ausgleichszeitraum.",
                        hours(net)?
                    ),
                )
                .on_date(date)
                .with_facts(&json!({"rule":"ARBZG_3_OVER_8H","netMinutes":net})),
                shifts.iter().copied(),
            )?);
        }
        let required = tiers.iter().fold(0.0_f64, |required, (over, minutes)| {
            if net > *over {
                required.max(*minutes)
            } else {
                required
            }
        });
        if recorded < required {
            if recorded + interruptions.unconfirmed >= required {
                issues.push(create_issue(IssueSpec::new("warning","LEGAL","ARBZG_4_INTERRUPTION","Unterbrechung als Pause prüfen",&format!("{} Minuten zwischen Diensten könnten die fehlende Pause abdecken. Bitte die tatsächliche Pausenlage prüfen.",number_label(interruptions.unconfirmed)?)).on_date(date).with_facts(&json!({"rule":"ARBZG_4_INTERRUPTION","interruptionMinutes":interruptions.unconfirmed})),shifts.iter().copied())?);
            } else {
                issues.push(create_issue(IssueSpec::new("critical","LEGAL","ARBZG_4_BREAK","Pause zu kurz",&format!("{} sind {} Minuten Pause; erforderlich sind mindestens {} Minuten.",if interruptions.planned>0.0{"Berücksichtigt"}else{"Erfasst"},number_label(recorded)?,number_label(required)?)).on_date(date).with_facts(&json!({"rule":"ARBZG_4_BREAK","recordedBreakMinutes":recorded,"requiredBreakMinutes":required})),shifts.iter().copied())?);
            }
        }
        if continuous_work_over_threshold(&items, continuous_threshold, minimum_segment)? {
            let label = german_quantity(continuous_threshold / 60.0, false)?;
            issues.push(create_issue(IssueSpec::new("critical","LEGAL","ARBZG_4_CONTINUOUS",&format!("Mehr als {label} Stunden ohne dokumentierte Pause"),&format!("Ein zusammenhängender Arbeitsblock überschreitet {label} Stunden ohne dokumentierte Ruhepause.")).on_date(date).with_facts(&json!({"rule":"ARBZG_4_CONTINUOUS","maximumContinuousMinutes":continuous_threshold})),shifts.iter().copied())?);
        }
        for item in items {
            let pause = number(&item.shift, "breakMinutes")?;
            if pause > item.gross_minutes {
                issues.push(create_issue(IssueSpec::new("critical","LEGAL","TIME_PLAUSIBILITY","Pause länger als Dienst","Die eingetragene Pause ist länger als die gesamte Brutto-Dienstzeit.").with_facts(&json!({"rule":"TIME_PLAUSIBILITY","breakMinutes":pause,"grossMinutes":item.gross_minutes})),[item.shift.as_ref()])?);
            }
            if item.gross_minutes > gross_warning {
                issues.push(create_issue(IssueSpec::new("warning","PLANNING","TIME_GROSS_OVER_16H","Dienst länger als 16 Stunden",&format!("Die Brutto-Dienstzeit beträgt {} und sollte auf einen Eingabefehler geprüft werden.",hours(item.gross_minutes)?)).with_facts(&json!({"rule":"TIME_GROSS_OVER_16H","grossMinutes":item.gross_minutes})),[item.shift.as_ref()])?);
            }
        }
    }
    Ok(issues)
}
pub fn check_rest_and_sequence(
    intervals: &[ComplianceInterval],
    reference: Date,
    rules: &Value,
    sector: &str,
) -> Result<Vec<Value>, ComplianceError> {
    let mut issues = Vec::new();
    let periods = sequences::rest_periods(intervals)?;
    let mut selected = None;
    for candidate in array(&rules["restPeriod"], "deviations")? {
        if array(candidate, "sectorIds")?
            .iter()
            .any(|value| value == sector)
        {
            selected = Some(candidate);
            break;
        }
    }
    let deviation = selected
        .map(|value| -> Result<RestDeviation, ComplianceError> {
            Ok(RestDeviation {
                minimum_minutes: integer(value, "minimumMinutes")?,
                compensation_minutes: integer(value, "compensationMinutes")?,
                compensation_within_days: integer(value, "compensationWithinDays")?,
                compensation_within_calendar_months: value
                    .get("compensationWithinCalendarMonths")
                    .filter(|value| !value.is_null())
                    .map(|_| integer(value, "compensationWithinCalendarMonths"))
                    .transpose()?,
            })
        })
        .transpose()?;
    let default = integer(&rules["restPeriod"], "defaultMinutes")?;
    let minimum = deviation
        .as_ref()
        .map_or(default, |deviation| deviation.minimum_minutes);
    let compensated =
        sequences::compensated_short_rest_indexes(&periods, deviation.as_ref(), default)?;
    for (index, period) in periods.iter().enumerate() {
        let current = period.current;
        let next = period.next;
        let rest = period.minutes;
        if rest < 0.0 {
            continue;
        }
        if rest < minimum as f64 {
            issues.push(create_issue(IssueSpec::new("critical","LEGAL","ARBZG_5_REST_10H",&format!("Ruhezeit unter {} Stunden",number_label(minimum as f64/60.0)?),&format!("Zwischen den Diensten liegen nur {} Ruhezeit. Damit wird auch die für Krankenhäuser und Pflegeeinrichtungen mögliche Verkürzung auf {} Stunden unterschritten.",hours(rest)?,number_label(minimum as f64/60.0)?)).with_facts(&json!({"rule":"ARBZG_5_REST_10H","restMinutes":rest,"minimumRestMinutes":minimum})),[current.shift.as_ref(),next.shift.as_ref()])?);
        } else if let Some(deviation) = deviation.as_ref()
            && rest < default as f64
            && !compensated.contains(&index)
        {
            let day = next
                .start
                .date()
                .checked_add(deviation.compensation_within_days.days())
                .map_err(|_| EngineError::InvalidDate)?;
            let month = next
                .start
                .date()
                .checked_add(
                    deviation
                        .compensation_within_calendar_months
                        .unwrap_or(0)
                        .months(),
                )
                .map_err(|_| EngineError::InvalidDate)?;
            let deadline = day.max(month);
            let overdue = reference > deadline;
            issues.push(create_issue(IssueSpec::new(if overdue{"critical"}else{"warning"},"LEGAL","ARBZG_5_REST_11H",if overdue{"Ausgleich für verkürzte Ruhezeit fehlt"}else{"Ausgleich für verkürzte Ruhezeit offen"},&format!("Die Ruhezeit beträgt {}. In den eingetragenen Diensten wurde bis {} keine noch unbenutzte Ruhezeit von mindestens {} Stunden als Ausgleich erkannt.",hours(rest)?,date_label(deadline),number_label(deviation.compensation_minutes as f64/60.0)?)).with_facts(&json!({"rule":"ARBZG_5_REST_11H","restMinutes":rest,"compensationMinutes":deviation.compensation_minutes,"compensationDeadline":deadline.to_string()})),[current.shift.as_ref(),next.shift.as_ref()])?);
        } else if rest >= default as f64
            && current.shift["type"] == "LATE"
            && next.shift["type"] == "EARLY"
        {
            let expected = parse_date(text(&current.shift, "date")?)?
                .checked_add(integer(&rules["planning"], "lateEarlyDayGap")?.days())
                .map_err(|_| EngineError::InvalidDate)?;
            if parse_date(text(&next.shift, "date")?)? == expected {
                issues.push(create_issue(IssueSpec::new("warning","PLANNING","PLANNING_LATE_EARLY","Ungünstige Folge Spät zu Früh","Die gesetzliche Ruhezeit ist eingehalten; die kurze Vorwärtsrotation sollte dennoch geprüft werden.").with_facts(&json!({"rule":"PLANNING_LATE_EARLY"})),[current.shift.as_ref(),next.shift.as_ref()])?);
            }
        }
    }
    Ok(issues)
}
