use super::{OvertimeError, integer};
use crate::{
    employment::require_remuneration_date,
    input::{require_instant, simple_profile::js_milliseconds, trim_javascript},
};
use serde::Serialize;
use serde_json::Value;
#[derive(Debug, Clone, Serialize)]
pub struct DayAllocation<'a> {
    pub date: &'a str,
    pub minutes: i64,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedOvertimeAllocation<'a> {
    pub shift_id: &'a str,
    pub shift_revision: i64,
    pub time_zone: &'a str,
    pub allocations: Option<Vec<DayAllocation<'a>>>,
    pub revision: i64,
    pub confirmed_at: &'a str,
    pub updated_at: &'a str,
}
fn exact<'a>(
    value: &'a Value,
    keys: &[&str],
) -> Result<&'a serde_json::Map<String, Value>, OvertimeError> {
    let row = value.as_object().ok_or(OvertimeError::Object)?;
    if row.len() != keys.len() || keys.iter().any(|key| !row.contains_key(*key)) {
        return Err(OvertimeError::Format);
    }
    Ok(row)
}
pub fn validate_overtime_allocation(
    value: &Value,
) -> Result<SavedOvertimeAllocation<'_>, OvertimeError> {
    let row = exact(
        value,
        &[
            "shiftId",
            "shiftRevision",
            "timeZone",
            "allocations",
            "revision",
            "confirmedAt",
            "updatedAt",
        ],
    )?;
    let shift_id = row["shiftId"]
        .as_str()
        .filter(|s| !trim_javascript(s).is_empty() && s.encode_utf16().count() <= 200)
        .ok_or(OvertimeError::Id)?;
    let shift_revision = integer(&row["shiftRevision"])
        .filter(|n| *n >= 1)
        .ok_or(OvertimeError::Revision)?;
    let revision = integer(&row["revision"])
        .filter(|n| *n >= 1)
        .ok_or(OvertimeError::Revision)?;
    let time_zone = row["timeZone"]
        .as_str()
        .filter(|s| !s.is_empty() && !s.starts_with(['+', '-']))
        .ok_or(OvertimeError::Zone)?;
    crate::time_zone::zone(time_zone)?;
    let confirmed_at = require_instant(&row["confirmedAt"], "Bestätigung")?;
    let updated_at = require_instant(&row["updatedAt"], "Aktualisierung")?;
    if js_milliseconds(&row["confirmedAt"])
        .zip(js_milliseconds(&row["updatedAt"]))
        .is_some_and(|(a, b)| a > b)
    {
        return Err(OvertimeError::ConfirmationOrder);
    }
    let allocations = if row["allocations"].is_null() {
        None
    } else {
        let rows = row["allocations"]
            .as_array()
            .filter(|rows| (1..=2).contains(&rows.len()))
            .ok_or(OvertimeError::AllocationRequired)?;
        let mut days = vec![];
        for item in rows {
            let row = exact(item, &["date", "minutes"])?;
            let date = row["date"]
                .as_str()
                .ok_or(crate::employment::EmploymentError::InvalidDate)?;
            require_remuneration_date(date)?;
            let minutes = integer(&row["minutes"])
                .filter(|n| (0..=1500).contains(n))
                .ok_or(OvertimeError::Minutes)?;
            days.push(DayAllocation { date, minutes });
        }
        days.sort_by(|a, b| a.date.cmp(b.date));
        if days.windows(2).any(|pair| pair[0].date == pair[1].date)
            || !days.iter().any(|d| d.minutes > 0)
        {
            return Err(OvertimeError::AllocationAmbiguous);
        }
        Some(days)
    };
    Ok(SavedOvertimeAllocation {
        shift_id,
        shift_revision,
        time_zone,
        allocations,
        revision,
        confirmed_at,
        updated_at,
    })
}
pub fn is_current_overtime_allocation(value: &Value, shift: &Value, time_zone: &str) -> bool {
    value.get("allocations") != Some(&Value::Null)
        && value.get("shiftId") == shift.get("id")
        && value.get("shiftRevision").and_then(integer) == shift.get("revision").and_then(integer)
        && value["timeZone"] == time_zone
        && shift.get("deletedAt") == Some(&Value::Null)
        && shift["tariffOvertimeConfirmed"] == true
        && shift["overtimeMinutes"].as_f64().is_some_and(|n| n > 0.0)
}
