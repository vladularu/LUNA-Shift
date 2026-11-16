use super::{FinancialError, canonical::value_digest};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
pub(super) struct Record {
    pub position: usize,
    pub digest: [u8; 32],
    pub special: bool,
    pub months: BTreeSet<String>,
}
/// Share this immutable source-derived plan handle across books when the same
/// admitted raw entry Arc is reused. Pointer lookups never enter a content key.
pub struct FinancialFingerprintPlan {
    pub(super) entries: Arc<Vec<Value>>,
    pub(super) records: Vec<Record>,
    pub(super) by_pointer: BTreeMap<usize, usize>,
    pub(super) visits: usize,
}
impl FinancialFingerprintPlan {
    pub(crate) fn digest_for_entry(&self, entry: &Value) -> Option<&[u8; 32]> {
        self.by_pointer
            .get(&(entry as *const Value as usize))
            .map(|index| &self.records[*index].digest)
    }
    pub fn new(entries: Arc<Vec<Value>>) -> Result<Self, FinancialError> {
        if entries.len() > crate::contract::MAX_SOURCE_ITEMS as usize {
            return Err(FinancialError::invalid("Zu viele Finanzquelleinträge."));
        }
        let mut records = Vec::new();
        let mut by_pointer = BTreeMap::new();
        let mut visits = 0;
        for (position, entry) in entries.iter().enumerate() {
            if entry["kind"] != "SHIFT" || entry.get("deletedAt") != Some(&Value::Null) {
                continue;
            }
            let special = crate::net::js_truthy(&entry["specialDuty"]);
            let dates = if special {
                crate::credit::duty::duty_calendar_dates(entry).map_err(|_| {
                    FinancialError::invalid("Ungültiger Dienstraum für den Finanzschlüssel.")
                })?
            } else {
                vec![
                    entry["date"]
                        .as_str()
                        .ok_or_else(|| FinancialError::invalid("Ungültiges Dienstdatum."))?
                        .to_owned(),
                ]
            };
            let months = dates
                .into_iter()
                .map(|d| {
                    d.get(..7)
                        .map(str::to_owned)
                        .ok_or_else(|| FinancialError::invalid("Ungültiger Dienstmonat."))
                })
                .collect::<Result<BTreeSet<_>, _>>()?;
            let (digest, count) = value_digest(entry, false)?;
            visits += count;
            by_pointer.insert(entry as *const Value as usize, records.len());
            records.push(Record {
                position,
                digest,
                special,
                months,
            });
        }
        Ok(Self {
            entries,
            records,
            by_pointer,
            visits,
        })
    }
    pub fn entries(&self) -> &Arc<Vec<Value>> {
        &self.entries
    }
}
