//! Native legal-window selection preserves original row order and revision alternatives.
use super::{
    average::add_days,
    model::{ComplianceError, number, text},
    window,
};
use crate::{EngineError, calendar::parse_date, rules::RuleResolver};
use serde_json::Value;
use std::{collections::BTreeMap, sync::Arc};
enum EntryOwner {
    Slice(Arc<[Value]>),
    Shared(Arc<Vec<Value>>),
}
impl std::ops::Deref for EntryOwner {
    type Target = [Value];
    fn deref(&self) -> &Self::Target {
        match self {
            Self::Slice(v) => v,
            Self::Shared(v) => v.as_slice(),
        }
    }
}
struct Latest {
    winner: usize,
    alternatives: Vec<usize>,
}
pub struct PreparedComplianceEntries {
    entries: EntryOwner,
    latest: Vec<Latest>,
}
impl PreparedComplianceEntries {
    pub fn new(entries: Arc<[Value]>) -> Result<Self, ComplianceError> {
        Self::prepare(EntryOwner::Slice(entries))
    }
    /// Share the original immutable calendar vector without cloning its metadata.
    pub fn from_shared(entries: Arc<Vec<Value>>) -> Result<Self, ComplianceError> {
        Self::prepare(EntryOwner::Shared(entries))
    }
    fn prepare(entries: EntryOwner) -> Result<Self, ComplianceError> {
        let mut latest = Vec::<Latest>::new();
        let mut indices = BTreeMap::new();
        for (index, entry) in entries.iter().enumerate() {
            if entry["kind"] != "SHIFT" {
                continue;
            }
            let id = text(entry, "id")?;
            let Some(position) = indices.get(id).copied() else {
                indices.insert(id.to_owned(), latest.len());
                latest.push(Latest {
                    winner: index,
                    alternatives: Vec::new(),
                });
                continue;
            };
            let current: &mut Latest = &mut latest[position];
            let old = &entries[current.winner];
            let revision = number(entry, "revision")?;
            let old_revision = number(old, "revision")?;
            let update = text(entry, "updatedAt")?;
            let old_update = text(old, "updatedAt")?;
            let order = update.encode_utf16().cmp(old_update.encode_utf16());
            if revision > old_revision
                || revision == old_revision
                    && (order.is_gt()
                        || order.is_eq() && entry.get("deletedAt") != Some(&Value::Null))
            {
                current.winner = index;
                current.alternatives.clear();
            } else if revision == old_revision
                && update == old_update
                && old.get("deletedAt") == Some(&Value::Null)
                && entry.get("deletedAt") == Some(&Value::Null)
                && !same_signature(old, entry)
            {
                if current.alternatives.is_empty() {
                    current.alternatives.push(current.winner);
                }
                if !current
                    .alternatives
                    .iter()
                    .any(|i| same_signature(&entries[*i], entry))
                {
                    current.alternatives.push(index);
                }
            }
        }
        Ok(Self { entries, latest })
    }
    pub fn entries(&self) -> &[Value] {
        &self.entries
    }
    pub fn select(
        &self,
        month: &str,
        resolver: &RuleResolver,
    ) -> Result<Vec<&Value>, ComplianceError> {
        let (from, through) = compliance_range(month, resolver)?;
        let mut result = Vec::new();
        for latest in &self.latest {
            let rows = if latest.alternatives.is_empty() {
                std::slice::from_ref(&latest.winner)
            } else {
                latest.alternatives.as_slice()
            };
            for index in rows {
                let entry = &self.entries[*index];
                if entry.get("deletedAt") == Some(&Value::Null) {
                    let date = text(entry, "date")?;
                    if date >= from.as_str() && date <= through.as_str() {
                        result.push(entry);
                    }
                }
            }
        }
        Ok(result)
    }
}
pub fn compliance_range(
    month: &str,
    resolver: &RuleResolver,
) -> Result<(String, String), ComplianceError> {
    let first = parse_date(&format!("{month}-01"))?;
    let legal = window::legal_calculation_window(&first.to_string(), resolver)?;
    let base = add_days(first, -legal.lookback_days)?;
    let year_start =
        jiff::civil::Date::new(first.year(), 1, 1).map_err(|_| EngineError::InvalidDate)?;
    let legal_start = if legal.calendar_year_coverage {
        base.min(year_start)
    } else {
        base
    }
    .to_string();
    let start = legal_start.min(window::planning_weekend_coverage_start(month)?);
    let base_end = window::calculation_end(first.last_of_month(), &legal)?;
    let year_end =
        jiff::civil::Date::new(first.year(), 12, 31).map_err(|_| EngineError::InvalidDate)?;
    let end = if legal.calendar_year_coverage {
        base_end.max(year_end)
    } else {
        base_end
    }
    .to_string();
    Ok((start, end))
}

fn ordered_json_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| ordered_json_equal(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .zip(b)
                    .all(|((ak, av), (bk, bv))| ak == bk && ordered_json_equal(av, bv))
        }
        _ => a == b,
    }
}
pub(super) fn same_signature(a: &Value, b: &Value) -> bool {
    [
        "date",
        "type",
        "allDay",
        "startTime",
        "endTime",
        "breakMinutes",
        "specialDuty",
    ]
    .iter()
    .all(|key| {
        ordered_json_equal(
            a.get(key).unwrap_or(&Value::Null),
            b.get(key).unwrap_or(&Value::Null),
        )
    })
}

#[cfg(test)]
mod shared_owner_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn fifty_thousand_calendar_records_keep_the_same_borrowed_metadata_storage() {
        let entries=Arc::new((0..50_000).map(|i|json!({"kind":"SHIFT","id":format!("owner-{i}"),"date":"2026-07-01","revision":1,"updatedAt":"2026-01-01T00:00:00Z","deletedAt":null})).collect::<Vec<_>>());
        let prepared = PreparedComplianceEntries::from_shared(Arc::clone(&entries)).unwrap();
        assert_eq!(Arc::strong_count(&entries), 2);
        assert!(std::ptr::eq(prepared.entries().as_ptr(), entries.as_ptr()));
        assert_eq!(prepared.latest.len(), 50_000);
        drop(prepared);
        assert_eq!(Arc::strong_count(&entries), 1);
    }
}
