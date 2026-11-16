//! Snapshot-owned paid-absence admission. Only raw confirmations are retained;
//! no monetary amounts are accepted or cached here.
use super::{
    BaseError,
    absence::{PaidAbsence, validate_paid_absence},
};
use serde_json::Value;
use std::{collections::BTreeMap, sync::Arc};

pub struct PaidAbsenceIndex {
    raw: Arc<Vec<Value>>,
    by_shift: BTreeMap<String, PaidAbsence>,
}
impl PaidAbsenceIndex {
    pub fn new(raw: Arc<Vec<Value>>) -> Result<Self, BaseError> {
        if raw.len() > crate::contract::MAX_SOURCE_ITEMS as usize {
            return Err(BaseError::InvalidCalculation);
        }
        let mut by_shift = BTreeMap::new();
        for row in raw.iter() {
            let checked = validate_paid_absence(row)?;
            if by_shift.insert(checked.shift_id.clone(), checked).is_some() {
                return Err(BaseError::DuplicateAbsence);
            }
        }
        Ok(Self { raw, by_shift })
    }
    pub fn raw(&self) -> &Arc<Vec<Value>> {
        &self.raw
    }
    pub(crate) fn get(&self, shift_id: &str) -> Option<&PaidAbsence> {
        self.by_shift.get(shift_id)
    }
    pub(crate) fn matches(&self, raw: &[Value]) -> bool {
        std::ptr::eq(self.raw.as_slice(), raw)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn source_owner_retains_original_confirmation_and_rejects_a_changed_array() {
        let row = json!({"shiftId":"absence","shiftRevision":1,"shiftDate":"2026-09-01","shiftUpdatedAt":"2026-09-01T00:00:00Z","timeZone":"Europe/Berlin","paidMinutes":0,"revision":1,"confirmedAt":"2026-09-01T00:00:00Z","updatedAt":"2026-09-01T00:00:00Z"});
        let mut raw = Arc::new(vec![row]);
        let index = PaidAbsenceIndex::new(Arc::clone(&raw)).unwrap();
        assert!(Arc::ptr_eq(index.raw(), &raw));
        assert!(index.matches(&raw));
        Arc::make_mut(&mut raw)[0]["paidMinutes"] = json!(60);
        assert!(!index.matches(&raw));
        assert_eq!(index.get("absence").unwrap().paid_minutes, Some(0));
        assert!(matches!(
            PaidAbsenceIndex::new(Arc::new(vec![index.raw[0].clone(), index.raw[0].clone()])),
            Err(BaseError::DuplicateAbsence)
        ));
    }
}
