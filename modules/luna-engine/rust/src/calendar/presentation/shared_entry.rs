//! Exact readonly shared editor display over the existing incoming selection.
use crate::EngineError;
use serde_json::{Value, json};
use std::sync::Arc;
pub fn detail(
    calendars: Arc<Vec<Value>>,
    time_zone: &str,
    date: &str,
    calendar_id: &str,
    entry_id: &str,
) -> Result<Value, EngineError> {
    let days = crate::calendar::incoming::shared_calendar_days(calendars, time_zone, None, None)?;
    let mut selected = None;
    for row in days.rows_for_date(date) {
        let row = row?;
        if row.calendar_id == calendar_id && row.entry["id"].as_str() == Some(entry_id) {
            selected = Some(row);
            break;
        }
    }
    let Some(row) = selected else {
        return Ok(Value::Null);
    };
    let text = |key| {
        row.entry
            .get(key)
            .and_then(Value::as_str)
            .ok_or(EngineError::InvalidCalendarEntry)
    };
    let all_day = crate::net::js_truthy(&row.entry["allDay"]);
    let (duration, start_label, end_label) = crate::calendar::incoming::shared_editor_time_labels(
        text("startsAt")?,
        text("endsAt")?,
        if all_day {
            text("timeZone")?
        } else {
            time_zone
        },
        all_day,
    )
    .ok_or(EngineError::InvalidCalendarEntry)?;
    Ok(
        json!({"title":row.entry["title"],"calendarName":row.calendar_name,"color":row.entry["color"],"symbol":row.entry["symbol"],"note":row.entry.get("note").filter(|v|crate::net::js_truthy(v)),"durationLabel":duration,"startLabel":start_label,"endLabel":end_label}),
    )
}
