//! Snapshot-owned versioned day allocations. Large raw evidence is shared,
//! while the two sorted day records are admitted exactly once.
use super::{
    OvertimeError,
    saved::{DayAllocation, SavedOvertimeAllocation, validate_overtime_allocation},
};
use serde_json::Value;
use std::{collections::BTreeMap, sync::Arc};

struct Allocation {
    row: u32,
    shift_revision: i64,
    revision: i64,
    days: Option<Vec<(String, i64)>>,
}
pub struct OvertimeAllocationIndex {
    raw: Arc<Vec<Value>>,
    by_shift: BTreeMap<String, Allocation>,
}
impl OvertimeAllocationIndex {
    pub fn new(raw: Arc<Vec<Value>>) -> Result<Self, OvertimeError> {
        if raw.len() > crate::contract::MAX_SOURCE_ITEMS as usize {
            return Err(OvertimeError::InvalidInput);
        }
        let mut by_shift = BTreeMap::new();
        for (row, value) in raw.iter().enumerate() {
            let checked = validate_overtime_allocation(value)?;
            if by_shift.contains_key(checked.shift_id) {
                return Err(OvertimeError::DuplicateSaved);
            }
            by_shift.insert(
                checked.shift_id.into(),
                Allocation {
                    row: row as u32,
                    shift_revision: checked.shift_revision,
                    revision: checked.revision,
                    days: checked.allocations.map(|days| {
                        days.into_iter()
                            .map(|d| (d.date.into(), d.minutes))
                            .collect()
                    }),
                },
            );
        }
        Ok(Self { raw, by_shift })
    }
    pub fn raw(&self) -> &Arc<Vec<Value>> {
        &self.raw
    }
    pub(crate) fn matches(&self, raw: &[Value]) -> bool {
        std::ptr::eq(self.raw.as_slice(), raw)
    }
    pub(crate) fn get(&self, id: &str) -> Option<(&Value, SavedOvertimeAllocation<'_>)> {
        let record = self.by_shift.get(id)?;
        // Only new() can construct this immutable owner; these field types were
        // checked before the Arc was retained and cannot be mutated afterwards.
        let raw = &self.raw[record.row as usize];
        let text = |key: &str| raw[key].as_str().expect("checked allocation field");
        Some((
            raw,
            SavedOvertimeAllocation {
                shift_id: text("shiftId"),
                shift_revision: record.shift_revision,
                time_zone: text("timeZone"),
                allocations: record.days.as_ref().map(|days| {
                    days.iter()
                        .map(|(date, minutes)| DayAllocation {
                            date,
                            minutes: *minutes,
                        })
                        .collect()
                }),
                revision: record.revision,
                confirmed_at: text("confirmedAt"),
                updated_at: text("updatedAt"),
            },
        ))
    }
}
