//! Native JArbSchG daily checks, using source-bound credits and actual intervals.
use super::{PreparedYouthAssessment, TrainingDay, TrainingError, TrainingEvent, YouthSpan};
use crate::{calendar::parse_date, time};
use jiff::Timestamp;
use serde_json::Value;
fn number(value: &Value, key: &str) -> Result<f64, TrainingError> {
    value[key]
        .as_f64()
        .ok_or_else(|| TrainingError::invalid("Ungültiger Ausbildungsregelstand."))
}
pub(super) fn label(value: f64) -> String {
    if value == 0.0 {
        "0".into()
    } else if value.abs() >= 1e21 || value.abs() < 1e-6 {
        let s = format!("{value:e}");
        let (a, b) = s.split_once('e').expect("finite source number");
        let exponent = b.parse::<i32>().expect("formatted exponent");
        format!("{a}e{}{exponent}", if exponent >= 0 { "+" } else { "" })
    } else {
        value.to_string()
    }
}
fn emit(
    events: &mut Vec<TrainingEvent>,
    day: &TrainingDay<'_>,
    code: &'static str,
    message: String,
    section: &'static str,
    incomplete: bool,
) {
    events.push(TrainingEvent {
        day_date: day.date.clone(),
        date: day.date.clone(),
        code,
        severity: if incomplete { "INCOMPLETE" } else { "WARNING" },
        message,
        section,
        shift_ids: day
            .entries
            .iter()
            .map(|e| e.shift()["id"].as_str().expect("native entry id").into())
            .collect(),
    });
}
pub fn check_youth_daily(
    context: &PreparedYouthAssessment<'_>,
) -> Result<Vec<TrainingEvent>, TrainingError> {
    let mut events = vec![];
    if context.days.is_empty() {
        return Ok(events);
    }
    let zone = context.profile["timeZone"]
        .as_str()
        .ok_or_else(super::helpers::temporal)?;
    for day in &context.days {
        let rules = &day.legal.rules()["youthProtection"];
        let facts = day.facts_context;
        if facts["allWorkAndSchoolRecorded"] != true
            || context.profile["allEmploymentWorkRecorded"] != true
        {
            emit(
                &mut events,
                day,
                "SCOPE_INCOMPLETE",
                "Bitte bestätigen, dass sämtliche Beschäftigungen und Schulzeiten erfasst sind."
                    .into(),
                "§ 4 Abs. 5 JArbSchG",
                true,
            );
        }
        if facts["otherExceptions"] != false {
            emit(&mut events,day,"EXCEPTIONS_UNRESOLVED","Individuelle, tarifliche oder besondere Ausnahmen sind nicht abschließend geklärt. Standardregeln allein ergeben keine Freigabe.".into(),"§§ 8, 14, 21–21b JArbSchG",true);
        }
        let mut shorter = false;
        for date in context.shortened_dates(day)? {
            let d = parse_date(date).map_err(|_| super::helpers::temporal())?;
            if date != day.date
                && d.weekday().to_monday_one_offset() <= 6
                && super::week_start(date)? == day.week
            {
                shorter = true;
                break;
            }
        }
        let daily_limit = number(
            &rules["workingTime"],
            if shorter {
                "reducedWeekDailyMinutes"
            } else {
                "dailyMinutes"
            },
        )?;
        if let Some(credit) = context
            .daily
            .get(&day.date)
            .copied()
            .flatten()
            .filter(|credit| *credit > daily_limit)
        {
            emit(
                &mut events,
                day,
                "DAILY_TIME",
                format!(
                    "Die anzurechnende Tageszeit ({} Min.) überschreitet {} Minuten.",
                    label(credit),
                    label(daily_limit)
                ),
                "§§ 8–10 JArbSchG",
                false,
            );
        }
        if day.entries.is_empty() {
            continue;
        }
        let entries = day.entries.iter().collect::<Vec<_>>();
        let unresolved_travel = day
            .school_entries()
            .iter()
            .any(|e| super::located_school_travel(e, &entries).is_none());
        if unresolved_travel {
            emit(&mut events,day,"SCHOOL_TRAVEL_POSITION","Notwendige Schul-/Arbeitswege sind zeitlich nicht verortet. Die Anrechnung ihrer Dauer allein belegt keine Pause oder ununterbrochene Freizeit.".into(),"§§ 9, 11, 13 JArbSchG",true);
        }
        let unresolved_exam = day
            .entries
            .iter()
            .any(|e| e.exam().is_some() && super::located_exam_travel(e, &entries).is_none());
        if unresolved_exam {
            emit(&mut events,day,"EXAM_TRAVEL_POSITION","Notwendige Prüfungswege sind zeitlich nicht verortet oder unbestätigt; Ruhe- und Pausenlage bleiben offen.".into(),"§§ 10, 11, 13 JArbSchG",true);
        }
        if day.entries.iter().any(|e| e.pauses().is_none()) {
            emit(
                &mut events,
                day,
                "PAUSE_DATA_MISSING",
                "Die tatsächliche Pausenlage fehlt oder gehört zu einem älteren Dienststand."
                    .into(),
                "§ 11 JArbSchG",
                true,
            );
        }
        if facts["pausesPredefined"] != true {
            emit(
                &mut events,
                day,
                "PAUSE_PREDETERMINATION_UNKNOWN",
                "Ob die Pausen im Voraus feststanden, ist nicht bestätigt.".into(),
                "§ 11 Abs. 1 JArbSchG",
                true,
            );
        }
        let mut activity = day
            .entries
            .iter()
            .map(|e| super::training_activity_bounds(e, &entries))
            .collect::<Vec<_>>();
        let first = activity
            .iter()
            .map(YouthSpan::start_epoch_milliseconds)
            .min()
            .expect("nonempty native activity");
        let last = activity
            .iter()
            .map(YouthSpan::end_epoch_milliseconds)
            .max()
            .expect("nonempty native activity");
        let shift_span = number(&rules["workingTime"], "shiftSpanMinutes")?;
        if (last - first) as f64 / 60000.0 > shift_span {
            emit(
                &mut events,
                day,
                "SHIFT_SPAN",
                format!(
                    "Die Schichtzeit überschreitet {} Minuten.",
                    label(shift_span)
                ),
                "§ 12 JArbSchG",
                false,
            );
        }
        activity.sort_by_key(YouthSpan::start_epoch_milliseconds);
        if day.entries.iter().all(|e| e.pauses().is_some()) {
            let minimum = number(&rules["breaks"], "minimumSegmentMinutes")?;
            let mut pauses = day
                .entries
                .iter()
                .flat_map(|e| e.pauses().expect("checked pauses"))
                .filter(|p| {
                    p.original_minutes().unwrap_or(
                        (p.end_epoch_milliseconds() - p.start_epoch_milliseconds()) as f64
                            / 60000.0,
                    ) >= minimum
                })
                .cloned()
                .collect::<Vec<_>>();
            if facts["allWorkAndSchoolRecorded"] == true
                && facts["pausesPredefined"] == true
                && !unresolved_travel
                && !unresolved_exam
            {
                let mut end = activity[0].end_epoch_milliseconds();
                for span in activity.iter().skip(1) {
                    if (span.start_epoch_milliseconds() - end) as f64 / 60000.0 >= minimum {
                        pauses.push(super::interval_math::plain(
                            end,
                            span.start_epoch_milliseconds(),
                        ));
                    }
                    end = end.max(span.end_epoch_milliseconds());
                }
            }
            let mut work = day
                .entries
                .iter()
                .flat_map(|e| e.work_spans(minimum))
                .collect::<Vec<_>>();
            for e in day.school_entries() {
                work.extend(super::located_school_travel(e, &entries).unwrap_or_default());
            }
            for e in day.entries.iter().filter(|e| e.exam().is_some()) {
                work.extend(super::located_exam_travel(e, &entries).unwrap_or_default());
            }
            let worked = super::union_minutes(&work);
            let mut required = 0.0;
            for tier in rules["breaks"]["tiers"]
                .as_array()
                .ok_or_else(|| TrainingError::invalid("Ungültiger Ausbildungsregelstand."))?
            {
                if worked > number(tier, "overMinutes")? {
                    required = number(tier, "requiredMinutes")?;
                }
            }
            if super::union_minutes(&pauses) < required {
                emit(
                    &mut events,
                    day,
                    "BREAK_DURATION",
                    format!(
                        "Für die erfasste Arbeitszeit fehlen anrechenbare Pausen: mindestens {} Minuten.",
                        label(required)
                    ),
                    "§ 11 Abs. 1 JArbSchG",
                    false,
                );
            }
            let after_start = number(&rules["breaks"], "afterStartMinutes")?;
            let before_end = number(&rules["breaks"], "beforeEndMinutes")?;
            if pauses.iter().any(|p| {
                (p.start_epoch_milliseconds() - first) as f64 / 60000.0 < after_start
                    || (last - p.end_epoch_milliseconds()) as f64 / 60000.0 < before_end
            }) {
                emit(
                    &mut events,
                    day,
                    "BREAK_POSITION",
                    "Eine Pause liegt zu nah am Beginn oder Ende der täglichen Beschäftigung."
                        .into(),
                    "§ 11 Abs. 2 JArbSchG",
                    false,
                );
            }
            pauses.sort_by_key(YouthSpan::start_epoch_milliseconds);
            let mut cursor = first;
            let continuous = number(&rules["breaks"], "maxContinuousMinutes")?;
            for pause in &pauses {
                if (pause.start_epoch_milliseconds() - cursor) as f64 / 60000.0 > continuous {
                    emit(
                        &mut events,
                        day,
                        "CONTINUOUS_TIME",
                        "Eine Beschäftigungsstrecke ohne anrechenbare Pause ist zu lang.".into(),
                        "§ 11 Abs. 2 JArbSchG",
                        false,
                    );
                    break;
                }
                cursor = cursor.max(pause.end_epoch_milliseconds());
            }
            if (last - cursor) as f64 / 60000.0 > continuous {
                emit(
                    &mut events,
                    day,
                    "CONTINUOUS_TIME",
                    "Eine Beschäftigungsstrecke ohne anrechenbare Pause ist zu lang.".into(),
                    "§ 11 Abs. 2 JArbSchG",
                    false,
                );
            }
        }
        let next_early = context.next_early_school(day)?;
        let minimum_age = number(&rules["employmentWindow"], "multiShiftMinimumAge")?;
        let may_late =
            day.age as f64 >= minimum_age && facts["multiShiftOperation"] == true && !next_early;
        let end_limit = number(
            &rules["employmentWindow"],
            if may_late {
                "multiShiftEndMinute"
            } else {
                "endMinute"
            },
        )?;
        let start_limit = number(&rules["employmentWindow"], "startMinute")?;
        for entry in day.work_entries() {
            let start = super::clock_minutes(entry.start_epoch_milliseconds(), zone)? as f64;
            let end = Timestamp::from_millisecond(entry.end_epoch_milliseconds())
                .map_err(|_| super::helpers::temporal())?
                .to_zoned(time::zone(zone).map_err(|_| super::helpers::temporal())?);
            let end_minute = if end.date().to_string() > day.date {
                1440.0
            } else {
                f64::from(end.hour()) * 60.0 + f64::from(end.minute())
            };
            if start < start_limit || end_minute > end_limit {
                let possible = facts["multiShiftOperation"].is_null()
                    && day.age as f64 >= minimum_age
                    && start >= start_limit
                    && end_minute <= number(&rules["employmentWindow"], "multiShiftEndMinute")?
                    && !next_early;
                emit(&mut events,day,"EMPLOYMENT_WINDOW",if next_early{"Vor einem frühen Berufsschultag endet auch im Mehrschichtbetrieb die zulässige Beschäftigung früher."}else{"Der Dienst liegt außerhalb des anhand der bestätigten Angaben zulässigen Beschäftigungszeitraums."}.into(),"§ 14 JArbSchG",possible);
            }
        }
        for school in day.school_entries() {
            if (super::clock_minutes(school.start_epoch_milliseconds(), zone)? as f64)
                < number(day.school_rules, "earlyStartMinute")?
                && day
                    .work_entries()
                    .iter()
                    .any(|e| e.start_epoch_milliseconds() < school.start_epoch_milliseconds())
            {
                emit(&mut events,day,"WORK_BEFORE_EARLY_SCHOOL","Vor diesem früh beginnenden Berufsschulunterricht ist keine Beschäftigung zulässig.".into(),"§ 9 Abs. 1 Nr. 1 JArbSchG",false);
            }
        }
        for index in 1..activity.len() {
            if activity[..index]
                .iter()
                .any(|e| e.end_epoch_milliseconds() > activity[index].start_epoch_milliseconds())
            {
                emit(&mut events,day,"OVERLAPPING_ENTRIES","Dienst- oder Schulzeiten überschneiden sich. Die Zeitbasis muss geklärt werden.".into(),"§ 4 JArbSchG",true);
            }
        }
    }
    Ok(events)
}
