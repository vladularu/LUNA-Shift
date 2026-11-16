use super::BaseError;
use crate::{
    remuneration::context::periods::remuneration_month_start,
    time::{ShiftTime, shift_bounds},
};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemunerationShiftDay {
    pub date: String,
    #[serde(serialize_with = "super::scalar")]
    pub from_epoch_minutes: f64,
    #[serde(serialize_with = "super::scalar")]
    pub until_epoch_minutes: f64,
    #[serde(serialize_with = "super::scalar")]
    pub from: f64,
    #[serde(serialize_with = "super::scalar")]
    pub until: f64,
    #[serde(serialize_with = "super::scalar")]
    pub net_minutes: f64,
    pub estimated_pause: bool,
}
fn work(shift: &Value) -> bool {
    shift.get("specialDuty").is_none_or(Value::is_null)
        && shift["allDay"] != true
        && matches!(
            shift["type"].as_str(),
            Some("EARLY" | "LATE" | "NIGHT" | "DAY" | "CUSTOM")
        )
        && !shift["startTime"].is_null()
        && !shift["endTime"].is_null()
}
fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str, BaseError> {
    v.get(key)
        .and_then(Value::as_str)
        .ok_or(BaseError::InvalidShift)
}
pub fn remuneration_shift_days(
    shift: &Value,
    time_zone: &str,
) -> Result<Vec<RemunerationShiftDay>, BaseError> {
    if !shift.get("deletedAt").is_some_and(Value::is_null) || !work(shift) {
        return Ok(vec![]);
    }
    let projection = ShiftTime {
        date: text(shift, "date")?.into(),
        start_time: Some(text(shift, "startTime")?.into()),
        end_time: Some(text(shift, "endTime")?.into()),
        break_minutes: 0,
        all_day: false,
        special_duty: None,
    };
    // This dated path deliberately retains calculateTimedShiftBounds' legacy whole-minute rounding.
    // Other financial minute classifiers use exact instants where their source does so.
    let time_zone = super::temporal_zone_name(time_zone)?;
    let Some(bounds) = shift_bounds(&projection, time_zone)? else {
        return Ok(vec![]);
    };
    if bounds.gross_minutes <= 0 {
        return Ok(vec![]);
    }
    let pause = shift
        .get("breakMinutes")
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite())
        .ok_or(BaseError::InvalidShift)?;
    let pause = pause.min(bounds.gross_minutes as f64);
    let start = bounds.start_epoch_minutes as f64;
    let end = bounds.end_epoch_minutes as f64;
    let pause_from = start + ((bounds.gross_minutes as f64 - pause) / 2.0).floor();
    let pause_until = pause_from + pause;
    let zone = crate::time::zone(time_zone)?;
    let mut days = vec![];
    let mut from = start;
    while from < end {
        if days.len() >= 15 {
            return Err(BaseError::InvalidShift);
        }
        let ms = from * 60_000.0;
        if ms.fract() != 0.0 || ms.abs() > crate::money::MAX_SAFE_INTEGER as f64 {
            return Err(BaseError::InvalidShift);
        }
        let local = jiff::Timestamp::from_millisecond(ms as i64)
            .map_err(|_| BaseError::InvalidShift)?
            .to_zoned(zone.clone());
        let midnight = local
            .start_of_day()
            .map_err(|_| BaseError::InvalidShift)?
            .checked_add(jiff::Span::new().days(1))
            .map_err(|_| BaseError::InvalidShift)?;
        let until = end.min(midnight.timestamp().as_millisecond() as f64 / 60_000.0);
        if until <= from {
            return Err(BaseError::InvalidShift);
        }
        days.push(RemunerationShiftDay {
            date: local.date().to_string(),
            from_epoch_minutes: from,
            until_epoch_minutes: until,
            from: from - start,
            until: until - start,
            net_minutes: until - from - (until.min(pause_until) - from.max(pause_from)).max(0.0),
            estimated_pause: pause > 0.0,
        });
        from = until;
    }
    Ok(days)
}
pub fn remuneration_month_shifts<'a>(
    month: &str,
    shifts: &'a [Value],
) -> Result<Vec<&'a Value>, BaseError> {
    let first = remuneration_month_start(month)?;
    let preceding = first
        .checked_sub(jiff::Span::new().days(1))
        .map_err(|_| BaseError::InvalidShift)?
        .to_string();
    let next = first
        .checked_add(jiff::Span::new().months(1))
        .map_err(|_| BaseError::InvalidShift)?
        .to_string();
    let mut seen = BTreeSet::new();
    let mut result = vec![];
    for shift in shifts {
        if !shift.get("deletedAt").is_some_and(Value::is_null) || !work(shift) {
            continue;
        }
        let date = text(shift, "date")?;
        if date < preceding.as_str() || date >= next.as_str() {
            continue;
        }
        if !seen.insert(text(shift, "id")?) {
            return Err(BaseError::DuplicateMonthShift);
        }
        result.push(shift);
    }
    Ok(result)
}
