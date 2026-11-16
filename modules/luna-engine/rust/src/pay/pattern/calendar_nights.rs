use super::{
    Assignment, CalendarNightEvidence, PatternError, WorkPatternSettings,
    assess_tvoed_pattern_refs, is_pay_work_shift,
};
use crate::{
    calendar::parse_date,
    rules::{RulePackage, RuleResolver},
    time::{clock, zone},
};
use jiff::{
    Timestamp, ToSpan,
    civil::{Date, Time},
    tz::{Disambiguation, TimeZone},
};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NightSequenceExplanation {
    pub title: &'static str,
    pub dates: Vec<String>,
    pub deadline: Option<String>,
    pub has_absence: bool,
    pub uncertain: bool,
    pub qualified_night_count: usize,
}
struct NightBounds {
    date: String,
    start: i64,
    end: i64,
    qualified: bool,
    uncertain: bool,
}
fn instant(
    day: Date,
    time: Time,
    tz: &TimeZone,
    disambiguation: Disambiguation,
) -> Result<i64, PatternError> {
    tz.to_ambiguous_zoned(day.to_datetime(time))
        .disambiguate(disambiguation)
        .map(|z| z.timestamp().as_millisecond())
        .map_err(|_| PatternError::InvalidInput)
}
fn add_days(day: Date, days: i32) -> Result<Date, PatternError> {
    day.checked_add(days.days())
        .map_err(|_| PatternError::InvalidInput)
}
fn calculate_night_bounds(shift: &Value, tz: &TimeZone) -> Result<NightBounds, PatternError> {
    let text = shift["date"].as_str().ok_or(PatternError::InvalidInput)?;
    let date = parse_date(text)?;
    let start_time = clock(
        shift["startTime"]
            .as_str()
            .ok_or(PatternError::InvalidInput)?,
    )?;
    let end_time = clock(
        shift["endTime"]
            .as_str()
            .ok_or(PatternError::InvalidInput)?,
    )?;
    let end_date = if end_time <= start_time {
        add_days(date, 1)?
    } else {
        date
    };
    let start = instant(date, start_time, tz, Disambiguation::Reject)?;
    let end = instant(end_date, end_time, tz, Disambiguation::Reject)?;
    let duration = (end - start) as f64 / 60000.0;
    let pause = shift["breakMinutes"]
        .as_f64()
        .ok_or(PatternError::InvalidInput)?;
    if !pause.is_finite() || pause < 0.0 || pause > duration {
        return Err(PatternError::InvalidInput);
    }
    let start_minute = i32::from(start_time.hour()) * 60 + i32::from(start_time.minute());
    let end_minute = i32::from(end_time.hour()) * 60
        + i32::from(end_time.minute())
        + if end_date == date { 0 } else { 1440 };
    let mut day = add_days(date, -1)?;
    let mut offset = -1;
    let mut gross_night = 0.0;
    while day <= end_date {
        if end_minute > offset * 1440 + 1260 && start_minute < offset * 1440 + 1800 {
            let from = instant(
                day,
                Time::new(21, 0, 0, 0).map_err(|_| PatternError::InvalidInput)?,
                tz,
                Disambiguation::Compatible,
            )?;
            let until = instant(
                add_days(day, 1)?,
                Time::new(6, 0, 0, 0).map_err(|_| PatternError::InvalidInput)?,
                tz,
                Disambiguation::Compatible,
            )?;
            let overlap_start = start.max(from);
            let overlap_end = end.min(until);
            if overlap_start < overlap_end {
                gross_night += (overlap_end - overlap_start) as f64 / 60000.0;
            }
        }
        day = add_days(day, 1)?;
        offset += 1;
    }
    let minimum = (gross_night - pause).max(0.0);
    let maximum = gross_night.min(duration - pause);
    Ok(NightBounds {
        date: text.to_owned(),
        start,
        end,
        qualified: minimum >= 120.0,
        uncertain: minimum < 120.0 && maximum >= 120.0,
    })
}

