//! Original repository rows enter here; normalized entries and recurrence
//! instances are produced only by the native calendar implementation.
use crate::{
    calendar::recurrence::CollationRanks,
    input::{
        InputError,
        calendar_rows::{PreparedCalendarRows, RawCalendarEntries},
    },
};
use serde_json::{Value, json};
use std::{
    collections::BTreeSet,
    ops::Bound::{Excluded, Unbounded},
    sync::Arc,
};

pub struct PreparedCalendarSource {
    rows: PreparedCalendarRows,
    ranks: CollationRanks,
}

/// Bounded transport pages keep locale preflight independent of the C reply
/// size. Ordering here is only a cursor protocol; the platform derives locale
/// equivalence ranks after collecting all native-generated strings.
pub fn candidate_page(request: &Value) -> Result<Value, InputError> {
    let invalid = || InputError::validation("Die Kalender-Sortieranfrage ist ungültig.");
    let request = request
        .as_object()
        .filter(|v| {
            v.len() == 3
                && ["calendar", "after", "limit"]
                    .iter()
                    .all(|k| v.contains_key(*k))
        })
        .ok_or_else(invalid)?;
    let limit = request["limit"]
        .as_u64()
        .filter(|n| (1..=1024).contains(n))
        .ok_or_else(invalid)? as usize;
    let after = match &request["after"] {
        Value::Null => None,
        Value::String(s) => Some(s.as_str()),
        _ => return Err(invalid()),
    };
    let calendar = PreparedCalendarSource::try_from_value(&request["calendar"])?;
    let candidates = calendar.collation_candidates();
    if after.is_some_and(|cursor| !candidates.contains(cursor)) {
        return Err(invalid());
    }
    let mut page = candidates
        .range::<str, _>((after.map(Excluded).unwrap_or(Unbounded), Unbounded))
        .take(limit + 1)
        .collect::<Vec<_>>();
    let more = page.len() > limit;
    if more {
        page.pop();
    }
    let next = if more { page.last().copied() } else { None };
    Ok(json!({"candidates":page,"nextAfter":next,"total":candidates.len()}))
}
impl PreparedCalendarSource {
    /// Also used by the platform's collation preflight. Missing comparison
    /// ranks may be supplied only after candidates have been obtained natively.
    /// The final conversion still requires every rank used by the source sort.
    pub fn try_from_value(value: &Value) -> Result<Self, InputError> {
        let invalid = || InputError::validation("Die Kalenderquelle enthält ungültige Rohdaten.");
        let value = value
            .as_object()
            .filter(|v| {
                (v.len() == 3 || (v.len() == 4 && v.contains_key("templateRows")))
                    && ["shiftRows", "appointmentRows", "platformCollationRanks"]
                        .iter()
                        .all(|k| v.contains_key(*k))
            })
            .ok_or_else(invalid)?;
        let shifts = value["shiftRows"].as_array().ok_or_else(invalid)?;
        let appointments = value["appointmentRows"].as_array().ok_or_else(invalid)?;
        let templates = value
            .get("templateRows")
            .map(|v| v.as_array().ok_or_else(invalid))
            .transpose()?;
        let ranks = serde_json::from_value(value["platformCollationRanks"].clone())
            .map_err(|_| invalid())?;
        Ok(Self {
            rows: if let Some(templates) = templates {
                PreparedCalendarRows::from_rows_with_templates(
                    Arc::new(shifts.clone()),
                    Arc::new(appointments.clone()),
                    templates,
                )?
            } else {
                PreparedCalendarRows::from_rows(
                    Arc::new(shifts.clone()),
                    Arc::new(appointments.clone()),
                )?
            },
            ranks,
        })
    }
    pub fn collation_candidates(&self) -> &BTreeSet<String> {
        self.rows.collation_candidates()
    }
    pub fn into_ready(self) -> Result<RawCalendarEntries, InputError> {
        self.rows.into_ranked_owned(self.ranks)
    }
}
