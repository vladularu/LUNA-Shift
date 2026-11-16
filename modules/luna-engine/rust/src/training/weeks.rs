//! Source-exact youth week, weekend, holiday and replacement-day checks.
use super::{PreparedYouthAssessment, TrainingDay, TrainingError, TrainingEvent};
use crate::{calendar::parse_date, rules::holidays};
use jiff::ToSpan;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
fn number(v: &Value, key: &str) -> Result<f64, TrainingError> {
    v[key]
        .as_f64()
        .ok_or_else(|| TrainingError::invalid("Ungültiger Ausbildungsregelstand."))
}
fn ids(day: &TrainingDay<'_>) -> Vec<String> {
    day.entries
        .iter()
        .map(|e| e.shift()["id"].as_str().expect("native entry id").into())
        .collect()
}
fn event(
    day: &TrainingDay<'_>,
    code: &'static str,
    severity: &'static str,
    message: String,
    section: &'static str,
    shift_ids: Vec<String>,
) -> TrainingEvent {
    TrainingEvent {
        day_date: day.date.clone(),
        date: day.date.clone(),
        code,
        severity,
        message,
        section,
        shift_ids,
    }
}
fn has(v: &Value, key: &str, text: &str) -> bool {
    v[key]
        .as_array()
        .expect("validated day-off rule")
        .iter()
        .any(|v| v == text)
}
pub fn check_youth_weekly(
    context: &PreparedYouthAssessment<'_>,
) -> Result<Vec<TrainingEvent>, TrainingError> {
    let mut out = vec![];
    let released = context
        .days
        .iter()
        .flat_map(|d| d.entries.iter())
        .filter_map(|e| {
            let exam = e.exam()?;
            (exam["kind"] == "EXAM" && exam["finalWritten"] == true)
                .then(|| exam["precedingWorkDate"].as_str())
                .flatten()
        })
        .collect::<BTreeSet<_>>();
    let mut weeks = BTreeMap::<&str, Vec<&TrainingDay<'_>>>::new();
    for day in &context.days {
        weeks.entry(&day.week).or_default().push(day);
    }
    let months = context
        .days
        .iter()
        .map(|d| d.date[..7].to_owned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let state = context.profile["federalState"]
        .as_str()
        .ok_or_else(|| TrainingError::invalid("Ungültiges Bundesland für die Jugendprüfung."))?;
    let region = match context.profile.get("holidayRegion") {
        None => "NONE",
        Some(Value::String(v)) => v,
        _ => {
            return Err(TrainingError::invalid(
                "Ungültige Feiertagsregion für die Jugendprüfung.",
            ));
        }
    };
    let holidays =
        holidays::resolve_holiday_map_for_months(&months, state, region, context.resolver)
            .map_err(|_| {
                TrainingError::invalid("Feiertagsregeln für die Jugendprüfung sind ungültig.")
            })?;
    if holidays.status == "UNAVAILABLE" {
        for day in context
            .days
            .iter()
            .filter(|d| d.date.starts_with(&context.month))
        {
            out.push(event(
                day,
                "HOLIDAY_RULES_MISSING",
                "INCOMPLETE",
                "Feiertagsregeln sind für den Prüfzeitraum nicht vollständig verfügbar.".into(),
                "§§ 4, 18 JArbSchG",
                vec![],
            ));
        }
    }
    // byDate membership is a mandatory later Source predicate. Apply it once
    // here so the candidate set is bounded by prepared days rather than all SQL.
    let free = context
        .raw_shifts
        .iter()
        .filter(|s| s.get("deletedAt").is_some_and(Value::is_null) && s["type"] == "FREE")
        .filter_map(|s| {
            let date = s["date"].as_str()?;
            context
                .day_for_date(date)
                .filter(|d| d.entries.is_empty())
                .map(|_| date)
        })
        .collect::<BTreeSet<_>>();
    let mut replacements = vec![];
    for day in &context.days {
        let d = parse_date(&day.date).map_err(|_| super::helpers::temporal())?;
        let dow = d.weekday().to_monday_one_offset();
        let holiday = holidays.holidays.contains_key(&day.date);
        if day.entries.is_empty() {
            continue;
        }
        let rules = &day.legal.rules()["youthProtection"]["daysOff"];
        if day.entries.iter().any(|e| e.exam().is_some()) && (dow >= 6 || holiday) {
            out.push(event(day,"EXAM_NONWORKDAY_REVIEW","INCOMPLETE","Für eine externe Prüfung an Wochenenden oder Feiertagen ist die Zulässigkeit nicht allein aus der Einrichtungskategorie ableitbar.".into(),"§§ 10, 16–18 JArbSchG",ids(day)));
        }
        if has(rules, "absoluteFixedHolidays", &day.date[5..])
            || (rules["easterSundayProhibited"] == true
                && day.date
                    == holidays::easter_sunday(i32::from(d.year()))
                        .map_err(|_| super::helpers::temporal())?)
        {
            out.push(event(day,"ABSOLUTE_HOLIDAY","WARNING","An diesem besonders geschützten Feiertag greift die normale Einrichtungs-Ausnahme nicht.".into(),"§ 18 Abs. 2 JArbSchG",ids(day)));
        }
        if has(rules, "shortEveDays", &day.date[5..]) {
            let limit = number(rules, "shortEveEndMinute")?;
            let zone = context.profile["timeZone"]
                .as_str()
                .ok_or_else(super::helpers::temporal)?;
            let mut over = false;
            for e in &day.entries {
                if super::clock_minutes(e.end_epoch_milliseconds() - 1, zone)? as f64 >= limit {
                    over = true;
                    break;
                }
            }
            if over {
                out.push(event(day,"HOLIDAY_EVE","WARNING","Die Beschäftigung reicht in den geschützten Zeitraum am Heiligabend oder Silvester.".into(),"§ 18 Abs. 1 JArbSchG",ids(day)));
            }
        }
        if dow >= 6 || holiday {
            let facts = day.facts_context;
            let allowed =
                facts["careInstitution"] == true || facts["medicalEmergencyService"] == true;
            let known =
                !facts["careInstitution"].is_null() && !facts["medicalEmergencyService"].is_null();
            if !allowed {
                out.push(event(day,"WEEKEND_ELIGIBILITY",if known{"WARNING"}else{"INCOMPLETE"},"Die erforderliche Tätigkeitsbereich-Ausnahme für diese Wochenend-/Feiertagsarbeit ist nicht bestätigt.".into(),if holiday{"§ 18 JArbSchG"}else if dow==6{"§ 16 JArbSchG"}else{"§ 17 JArbSchG"},ids(day)));
            }
            let following = if holiday && dow != 7 {
                rules["holidayReplacementFollowingWeeks"]
                    .as_i64()
                    .ok_or_else(|| TrainingError::invalid("Ungültiger Ausbildungsregelstand."))?
            } else {
                0
            };
            let last = parse_date(&day.week)
                .map_err(|_| super::helpers::temporal())?
                .checked_add(following.weeks().days(6))
                .map_err(|_| super::helpers::temporal())?
                .to_string();
            replacements.push((
                day,
                last,
                if holiday {
                    "§ 18 Abs. 3 JArbSchG"
                } else if dow == 6 {
                    "§ 16 Abs. 3 JArbSchG"
                } else {
                    "§ 17 Abs. 3 JArbSchG"
                },
            ));
        }
    }
    replacements.sort_by(|a, b| a.1.cmp(&b.1).then(a.0.date.cmp(&b.0.date)));
    let mut used = BTreeSet::<&str>::new();
    for (day, last, section) in replacements {
        let mut replacement = None;
        for candidate in free.iter().copied() {
            if candidate >= day.week.as_str()
                && candidate <= last.as_str()
                && candidate != day.date
                && !used.contains(candidate)
                && !holidays.holidays.contains_key(candidate)
                && parse_date(candidate)
                    .map_err(|_| super::helpers::temporal())?
                    .weekday()
                    .to_monday_one_offset()
                    < 6
            {
                replacement = Some(candidate);
                break;
            }
        }
        if let Some(date) = replacement {
            used.insert(date);
        } else {
            out.push(event(day,"REPLACEMENT_DAY_MISSING","INCOMPLETE","Eine eigene schulfreie Ersatzfreistellung im zulässigen Zeitraum ist nicht als Frei-Tag nachgewiesen.".into(),section,ids(day)));
        }
    }
    for week_days in weeks.values() {
        let Some(target) = week_days
            .iter()
            .copied()
            .find(|d| d.date.starts_with(&context.month))
        else {
            continue;
        };
        if week_days.len() != 7 {
            out.push(event(target,"PARTIAL_YOUTH_WEEK","INCOMPLETE","Die Kalenderwoche ist wegen fehlender Angaben oder einer Alters-/Statusgrenze nicht durchgehend mit Jugendregeln prüfbar.".into(),"§§ 2, 4, 8 JArbSchG",vec![]));
            continue;
        }
        let max_days = number(
            &target.legal.rules()["youthProtection"]["workingTime"],
            "maxDaysPerWeek",
        )?;
        let occupied = week_days.iter().filter(|d| !d.entries.is_empty()).count();
        let including = week_days
            .iter()
            .filter(|d| !d.entries.is_empty() || released.contains(d.date.as_str()))
            .count();
        if occupied as f64 > max_days {
            out.push(event(
                target,
                "WORKING_DAYS",
                "WARNING",
                "In dieser Kalenderwoche sind zu viele Beschäftigungs-/Schultage erfasst.".into(),
                "§ 15 JArbSchG",
                week_days.iter().flat_map(|d| ids(d)).collect(),
            ));
        } else if including as f64 > max_days {
            out.push(event(target,"EXAM_WEEKDAY_CREDIT_UNCLEAR","INCOMPLETE","Mit dem angerechneten Arbeitstag vor der Abschlussprüfung sind mehr als fünf Tage betroffen; die Fünf-Tage-Abgrenzung benötigt fachliche Prüfung.".into(),"§§ 10, 15 JArbSchG",vec![]));
        }
        let has_block = context.block_weekly.contains_key(&target.week);
        let mut total = if has_block {
            context.block_weekly[&target.week]
        } else {
            Some(0.0)
        };
        if !has_block {
            for day in week_days {
                let amount = context.daily.get(&day.date).copied().flatten();
                total = match (total, amount) {
                    (Some(total), Some(amount)) => Some(total + amount),
                    _ => None,
                };
                if parse_date(&day.date)
                    .map_err(|_| super::helpers::temporal())?
                    .weekday()
                    .to_monday_one_offset()
                    <= 6
                    && holidays.holidays.contains_key(&day.date)
                    && day.entries.is_empty()
                {
                    if let Some(lost) = day.facts_context["holidayLostMinutes"].get(&day.date) {
                        let lost = lost.as_f64().expect("normalized holiday credit");
                        if let Some(amount) = total.as_mut() {
                            *amount += lost;
                        }
                    } else {
                        total = None;
                        out.push(event(day,"HOLIDAY_CREDIT_MISSING","INCOMPLETE","Die durch den Feiertag ausgefallene Arbeitszeit ist nicht bestätigt; kein pauschaler Achtstundentag.".into(),"§ 4 Abs. 4 JArbSchG",vec![]));
                    }
                }
            }
        }
        if let Some(total) = total {
            let limit = number(
                &target.legal.rules()["youthProtection"]["workingTime"],
                "weeklyMinutes",
            )?;
            if total > limit {
                out.push(event(
                    target,
                    "WEEKLY_TIME",
                    if has_block { "INCOMPLETE" } else { "WARNING" },
                    format!(
                        "Die anzurechnende Wochenzeit ({} Min.) überschreitet {} Minuten.",
                        super::daily::label(total),
                        super::daily::label(limit)
                    ),
                    "§§ 8, 9 JArbSchG",
                    vec![],
                ));
            }
        } else {
            out.push(event(target,"WEEKLY_CREDIT_INCOMPLETE","INCOMPLETE","Die anzurechnende Wochenzeit ist wegen fehlender Zeit-/Anrechnungsangaben unvollständig.".into(),"§§ 4, 8, 9 JArbSchG",vec![]));
        }
    }
    let month_days = context
        .days
        .iter()
        .filter(|d| d.date.starts_with(&context.month))
        .collect::<Vec<_>>();
    let count = parse_date(&format!("{}-01", context.month))
        .map_err(|_| super::helpers::temporal())?
        .days_in_month() as usize;
    if month_days.len() == count {
        if month_days
            .iter()
            .any(|d| d.facts_context["allWorkAndSchoolRecorded"] != true)
        {
            return Ok(out);
        }
        let first = month_days[0];
        let rules = &first.legal.rules()["youthProtection"]["daysOff"];
        let mut sundays = 0;
        let mut saturdays = 0;
        for day in &month_days {
            if day.entries.is_empty() {
                match parse_date(&day.date)
                    .map_err(|_| super::helpers::temporal())?
                    .weekday()
                    .to_monday_one_offset()
                {
                    7 => sundays += 1,
                    6 => saturdays += 1,
                    _ => {}
                }
            }
        }
        if f64::from(sundays) < number(rules, "minimumFreeSundays")? {
            out.push(event(
                first,
                "FREE_SUNDAYS",
                "WARNING",
                "Im Monat bleiben zu wenige Sonntage beschäftigungsfrei.".into(),
                "§ 17 Abs. 2 JArbSchG",
                vec![],
            ));
        }
        if f64::from(saturdays) < number(rules, "recommendedFreeSaturdays")? {
            out.push(event(
                first,
                "FREE_SATURDAYS",
                "RECOMMENDATION",
                "Nach der Soll-Regel sollten mehr Samstage im Monat beschäftigungsfrei bleiben."
                    .into(),
                "§ 16 Abs. 2 JArbSchG",
                vec![],
            ));
        }
    }
    Ok(out)
}