pub fn night_deadline(end_millisecond: i64, tz: &TimeZone) -> Result<(String, i64), PatternError> {
    let end_date = Timestamp::from_millisecond(end_millisecond)
        .map_err(|_| PatternError::InvalidInput)?
        .to_zoned(tz.clone())
        .date();
    let deadline = end_date
        .checked_add(1.months())
        .map_err(|_| PatternError::InvalidInput)?;
    let exclusive = instant(
        add_days(deadline, 1)?,
        Time::midnight(),
        tz,
        Disambiguation::Compatible,
    )?;
    Ok((deadline.to_string(), exclusive))
}

pub fn explain_night_sequence(
    entries: &[Value],
    month: &str,
    time_zone: &str,
) -> Result<NightSequenceExplanation, PatternError> {
    explain_night_sequence_refs(&entries.iter().collect::<Vec<_>>(), month, time_zone)
}
pub(crate) fn explain_night_sequence_refs(
    entries: &[&Value],
    month: &str,
    time_zone: &str,
) -> Result<NightSequenceExplanation, PatternError> {
    let first = parse_date(&format!("{month}-01"))?;
    let from = first
        .checked_sub(1.months())
        .map_err(|_| PatternError::InvalidInput)?
        .to_string();
    let until = first
        .checked_add(1.months())
        .map_err(|_| PatternError::InvalidInput)?
        .to_string();
    let relevant: Vec<&Value> = entries
        .iter()
        .copied()
        .filter(|s| {
            s.get("kind").and_then(Value::as_str) == Some("SHIFT")
                && s.get("deletedAt") == Some(&Value::Null)
                && s.get("date")
                    .and_then(Value::as_str)
                    .is_some_and(|date| date >= from.as_str() && date < until.as_str())
        })
        .collect();
    let tz = zone(time_zone);
    let mut invalid = false;
    let mut seen = BTreeSet::new();
    let mut nights = Vec::new();
    for shift in relevant.iter().filter(|s| is_pay_work_shift(s)) {
        let Some(id) = shift["id"].as_str() else {
            invalid = true;
            continue;
        };
        if !seen.insert(id) {
            invalid = true;
            continue;
        }
        match tz
            .as_ref()
            .map_err(|_| PatternError::InvalidInput)
            .and_then(|tz| calculate_night_bounds(shift, tz))
        {
            Ok(bounds) => nights.push(bounds),
            Err(_) => invalid = true,
        }
    }
    nights.sort_by_key(|n| n.start);
    if nights.windows(2).any(|pair| pair[1].start < pair[0].end) {
        invalid = true;
    }
    let qualified: Vec<&NightBounds> = nights.iter().filter(|n| n.qualified).collect();
    let mut dates = Vec::new();
    let mut deadline = None;
    if !invalid
        && qualified
            .iter()
            .filter(|n| n.date.starts_with(&format!("{month}-")))
            .count()
            >= 2
    {
        let tz = tz.map_err(PatternError::Time)?;
        for anchor in &qualified {
            let (deadline_date, exclusive) = night_deadline(anchor.end, &tz)?;
            let pair: Vec<&NightBounds> = qualified
                .iter()
                .copied()
                .filter(|n| {
                    n.start >= anchor.end
                        && n.start < exclusive
                        && n.date.starts_with(&format!("{month}-"))
                })
                .take(2)
                .collect();
            if pair.len() != 2 {
                continue;
            }
            dates = vec![
                anchor.date.clone(),
                pair[0].date.clone(),
                pair[1].date.clone(),
            ];
            deadline = Some(deadline_date);
            break;
        }
    }
    let uncertain = invalid || nights.iter().any(|n| n.uncertain);
    Ok(NightSequenceExplanation {
        title: if !dates.is_empty() {
            "Passende Nachtdienstfolge gefunden"
        } else if uncertain {
            "Nachtdienstfolge noch nicht eindeutig"
        } else {
            "Noch keine passende Nachtdienstfolge erkennbar"
        },
        dates,
        deadline,
        uncertain,
        qualified_night_count: qualified.len(),
        has_absence: relevant.iter().any(|s| {
            s["date"]
                .as_str()
                .is_some_and(|date| date.starts_with(&format!("{month}-")))
                && matches!(s["type"].as_str(), Some("VACATION" | "SICK"))
        }),
    })
}

