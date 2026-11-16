use super::{
    TrainingError,
    details::validate_shift_training_data,
    helpers::{self, exact},
    profile::training_revision,
};
use crate::{calendar::parse_date, input, time};
use jiff::{ToSpan, civil::Time, tz::Disambiguation};
use serde_json::{Value, json};
pub fn validate_saved_shift_training(value: &Value) -> Result<Value, TrainingError> {
    let raw = exact(
        value,
        &[
            "shiftId",
            "shiftRevision",
            "shiftDate",
            "shiftUpdatedAt",
            "timeZone",
            "data",
            "revision",
            "updatedAt",
        ],
    )?;
    if raw["shiftId"]
        .as_str()
        .is_none_or(|s| input::trim_javascript(s).is_empty() || s.encode_utf16().count() > 200)
    {
        return Err(TrainingError::invalid("Ungültige Dienstzuordnung."));
    }
    let zone = raw["timeZone"]
        .as_str()
        .filter(|s| !s.is_empty() && !s.starts_with(['+', '-']))
        .ok_or_else(|| TrainingError::invalid("Ungültige Zeitzone."))?;
    time::zone(zone).map_err(|_| helpers::temporal())?;
    let shift_updated = helpers::instant(&raw["shiftUpdatedAt"], "Dienstaktualisierung")?;
    let updated = helpers::instant(&raw["updatedAt"], "Aktualisierung")?;
    if let (Some(a), Some(b)) = (
        helpers::millis(&raw["updatedAt"]),
        helpers::millis(&raw["shiftUpdatedAt"]),
    ) && a < b
    {
        return Err(TrainingError::invalid("Ungültiger Bestätigungszeitpunkt."));
    }
    Ok(
        json!({"shiftId":raw["shiftId"],"shiftRevision":training_revision(&raw["shiftRevision"])? ,"shiftDate":helpers::date(&raw["shiftDate"])? ,"shiftUpdatedAt":shift_updated,"timeZone":zone,"data":validate_shift_training_data(&raw["data"])? ,"revision":training_revision(&raw["revision"])? ,"updatedAt":updated}),
    )
}
fn same(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (Some(Value::Number(a)), Some(Value::Number(b))) => a.as_f64() == b.as_f64(),
        _ => a == b,
    }
}
pub fn is_current_shift_training(saved: &Value, shift: &Value, time_zone: &str) -> bool {
    [
        ("shiftId", "id"),
        ("shiftRevision", "revision"),
        ("shiftDate", "date"),
        ("shiftUpdatedAt", "updatedAt"),
    ]
    .iter()
    .all(|(a, b)| same(saved.get(a), shift.get(b)))
        && saved.get("timeZone").and_then(Value::as_str) == Some(time_zone)
        && shift.get("deletedAt").is_some_and(Value::is_null)
}
pub(super) fn span(shift: &Value, zone: &str) -> Result<(i128, i128), TrainingError> {
    let date = parse_date(shift["date"].as_str().ok_or_else(helpers::temporal)?)
        .map_err(|_| helpers::temporal())?;
    let start = shift["startTime"].as_str().ok_or_else(helpers::temporal)?;
    let end = shift["endTime"].as_str().ok_or_else(helpers::temporal)?;
    let end_date = if end <= start {
        date.checked_add(1.days())
            .map_err(|_| helpers::temporal())?
    } else {
        date
    };
    let zone = time::zone(zone).map_err(|_| helpers::temporal())?;
    let at = |date: jiff::civil::Date, clock: &str| -> Result<i128, TrainingError> {
        let clock = clock.parse::<Time>().map_err(|_| helpers::temporal())?;
        zone.to_ambiguous_zoned(date.to_datetime(clock))
            .disambiguate(Disambiguation::Reject)
            .map(|z| i128::from(z.timestamp().as_millisecond()))
            .map_err(|_| helpers::temporal())
    };
    Ok((at(date, start)?, at(end_date, end)?))
}
pub fn require_shift_training_parent(saved: &Value, shift: &Value) -> Result<(), TrainingError> {
    if !same(saved.get("shiftId"), shift.get("id"))
        || saved["shiftRevision"]
            .as_f64()
            .zip(shift["revision"].as_f64())
            .is_some_and(|(a, b)| a > b)
        || helpers::millis(&saved["shiftUpdatedAt"])
            .zip(helpers::millis(&shift["updatedAt"]))
            .is_some_and(|(a, b)| a > b)
    {
        return Err(TrainingError::invalid(
            "Ungültige Dienstzuordnung der Schul-/Pausendaten.",
        ));
    }
    if !same(saved.get("shiftRevision"), shift.get("revision"))
        || !same(saved.get("shiftDate"), shift.get("date"))
        || !same(saved.get("shiftUpdatedAt"), shift.get("updatedAt"))
    {
        return Ok(());
    }
    let data = &saved["data"];
    let pauses = &data["pauses"];
    let school = &data["school"];
    let exam = &data["exam"];
    if pauses.is_null() && school.is_null() && exam.is_null() {
        return Ok(());
    }
    if shift.get("allDay") == Some(&Value::Bool(true))
        || shift["startTime"].is_null()
        || shift["endTime"].is_null()
    {
        return Err(TrainingError::invalid(
            "Schulzeiten und Pausen benötigen einen Dienst mit Uhrzeiten.",
        ));
    }
    if !school.is_null() && shift["type"] != "TRAINING" {
        return Err(TrainingError::invalid(
            "Berufsschule muss ausdrücklich als Ausbildungseintrag erfasst werden.",
        ));
    }
    if !exam.is_null() && shift["type"] != "TRAINING" {
        return Err(TrainingError::invalid(
            "Prüfung muss ausdrücklich als Ausbildungseintrag erfasst werden.",
        ));
    }
    if exam
        .get("precedingWorkDate")
        .filter(|v| !v.is_null())
        .and_then(Value::as_str)
        .zip(shift["date"].as_str())
        .is_some_and(|(a, b)| a >= b)
    {
        return Err(TrainingError::invalid(
            "Der vorausgehende Arbeitstag muss vor der Prüfung liegen.",
        ));
    }
    let (from, until) = span(
        shift,
        saved["timeZone"].as_str().ok_or_else(helpers::temporal)?,
    )?;
    for group in [
        pauses,
        school.get("lessons").unwrap_or(&Value::Null),
        exam.get("participation").unwrap_or(&Value::Null),
    ] {
        for interval in group.as_array().into_iter().flatten() {
            if helpers::millis(&interval["start"]).is_some_and(|v| v < from)
                || helpers::millis(&interval["end"]).is_some_and(|v| v > until)
            {
                return Err(TrainingError::invalid(
                    "Zeitintervall liegt außerhalb des Eintrags.",
                ));
            }
        }
    }
    for travel in [
        school.get("travelFromWorkInterval"),
        school.get("travelToWorkInterval"),
        exam.get("travelFromWorkInterval"),
        exam.get("travelToWorkInterval"),
    ]
    .into_iter()
    .flatten()
    .filter(|v| !v.is_null())
    {
        if helpers::millis(&travel["start"]).is_some_and(|v| v < from - 24 * 60 * 60 * 1000)
            || helpers::millis(&travel["end"]).is_some_and(|v| v > until + 24 * 60 * 60 * 1000)
        {
            return Err(TrainingError::invalid(
                "Weg liegt nicht beim zugeordneten Ausbildungs-/Prüfungstag.",
            ));
        }
    }
    if let Some(pauses) = pauses.as_array() {
        let mut total = 0.0;
        for pause in pauses {
            let start = helpers::millis(&pause["start"]).ok_or_else(helpers::temporal)?;
            let end = helpers::millis(&pause["end"]).ok_or_else(helpers::temporal)?;
            total += (end - start) as f64 / 60000.0;
        }
        if shift["breakMinutes"].as_f64() != Some(total) {
            return Err(TrainingError::invalid(
                "Pausenintervalle und gespeicherte Pausendauer stimmen nicht überein.",
            ));
        }
    }
    if let Some(block) = school.get("block").filter(|b| !b.is_null()) {
        let date = shift["date"].as_str().ok_or_else(helpers::temporal)?;
        if block["startDate"].as_str().is_some_and(|d| date < d)
            || block["endDate"].as_str().is_some_and(|d| date > d)
        {
            return Err(TrainingError::invalid(
                "Schultag liegt außerhalb des Schulblocks.",
            ));
        }
    }
    Ok(())
}
pub fn youth_block_shift_binding(
    shift: &Value,
    saved: &Value,
    time_zone: &str,
) -> Result<Option<String>, TrainingError> {
    let data = &saved["data"];
    if !is_current_shift_training(saved, shift, time_zone)
        || shift["allDay"] == true
        || shift["startTime"].is_null()
        || shift["endTime"].is_null()
        || matches!(shift["type"].as_str(), Some("FREE" | "VACATION" | "SICK"))
        || data["pauses"].is_null()
        || !data["school"].is_null()
        || !data["exam"].is_null()
    {
        return Ok(None);
    }
    let pauses = data["pauses"]
        .as_array()
        .ok_or_else(|| TrainingError::invalid("Ungültige Ausbildungsdaten."))?
        .iter()
        .map(|p| json!([p["start"], p["end"]]))
        .collect::<Vec<_>>();
    let all_day = shift
        .get("allDay")
        .filter(|v| !v.is_null())
        .cloned()
        .unwrap_or(json!(false));
    let numeric = |v: &Value| -> Value {
        if let Some(v) = v.as_f64().filter(|v| {
            v.is_finite() && v.fract() == 0.0 && v.abs() <= crate::money::MAX_SAFE_INTEGER as f64
        }) {
            json!(v as i64)
        } else {
            v.clone()
        }
    };
    let binding = serde_json::to_string(&json!([
        "youth-block-v1",
        shift["id"],
        numeric(&shift["revision"]),
        shift["updatedAt"],
        shift["date"],
        shift["type"],
        all_day,
        shift["startTime"],
        shift["endTime"],
        numeric(&shift["breakMinutes"]),
        time_zone,
        numeric(&saved["revision"]),
        saved["updatedAt"],
        pauses
    ]))
    .map_err(|_| TrainingError::invalid("Ungültige Ausbildungsdaten."))?;
    Ok((binding.encode_utf16().count() <= 2048).then_some(binding))
}
