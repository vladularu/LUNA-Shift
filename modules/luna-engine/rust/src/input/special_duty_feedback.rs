//! Feedback over raw form blocks. This does not validate or admit saved source facts.
use super::{InputError, special_duty::duty_instant_milliseconds};
use serde_json::{Value, json};
use std::cmp::Ordering;
fn invalid() -> InputError {
    InputError::source(
        "Der Sonderdienstentwurf konnte nicht geprüft werden.",
        "Error",
    )
}
fn number(value: &Value, key: &str) -> f64 {
    value.get(key).and_then(Value::as_f64).unwrap_or(f64::NAN)
}
fn integer(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0
}
pub(super) fn interval(
    start: f64,
    end: f64,
    zone: &str,
    date: Option<&str>,
) -> Result<f64, InputError> {
    match date.filter(|date| !date.is_empty()) {
        None => Ok(end - start),
        Some(date) => {
            if !integer(start) || !integer(end) || start < 0.0 || end >= 21600.0 {
                return Err(invalid());
            }
            let end = duty_instant_milliseconds(date, end as i64, zone)?;
            let start = duty_instant_milliseconds(date, start as i64, zone)?;
            Ok((end - start) as f64 / 60000.0)
        }
    }
}
fn block_error(
    part: &Value,
    max_duration: f64,
    zone: &str,
    date: Option<&str>,
    max_end: f64,
) -> Option<&'static str> {
    let start = number(part, "start");
    let end = number(part, "end");
    let pause = number(part, "breakMinutes");
    if ![start, end, pause].iter().all(|value| integer(*value)) {
        return Some("Bitte gib gültige Uhrzeiten und ganze Pausenminuten ein.");
    }
    if start < 0.0 || end > max_end || end <= start {
        return Some("Das Ende muss nach dem Beginn liegen. Prüfe auch den Tag.");
    }
    if end - start > max_duration {
        return Some(if max_duration == 1440.0 {
            "Dieser Zeitraum darf höchstens 24 Stunden dauern."
        } else {
            "Rufbereitschaft darf höchstens 14 Tage dauern."
        });
    }
    if pause < 0.0 || pause >= end - start {
        return Some("Die Pause muss kürzer als dieser Zeitraum sein.");
    }
    if interval(start, end, zone, date).is_err() {
        return Some(
            "Diese Uhrzeit ist bei der Zeitumstellung nicht eindeutig oder existiert nicht. Bitte korrigiere sie.",
        );
    }
    None
}
fn parts<'a>(duty: &'a Value, key: &str, maximum: usize) -> Result<&'a [Value], InputError> {
    let parts = duty
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(invalid)?;
    if parts.len() > maximum || parts.iter().any(|part| !part.is_object()) {
        return Err(invalid());
    }
    Ok(parts)
}
/// Only error strings and nullable minute facts leave this raw-input operation.
/// Non-numeric fields remain invalid; neither null nor malformed values become zero.
pub fn feedback(duty: &Value, parent: &Value, date: Option<&str>) -> Result<Value, InputError> {
    if !parent.is_object() {
        return Err(invalid());
    }
    let kind = duty
        .get("kind")
        .and_then(Value::as_str)
        .filter(|kind| matches!(*kind, "SPLIT" | "ON_CALL" | "STANDBY"))
        .ok_or_else(invalid)?;
    let zone = duty
        .get("timeZone")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    let parts = parts(duty, "parts", 8)?;
    let callouts = parts_array(duty)?;
    let parent_error = block_error(
        parent,
        if kind == "ON_CALL" { 20160.0 } else { 1440.0 },
        zone,
        date,
        21599.0,
    );
    let parent_start = number(parent, "start");
    let parent_end = number(parent, "end");
    let part_errors = parts
        .iter()
        .enumerate()
        .map(|(index, part)| {
            if let Some(error) = block_error(part, 1440.0, zone, date, 20160.0) {
                return Some(error.to_owned());
            }
            let start = number(part, "start");
            let end = number(part, "end");
            if start < parent_end {
                return Some(format!(
                    "Dienstteil {} beginnt vor dem Ende von Dienstteil 1.",
                    index + 2
                ));
            }
            if let Some(overlap) = parts.iter().enumerate().position(|(other_index, other)| {
                other_index != index && start < number(other, "end") && end > number(other, "start")
            }) {
                return Some(format!(
                    "Dienstteil {} überschneidet sich mit Dienstteil {}.",
                    index + 2,
                    overlap + 2
                ));
            }
            if end - parent_start > 1440.0 {
                return Some("Alle Dienstteile müssen innerhalb von 24 Stunden liegen.".to_owned());
            }
            None
        })
        .collect::<Vec<_>>();
    let callout_errors = callouts
        .iter()
        .enumerate()
        .map(|(index, call)| {
            if let Some(error) = block_error(call, 1440.0, zone, date, 20160.0) {
                return Some(error.to_owned());
            }
            let start = number(call, "start");
            let end = number(call, "end");
            let departure = number(call, "departure");
            let returned = number(call, "returned");
            if !integer(departure) || !integer(returned) || departure > start || returned < end {
                return Some("Bitte prüfe die Minuten für Hin- und Rückweg.".to_owned());
            }
            if departure < parent_start || returned > parent_end {
                return Some(
                    "Einsatz und Wege müssen innerhalb der Rufbereitschaft liegen.".to_owned(),
                );
            }
            if let Some(overlap) = callouts
                .iter()
                .enumerate()
                .position(|(other_index, other)| {
                    other_index != index
                        && departure < number(other, "returned")
                        && returned > number(other, "departure")
                })
            {
                return Some(format!(
                    "Einsatz {} überschneidet sich einschließlich der Wege mit Einsatz {}.",
                    index + 1,
                    overlap + 1
                ));
            }
            if interval(departure, returned, zone, date).is_err() {
                return Some("Prüfe die Wegezeiten an der Zeitumstellung.".to_owned());
            }
            None
        })
        .collect::<Vec<_>>();
    let valid = parent_error.is_none()
        && part_errors.iter().all(Option::is_none)
        && callout_errors.iter().all(Option::is_none);
    let (work, interruption) = if valid && kind == "SPLIT" {
        let mut sorted = Vec::with_capacity(parts.len() + 1);
        sorted.push(parent);
        sorted.extend(parts);
        sorted.sort_by(|left, right| {
            number(left, "start")
                .partial_cmp(&number(right, "start"))
                .unwrap_or(Ordering::Equal)
        });
        let mut work = 0.0;
        let mut interruption = 0.0;
        for (index, part) in sorted.iter().enumerate() {
            work += (interval(number(part, "start"), number(part, "end"), zone, date)?
                - number(part, "breakMinutes"))
            .max(0.0);
            if index > 0 {
                interruption += interval(
                    number(sorted[index - 1], "end"),
                    number(part, "start"),
                    zone,
                    date,
                )?;
            }
        }
        (Some(work), Some(interruption))
    } else {
        (None, None)
    };
    Ok(
        json!({"parentError":parent_error,"partErrors":part_errors,"calloutErrors":callout_errors,"workMinutes":work,"interruptionMinutes":interruption}),
    )
}
fn parts_array(duty: &Value) -> Result<&[Value], InputError> {
    parts(duty, "callouts", 64)
}