pub fn assess_tvoed_k_calendar_month(
    month: &str,
    shifts: &[Value],
    settings: &WorkPatternSettings,
    resolver: &RuleResolver,
    time_zone: &str,
    effective_date: Option<&str>,
    tariff_override: Option<&RulePackage>,
) -> Result<Value, PatternError> {
    assess_tvoed_k_calendar_month_refs(
        month,
        &shifts.iter().collect::<Vec<_>>(),
        settings,
        resolver,
        time_zone,
        effective_date,
        tariff_override,
    )
}
pub(crate) fn assess_tvoed_k_calendar_month_refs(
    month: &str,
    shifts: &[&Value],
    settings: &WorkPatternSettings,
    resolver: &RuleResolver,
    time_zone: &str,
    effective_date: Option<&str>,
    tariff_override: Option<&RulePackage>,
) -> Result<Value, PatternError> {
    let default = format!("{month}-01");
    let effective = effective_date.unwrap_or(&default);
    if parse_date(effective).is_err() || !effective.starts_with(&format!("{month}-")) {
        return Err(PatternError::InvalidRuleDate);
    }
    let current: Vec<&Value> = shifts
        .iter()
        .copied()
        .filter(|s| {
            s["date"]
                .as_str()
                .is_some_and(|date| date.starts_with(&format!("{month}-")))
                && s.get("deletedAt") == Some(&Value::Null)
        })
        .collect();
    let has_work = current.iter().any(|s| is_pay_work_shift(s));
    let sequence = explain_night_sequence_refs(shifts, month, time_zone)?;
    let observed: Vec<&Value> = shifts
        .iter()
        .copied()
        .filter(|s| s.get("deletedAt") == Some(&Value::Null))
        .collect();
    let matched = sequence.dates.len() == 3 && !sequence.uncertain;
    let mut assessment = assess_tvoed_pattern_refs(
        if matched || has_work { &observed } else { &[] },
        settings,
        resolver,
        Some(effective),
        matched.then_some(CalendarNightEvidence {
            met: true,
            count: sequence.qualified_night_count,
        }),
        tariff_override,
    )?;
    let mut continued = false;
    if !has_work && sequence.has_absence && settings.assignment == Assignment::Permanent {
        let history: Vec<&Value> = observed
            .iter()
            .copied()
            .filter(|s| {
                s["date"]
                    .as_str()
                    .is_some_and(|date| date < default.as_str())
            })
            .collect();
        let prior = assess_tvoed_pattern_refs(
            &history,
            settings,
            resolver,
            Some(effective),
            None,
            tariff_override,
        )?;
        if matches!(
            prior["suggestedAllowance"].as_str(),
            Some("ALTERNATING_MONTHLY" | "SHIFT_MONTHLY")
        ) {
            assessment = prior;
            continued = true;
        }
    }
    let note = if continued {
        "Vorläufig: Monatszulage aus deinem bisherigen Dienstmuster bei Urlaub/Krankheit fortgeschätzt; Fortzahlung nicht bestätigt."
    } else if !matched {
        "Vorläufig: Keine eindeutige Nachtdienstfolge für diesen Monat. Die Muster-Schätzung ist kein bestätigter Anspruch."
    } else if sequence.has_absence {
        "Schätzung aus eingetragenen Diensten. Urlaub/Krankheit und ein vollständiger Anspruch sind damit nicht bestätigt."
    } else {
        "Schätzung aus eingetragenen Diensten und gespeicherten Arbeitsplatzangaben, kein bestätigter Anspruch."
    };
    assessment["estimateNote"] = json!(note);
    if !matched && assessment["alternatingShiftWork"] == "DETECTED" {
        assessment["alternatingShiftWork"] = json!("REVIEW");
    }
    for criterion in assessment["criteria"]
        .as_array_mut()
        .ok_or(PatternError::InvalidInput)?
    {
        if criterion["key"] == "NIGHT_SHIFTS" {
            criterion["detail"] = json!(if matched {
                "Zwei weitere Nachtdienste dieses Monats innerhalb der Zeitmonatsfrist erkannt"
            } else {
                "Monatsfolge offen; fehlende Einträge sind keine Anspruchsablehnung"
            });
            criterion["state"] = json!(if matched { "MET" } else { "OPEN" });
        }
    }
    Ok(json!({"assessment":assessment,"nightSequence":sequence}))
}
