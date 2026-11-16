use super::*;
use crate::{contract::ContractError, input::calendar_rows::PreparedCalendarRows};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
pub(super) struct CalendarPreflight {
    candidates: Vec<String>,
    candidate_digest: String,
    bound: AtomicBool,
}
fn candidate_digest(
    candidates: &std::collections::BTreeSet<String>,
) -> Result<String, AssemblyError> {
    let mut digest = Sha256::new();
    digest.update(b"luna-engine-calendar-candidates-v1\0");
    digest.update(
        u32::try_from(candidates.len())
            .map_err(|_| ContractError::CollectionTooLarge)?
            .to_be_bytes(),
    );
    for text in candidates {
        digest.update(
            u32::try_from(text.len())
                .map_err(|_| ContractError::StringTooLarge)?
                .to_be_bytes(),
        );
        digest.update(text.as_bytes());
    }
    Ok(format!("{:x}", digest.finalize()))
}
fn invalid() -> AssemblyError {
    ContractError::InvalidPresence.into()
}
fn prepared<'a>(operation: &'a RawOperation<'_>) -> Result<&'a CalendarPreflight, AssemblyError> {
    if let Some(value) = operation.builder.calendar.get() {
        return Ok(value);
    }
    let raw = operation
        .body
        .as_ref()
        .and_then(|body| body.calendar_source())
        .and_then(Value::as_object)
        .ok_or_else(invalid)?;
    if !((raw.len() == 3 || (raw.len() == 4 && raw.contains_key("templateRows")))
        && ["shiftRows", "appointmentRows", "platformCollationRanks"]
            .iter()
            .all(|key| raw.contains_key(*key)))
    {
        return Err(invalid());
    }
    if !raw["platformCollationRanks"]
        .as_object()
        .is_some_and(|ranks| ranks.is_empty())
    {
        return Err(invalid());
    }
    let shifts = raw["shiftRows"].as_array().ok_or_else(invalid)?;
    let appointments = raw["appointmentRows"].as_array().ok_or_else(invalid)?;
    let templates = raw
        .get("templateRows")
        .map(|value| value.as_array().map(Vec::as_slice).ok_or_else(invalid))
        .transpose()?;
    let entries = PreparedCalendarRows::normalize_rows(shifts, appointments, templates)
        .map_err(|_| invalid())?;
    let mut candidates =
        crate::calendar::recurrence::collation_candidates(&entries).map_err(|_| invalid())?;
    candidates.extend(
        crate::compliance::preparation::check_collation_candidates(&entries)
            .map_err(|_| invalid())?,
    );
    if candidates.len() > crate::contract::MAX_SOURCE_ITEMS as usize {
        return Err(ContractError::CollectionTooLarge.into());
    }
    let value = CalendarPreflight {
        candidate_digest: candidate_digest(&candidates)?,
        candidates: candidates.into_iter().collect(),
        bound: AtomicBool::new(false),
    };
    operation
        .builder
        .calendar
        .set(value)
        .map_err(|_| AssemblyError::Capacity)?;
    operation
        .builder
        .calendar
        .get()
        .ok_or(AssemblyError::Capacity)
}
impl CalendarPreflight {
    pub(super) fn bound(&self) -> bool {
        self.bound.load(Ordering::Acquire)
    }
}
impl SnapshotAssemblyPool {
    /// One native preparation per immutable builder; later pages only traverse
    /// this retained string index. The numeric cursor never echoes a raw ID.
    pub fn calendar_candidates(
        &self,
        id: BuilderId,
        after: Option<u32>,
        limit: u16,
    ) -> Result<Value, AssemblyError> {
        let mut operation = RawOperation::new(self, id)?;
        if !(1..=1024).contains(&limit) {
            return Err(ContractError::InvalidRequest.into());
        }
        let prepared = prepared(&operation)?;
        let candidates = &prepared.candidates;
        let start = after.unwrap_or(0) as usize;
        if start > candidates.len() {
            return Err(ContractError::InvalidRequest.into());
        }
        let mut end = start;
        let mut bytes = 0usize;
        while end < candidates.len() && end - start < limit as usize {
            // A JSON control character can expand to six bytes. The first
            // accepted bounded string still fits the native 4MiB reply cap.
            let next = candidates[end]
                .len()
                .checked_mul(6)
                .and_then(|n| n.checked_add(4))
                .ok_or(ContractError::InputTooLarge)?;
            if end > start && bytes.saturating_add(next) > 2 * 1024 * 1024 {
                break;
            }
            bytes = bytes.saturating_add(next);
            end += 1;
        }
        let next = (end < candidates.len()).then_some(end as u32);
        let page = json!({"candidates":&candidates[start..end],"nextAfter":next,"total":candidates.len(),"candidateDigest":prepared.candidate_digest});
        operation.restore()?;
        Ok(page)
    }
    pub fn calendar_ranks(&self, id: BuilderId, ranks: &[u8]) -> Result<(), AssemblyError> {
        self.calendar_ranks_frame(id, ranks, 0)
    }
    pub(crate) fn calendar_ranks_frame(
        &self,
        id: BuilderId,
        ranks: &[u8],
        header_bytes: usize,
    ) -> Result<(), AssemblyError> {
        let mut operation = RawOperation::new(self, id)?;
        if prepared(&operation)?.bound() {
            return Err(invalid());
        }
        let addition = ranks
            .len()
            .checked_add(header_bytes)
            .and_then(|n| u32::try_from(n).ok())
            .ok_or(ContractError::InputTooLarge)?;
        let next = operation
            .builder
            .wire_bytes
            .load(Ordering::Relaxed)
            .checked_add(addition)
            .filter(|n| *n <= crate::contract::MAX_INPUT_BYTES)
            .ok_or(ContractError::InputTooLarge)?;
        operation
            .body
            .as_mut()
            .ok_or(AssemblyError::UnknownBuilder)?
            .bind_calendar_ranks(ranks)?;
        let bound = operation
            .body
            .as_ref()
            .and_then(|body| body.calendar_source())
            .and_then(|raw| raw.get("platformCollationRanks"))
            .and_then(Value::as_object)
            .ok_or_else(invalid)?;
        let prepared = prepared(&operation)?;
        if prepared
            .candidates
            .iter()
            .any(|text| !bound.contains_key(text))
        {
            return Err(invalid());
        }
        prepared.bound.store(true, Ordering::Release);
        operation.builder.wire_bytes.store(next, Ordering::Relaxed);
        operation.restore()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn digest_matches_independent_sha256_vector_and_frames_ambiguous_concatenation() {
        let first = ["ab".to_owned(), "c".to_owned()].into_iter().collect();
        assert_eq!(
            candidate_digest(&first).unwrap(),
            "cf05242560221791022468336d73ecaa1369f502745801cefb6e0e2794e71bf6"
        );
        let reordered = ["c".to_owned(), "ab".to_owned(), "ab".to_owned()]
            .into_iter()
            .collect();
        assert_eq!(
            candidate_digest(&first).unwrap(),
            candidate_digest(&reordered).unwrap()
        );
        let ambiguous = ["a".to_owned(), "bc".to_owned()].into_iter().collect();
        assert_ne!(
            candidate_digest(&first).unwrap(),
            candidate_digest(&ambiguous).unwrap()
        );
        assert_ne!(
            candidate_digest(&Default::default()).unwrap(),
            candidate_digest(&[String::new()].into_iter().collect()).unwrap()
        );
    }
    #[test]
    fn all_pages_share_one_prepared_candidate_allocation() {
        let registry = SnapshotRegistry::default();
        registry
            .reset_for_owner(&crate::contract::OwnerIdentity::new("rank-owner", 1).unwrap())
            .unwrap();
        let pool = SnapshotAssemblyPool::new(registry);
        let id=pool.begin(br#"{"ownerScope":"rank-owner","ownerEpoch":1,"snapshotId":"ranks","snapshotRevision":1,"referenceDate":"2026-11-13","selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}}"#).unwrap();
        pool.source(id,SourceTarget::Source,br#"{"kind":"CALENDAR_ENTRIES","source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}}}"#,br#"{"shiftRows":[],"appointmentRows":[],"platformCollationRanks":{}}"#).unwrap();
        pool.calendar_candidates(id, None, 1).unwrap();
        let builder = pool.current(id).unwrap();
        let original = builder.calendar.get().unwrap().candidates.as_ptr();
        for cursor in 1..64 {
            pool.calendar_candidates(id, Some(cursor), 1).unwrap();
            assert_eq!(
                builder.calendar.get().unwrap().candidates.as_ptr(),
                original
            );
        }
        assert!(!builder.calendar.get().unwrap().bound());
    }
}
