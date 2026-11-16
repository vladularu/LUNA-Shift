use super::{BaseError, TimestampField};
use crate::{
    employment::require_remuneration_date,
    remuneration::{context::model::ContextError, own_config::javascript_space},
};
use serde::Serialize;
use serde_json::Value;
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaidAbsence {
    pub shift_id: String,
    pub shift_revision: i64,
    pub shift_date: String,
    pub shift_updated_at: String,
    pub time_zone: String,
    pub paid_minutes: Option<i64>,
    pub revision: i64,
    pub confirmed_at: String,
    pub updated_at: String,
}
fn text<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str)
}
fn instant<'a>(
    value: &'a Value,
    key: &str,
    field: TimestampField,
) -> Result<(&'a str, jiff::Timestamp), BaseError> {
    let text = text(value, key).ok_or(BaseError::AbsenceInstant(field))?;
    let timestamp = text.parse().map_err(|_| BaseError::AbsenceInstant(field))?;
    Ok((text, timestamp))
}
// Temporal accepts annotations/second offsets which Date.parse does not. The old ordering
// comparisons are false for NaN and truncate submilliseconds for ordinary ISO timestamps.
fn javascript_milliseconds(raw: &str, timestamp: jiff::Timestamp) -> Option<i128> {
    if raw.contains('[')
        || raw.split_once(['T', 't', ' ']).is_some_and(|(_, time)| {
            time.rsplit_once(['+', '-'])
                .is_some_and(|(_, offset)| offset.len() > 6 && offset.contains(':'))
        })
        || raw.contains(":60")
    {
        None
    } else {
        Some(timestamp.as_nanosecond().div_euclid(1_000_000))
    }
}
pub fn validate_paid_absence(value: &Value) -> Result<PaidAbsence, BaseError> {
    let map = value.as_object().ok_or(BaseError::AbsenceObject)?;
    let keys = [
        "shiftId",
        "shiftRevision",
        "shiftDate",
        "shiftUpdatedAt",
        "timeZone",
        "paidMinutes",
        "revision",
        "confirmedAt",
        "updatedAt",
    ];
    if map.len() != keys.len() || keys.iter().any(|key| !map.contains_key(*key)) {
        return Err(BaseError::AbsenceFormat);
    }
    let id = text(value, "shiftId")
        .filter(|s| !s.trim_matches(javascript_space).is_empty() && s.encode_utf16().count() <= 200)
        .ok_or(BaseError::AbsenceId)?;
    let revision = |k: &str| {
        value[k]
            .as_i64()
            .filter(|n| (1..=crate::money::MAX_SAFE_INTEGER).contains(n))
            .ok_or(BaseError::AbsenceRevision)
    };
    let shift_revision = revision("shiftRevision")?;
    let revision = revision("revision")?;
    let paid_minutes = if value["paidMinutes"].is_null() {
        None
    } else {
        Some(
            value["paidMinutes"]
                .as_i64()
                .filter(|n| (0..=1500).contains(n))
                .ok_or(BaseError::AbsenceMinutes)?,
        )
    };
    let zone = text(value, "timeZone")
        .filter(|z| !z.is_empty() && !z.starts_with(['+', '-']))
        .ok_or(BaseError::AbsenceZone)?;
    super::temporal_zone(zone)?;
    let date = text(value, "shiftDate").ok_or(BaseError::Context(ContextError::Employment(
        crate::employment::EmploymentError::InvalidDate,
    )))?;
    require_remuneration_date(date).map_err(ContextError::from)?;
    let (shift_updated_at, shift_instant) =
        instant(value, "shiftUpdatedAt", TimestampField::ShiftUpdate)?;
    let (confirmed_at, confirmed) = instant(value, "confirmedAt", TimestampField::Confirmation)?;
    let (updated_at, updated) = instant(value, "updatedAt", TimestampField::Update)?;
    let shift_ms = javascript_milliseconds(shift_updated_at, shift_instant);
    let confirmed_ms = javascript_milliseconds(confirmed_at, confirmed);
    let updated_ms = javascript_milliseconds(updated_at, updated);
    if confirmed_ms.zip(updated_ms).is_some_and(|(a, b)| a > b)
        || shift_ms.zip(confirmed_ms).is_some_and(|(a, b)| a > b)
    {
        return Err(BaseError::AbsenceOrder);
    }
    Ok(PaidAbsence {
        shift_id: id.into(),
        shift_revision,
        shift_date: date.into(),
        shift_updated_at: shift_updated_at.into(),
        time_zone: zone.into(),
        paid_minutes,
        revision,
        confirmed_at: confirmed_at.into(),
        updated_at: updated_at.into(),
    })
}
pub fn is_own_paid_absence(shift: &Value) -> bool {
    shift["allDay"] == true
        || matches!(
            shift["type"].as_str(),
            Some("VACATION" | "SICK" | "FREE" | "TRAINING")
        )
}
pub fn is_current_paid_absence(value: &PaidAbsence, shift: &Value, time_zone: &str) -> bool {
    value.paid_minutes.is_some()
        && shift["id"] == value.shift_id
        && shift["revision"].as_i64() == Some(value.shift_revision)
        && shift["date"] == value.shift_date
        && shift["updatedAt"] == value.shift_updated_at
        && value.time_zone == time_zone
        && shift.get("deletedAt").is_some_and(Value::is_null)
        && is_own_paid_absence(shift)
}
