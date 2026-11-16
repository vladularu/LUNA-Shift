use super::types::{actual_minutes, duty, instant, label, text, truthy};
use super::{SpecialDutyError, SpecialDutyTimeAccount};
use crate::rules::RuleResolver;
use serde::Deserialize;
use serde_json::Value;
use serde_json::json;
use std::collections::BTreeMap;
use std::collections::BTreeSet;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntervalProjection {
    date: String,
    start_time: Option<String>,
    end_time: Option<String>,
    #[serde(default)]
    all_day: bool,
}
fn intervals(entry: &Value, zone: &str) -> Result<Vec<(i64, i64)>, SpecialDutyError> {
    if truthy(entry.get("specialDuty")) {
        return crate::credit::duty::parts(entry)?
            .iter()
            .map(|part| Ok((instant(entry, part.start)?, instant(entry, part.end)?)))
            .collect();
    }
    let value =
        IntervalProjection::deserialize(entry).map_err(|_| SpecialDutyError::InvalidInput)?;
    let input = crate::time::ShiftTime {
        date: value.date,
        start_time: value.start_time,
        end_time: value.end_time,
        break_minutes: 0,
        all_day: value.all_day,
        special_duty: None,
    };
    Ok(crate::time::shift_bounds(&input, zone)?
        .map(|bounds| {
            (
                bounds.start_epoch_minutes * 60000,
                bounds.end_epoch_minutes * 60000,
            )
        })
        .into_iter()
        .collect())
}

fn duties<'a>(month: &str, entries: &[&'a Value]) -> Result<Vec<&'a Value>, SpecialDutyError> {
    let mut seen = BTreeSet::new();
    let mut result = Vec::new();
    for &entry in entries {
        if entry.get("deletedAt") != Some(&Value::Null)
            || !truthy(entry.get("specialDuty"))
            || entry["specialDuty"]["kind"] == "SPLIT"
        {
            continue;
        }
        let id = text(entry, "id")?;
        if seen.contains(id) {
            continue;
        }
        if !crate::credit::duty::duty_calendar_dates(entry)?
            .iter()
            .any(|date| date.starts_with(month))
        {
            continue;
        }
        seen.insert(id);
        result.push(entry);
    }
    Ok(result)
}

/// Internal Rust reuse seam: callers with native pay lines can avoid a second
/// remuneration pass. The public snapshot wire never accepts precomputed lines.
pub fn special_duty_time_account_with_pay(
    month: &str,
    entries: &[Value],
    profile: &Value,
    pay_lines: &[Value],
) -> Result<SpecialDutyTimeAccount, SpecialDutyError> {
    special_duty_time_account_with_pay_refs(
        month,
        &entries.iter().collect::<Vec<_>>(),
        profile,
        pay_lines,
    )
}
pub fn special_duty_time_account_with_pay_refs(
    month: &str,
    entries: &[&Value],
    profile: &Value,
    pay_lines: &[Value],
) -> Result<SpecialDutyTimeAccount, SpecialDutyError> {
    let selected = duties(month, entries)?;
    let pay: BTreeMap<&str, &Value> = pay_lines
        .iter()
        .map(|line| text(line, "shiftId").map(|id| (id, line)))
        .collect::<Result<_, _>>()?;
    let mut lines = Vec::new();
    let mut ids = BTreeSet::new();
    for entry in selected {
        let duty = duty(entry)?;
        let id = text(entry, "id")?;
        let kind = text(duty, "kind")?;
        let money = pay.get(id).copied();
        let mut notes: Vec<String> = Vec::new();
        let mut credited: Option<f64> = None;
        if kind == "ON_CALL" && !truthy(duty.get("calloutsComplete")) {
            notes.push("Rufbereitschaft: Bestätige, ob alle Einsätze erfasst sind.".into());
        } else if kind == "ON_CALL"
            && duty["callouts"]
                .as_array()
                .ok_or(SpecialDutyError::InvalidInput)?
                .is_empty()
        {
            credited = Some(0.0);
        } else if duty["settlement"] == "UNKNOWN" {
            notes.push(format!(
                "{}: Wähle Auszahlung oder den vereinbarten Freizeitausgleich.",
                label(kind)?
            ));
        } else {
            credited = money.and_then(|line| {
                line[if kind == "STANDBY" {
                    "standbyPay"
                } else {
                    "calloutPay"
                }]["timeCreditMinutes"]
                    .as_f64()
            });
        }
        if credited.is_none() && notes.is_empty() {
            let reasons = money
                .and_then(|line| {
                    line["standbyPay"]
                        .get("notes")
                        .or_else(|| line["calloutPay"].get("notes"))
                })
                .and_then(Value::as_array);
            if let Some(reasons) = reasons.filter(|notes| !notes.is_empty()) {
                for note in reasons {
                    notes.push(note.as_str().ok_or(SpecialDutyError::InvalidInput)?.into());
                }
            } else {
                notes.push(format!(
                    "{}: Die Grundlage für die Zeitgutschrift fehlt oder ist noch offen.",
                    label(kind)?
                ));
            }
        }
        if credited.is_some_and(|minutes| minutes > 0.0) {
            let own = intervals(entry, text(profile, "timeZone")?)?;
            let mut overlaps = false;
            for other in entries {
                if text(other, "id")? == id || other.get("deletedAt") != Some(&Value::Null) {
                    continue;
                }
                for &(start, end) in &own {
                    if intervals(other, text(profile, "timeZone")?)?
                        .iter()
                        .any(|&(a, b)| a < end && b > start)
                    {
                        overlaps = true;
                        break;
                    }
                }
                if overlaps {
                    break;
                }
            }
            if overlaps {
                credited = None;
                notes.push("Bereitschafts- oder Einsatzzeiten überschneiden sich mit einem anderen Dienst. Prüfe die Zeitgutschrift.".into());
            }
        }
        ids.insert(id.into());
        lines.push(json!({"shiftId":id,"date":text(entry,"date")?,"title":label(kind)?,"recordedMinutes":actual_minutes(entry)?,"creditedMinutes":credited,"settlement":duty["settlement"],"notes":notes}));
    }
    let mut notes = Vec::new();
    for line in &lines {
        for note in line["notes"]
            .as_array()
            .ok_or(SpecialDutyError::InvalidInput)?
        {
            notes.push(
                note.as_str()
                    .ok_or(SpecialDutyError::InvalidInput)?
                    .to_owned(),
            );
        }
    }
    let notes = super::types::unique(notes);
    let credited_minutes = if notes.is_empty() {
        let mut total = Some(0.0);
        for line in &lines {
            total = total
                .zip(line["creditedMinutes"].as_f64())
                .map(|(sum, value)| sum + value);
        }
        total
    } else {
        None
    };
    Ok(SpecialDutyTimeAccount {
        lines,
        notes,
        ids,
        credited_minutes,
    })
}

pub fn special_duty_time_account(
    month: &str,
    entries: &[Value],
    profile: &Value,
    resolver: &RuleResolver,
) -> Result<SpecialDutyTimeAccount, SpecialDutyError> {
    // Match the source's first validation/filter traversal before calculating pay.
    let _ = duties(month, &entries.iter().collect::<Vec<_>>())?;
    let pay = super::calculate_special_duty_pay(month, entries, profile, resolver)?;
    special_duty_time_account_with_pay(month, entries, profile, &pay)
}
