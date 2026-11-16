use super::{DraftFactsError, common::*, model::*, month::is_current_identity};
use crate::input::{
    calendar::{require_local_date, require_local_month},
    raw_json::normalize_integral_numbers,
};
use serde_json::{Value, json};
use std::collections::BTreeSet;
const DAY_ERROR: &str = "Ungültige TVöD-Tagesentscheidung.";
const BINDING_ERROR: &str = "Ungültige TVöD-Dienstbindung.";
/// Exact content/revision binding. Only these eleven small source fields are copied.
pub fn shift_binding(shift: &Value, time_zone: &str) -> Result<String, DraftFactsError> {
    let mut binding = json!([
        shift["id"],
        shift["revision"],
        shift["updatedAt"],
        shift["date"],
        shift["type"],
        shift["allDay"],
        shift["startTime"],
        shift["endTime"],
        shift["breakMinutes"],
        shift["deletedAt"],
        time_zone
    ]);
    normalize_integral_numbers(&mut binding);
    serde_json::to_string(&binding).map_err(|_| DraftFactsError::Message(BINDING_ERROR))
}
fn day<'a>(value: &'a Value, month: &str) -> Result<DayDecision<'a>, DraftFactsError> {
    let raw = exact(
        value,
        &[
            "shiftId",
            "date",
            "origin",
            "shiftBinding",
            "workKind",
            "holidayTimeOff",
            "shiftWork",
            "legacyAngestellteClass",
        ],
        DAY_ERROR,
        "Unbekanntes Format der TVöD-Tagesentscheidung.",
    )?;
    let date = if raw["date"].is_string() {
        require_local_date(&raw["date"])?
    } else {
        String::new()
    };
    let shift_id = raw["shiftId"].as_str();
    let binding = raw["shiftBinding"].as_str();
    let work_kind = match &raw["workKind"] {
        Value::Null => None,
        Value::String(s) if s == "REGULAR_ACTIVE" => Some(WorkKind::RegularActive),
        Value::String(s) if s == "SPECIAL" => Some(WorkKind::Special),
        _ => return Err(DraftFactsError::Message(DAY_ERROR)),
    };
    let holiday_time_off = tri(&raw["holidayTimeOff"], DAY_ERROR)?;
    let shift_work = tri(&raw["shiftWork"], DAY_ERROR)?;
    let legacy_angestellte_class = tri(&raw["legacyAngestellteClass"], DAY_ERROR)?;
    if raw["date"].as_str() != Some(date.as_str())
        || !date.starts_with(&format!("{month}-"))
        || !shift_id.is_some_and(|s| !s.is_empty() && s.encode_utf16().count() <= 128)
        || raw["origin"] != "confirmed"
        || !binding.is_some_and(|s| s.encode_utf16().count() <= 2048)
    {
        return Err(DraftFactsError::Message(DAY_ERROR));
    }
    let binding = binding.ok_or(DraftFactsError::Message(DAY_ERROR))?;
    let shift_id = shift_id.ok_or(DraftFactsError::Message(DAY_ERROR))?;
    let mut parsed: Value =
        serde_json::from_str(binding).map_err(|_| DraftFactsError::Message(BINDING_ERROR))?;
    let b = parsed
        .as_array()
        .filter(|b| b.len() == 11)
        .ok_or(DraftFactsError::Message(BINDING_ERROR))?;
    let start = if b[3].is_string() {
        require_local_date(&b[3]).ok()
    } else {
        None
    };
    let crosses = b[5] != true
        && b[6]
            .as_str()
            .zip(b[7].as_str())
            .is_some_and(|(start, end)| end <= start && end != "00:00");
    let valid_work_date = start.as_deref().is_some_and(|start| {
        date == start
            || crosses
                && start
                    .parse::<jiff::civil::Date>()
                    .ok()
                    .and_then(|d| d.checked_add(jiff::Span::new().days(1)).ok())
                    .is_some_and(|d| date == d.to_string())
    });
    if b[0] != shift_id
        || !valid_work_date
        || !safe(&b[1], 1, crate::money::MAX_SAFE_INTEGER)
        || !b[2].is_string()
        || !b[4].is_string()
        || !(b[5].is_null() || b[5].is_boolean())
        || !(b[6].is_null() || b[6].is_string())
        || !(b[7].is_null() || b[7].is_string())
        || !safe(&b[8], 0, crate::money::MAX_SAFE_INTEGER)
        || !(b[9].is_null() || b[9].is_string())
        || b[10] != "Europe/Berlin"
    {
        return Err(DraftFactsError::Message(BINDING_ERROR));
    }
    normalize_integral_numbers(&mut parsed);
    if serde_json::to_string(&parsed).map_err(|_| DraftFactsError::Message(BINDING_ERROR))?
        != binding
    {
        return Err(DraftFactsError::Message(BINDING_ERROR));
    }
    Ok(DayDecision {
        shift_id,
        date,
        origin: "confirmed",
        shift_binding: binding,
        work_kind,
        holiday_time_off,
        shift_work,
        legacy_angestellte_class,
    })
}
pub fn validate_saved_annex_a_premium_facts(
    value: &Value,
) -> Result<SavedPremiumFacts<'_>, DraftFactsError> {
    let fields = [
        "comparableFullTimeWeeklyMinutes",
        "timeZoneId",
        "cashPaymentConfirmed",
        "localAgreement",
        "dayDecisions",
    ];
    let keys: Vec<_> = ID_KEYS.iter().chain(&fields).copied().collect();
    let raw = exact(
        value,
        &keys,
        "Ungültige TVöD-Zuschlagsbestätigung.",
        "Unbekanntes Format der TVöD-Zuschlagsbestätigung.",
    )?;
    let month = require_local_month(&raw["month"])?;
    let assignment_error = DraftFactsError::Message("Ungültige TVöD-Zuschlagszuordnung.");
    if assignment(raw, ConfirmationKind::AnnexA).is_err() || raw["timeZoneId"] != "Europe/Berlin" {
        return Err(assignment_error);
    }
    let cash_payment_confirmed = tri(
        &raw["cashPaymentConfirmed"],
        "Ungültige TVöD-Zuschlagszuordnung.",
    )?;
    let local_agreement = match raw["localAgreement"].as_str() {
        Some("UNKNOWN") => LocalAgreement::Unknown,
        Some("NONE_CONFIRMED") => LocalAgreement::NoneConfirmed,
        Some("DIFFERENT") => LocalAgreement::Different,
        _ => return Err(assignment_error),
    };
    for key in ["profileRevision", "revision"] {
        if !safe(&raw[key], 1, crate::money::MAX_SAFE_INTEGER) {
            return Err(DraftFactsError::Message(
                "Ungültige TVöD-Zuschlagsrevision.",
            ));
        }
    }
    // Revision checks above use the premium-specific message; weekly validation is shared.
    revisions_and_weekly(raw, ConfirmationKind::AnnexA)?;
    let decisions = raw["dayDecisions"]
        .as_array()
        .filter(|rows| rows.len() <= 256)
        .ok_or(DraftFactsError::Message(
            "Ungültige TVöD-Tagesentscheidungen.",
        ))?;
    let day_decisions = decisions
        .iter()
        .map(|d| day(d, &month))
        .collect::<Result<Vec<_>, _>>()?;
    let mut seen = BTreeSet::new();
    for day in &day_decisions {
        if !seen.insert(format!("{}:{}", day.shift_id, day.date)) {
            return Err(DraftFactsError::Message("Doppelte TVöD-Tagesentscheidung."));
        }
    }
    Ok(SavedPremiumFacts {
        identity: identity(raw, ConfirmationKind::AnnexA)?,
        time_zone_id: "Europe/Berlin",
        cash_payment_confirmed,
        local_agreement,
        day_decisions,
        original_day_decisions: decisions,
    })
}
pub fn is_current_premium_facts(
    value: &SavedPremiumFacts<'_>,
    profile: &Value,
    rule_version_id: &str,
) -> Result<bool, DraftFactsError> {
    is_current_identity(&value.identity, profile, rule_version_id)
}
