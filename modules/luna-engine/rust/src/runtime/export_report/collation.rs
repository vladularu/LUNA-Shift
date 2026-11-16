//! Export-only structural admission. No calculation or host Ready constructor.
use super::{
    ExportTimeError,
    structure::{ExportStructureIndex, MAX_CANDIDATE_BYTES},
};
use crate::{
    calendar::recurrence::CollationRanks,
    report::export_rows::ReportComparisonCandidates,
    runtime::{
        collation_ranks::{self, Namespace, ParseError},
        utility_lease::UtilityOwnerMarker,
        write_resource::WriteContextStamp,
    },
};
use sha2::{Digest, Sha256};
use std::sync::Arc;
#[derive(Debug)]
pub enum ExportCollationError {
    OwnerChanged,
    InvalidStamp,
    InvalidRanks,
    TooLarge,
    ForeignBinding,
    Structure(ExportTimeError),
}
impl std::fmt::Display for ExportCollationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Die Export-Sortierung ist nicht verf\u{00fc}gbar.")
    }
}
impl std::error::Error for ExportCollationError {}
fn check(owner: &UtilityOwnerMarker) -> Result<(), ExportCollationError> {
    if owner
        .is_current()
        .map_err(|_| ExportCollationError::OwnerChanged)?
    {
        Ok(())
    } else {
        Err(ExportCollationError::OwnerChanged)
    }
}
fn check_source(
    owner: &UtilityOwnerMarker,
    index: &ExportStructureIndex,
) -> Result<(), ExportCollationError> {
    check(owner)?;
    if !index.shares_owner(owner) {
        return Err(ExportCollationError::ForeignBinding);
    }
    index.check_live().map_err(ExportCollationError::Structure)
}
fn field(hash: &mut Sha256, bytes: &[u8]) {
    hash.update((bytes.len() as u64).to_be_bytes());
    hash.update(bytes);
}
/// All owners are native. This type cannot be deserialized or built from ranks.
pub struct ExportCollationDraft {
    owner: UtilityOwnerMarker,
    stamp: WriteContextStamp,
    index: Arc<ExportStructureIndex>,
    period: String,
    candidates: ReportComparisonCandidates,
    candidate_digest: String,
}
impl ExportCollationDraft {
    pub fn prepare(
        owner: UtilityOwnerMarker,
        stamp: WriteContextStamp,
        index: Arc<ExportStructureIndex>,
        period: &str,
    ) -> Result<Self, ExportCollationError> {
        check_source(&owner, &index)?;
        stamp
            .validate()
            .map_err(|_| ExportCollationError::InvalidStamp)?;
        let candidates = index
            .candidates(period)
            .map_err(ExportCollationError::Structure)?;
        let mut hash = Sha256::new();
        field(&mut hash, b"luna-report-export-candidates-v1");
        field(&mut hash, crate::ENGINE_VERSION.as_bytes());
        field(&mut hash, period.as_bytes());
        for text in candidates.strings() {
            field(&mut hash, text.as_bytes());
        }
        check_source(&owner, &index)?;
        Ok(Self {
            owner,
            stamp,
            index,
            period: period.to_owned(),
            candidates,
            candidate_digest: format!("{:x}", hash.finalize()),
        })
    }
    pub fn candidates(&self) -> Result<&[String], ExportCollationError> {
        check_source(&self.owner, &self.index)?;
        Ok(self.candidates.strings())
    }
    pub fn candidate_digest(&self) -> Result<&str, ExportCollationError> {
        check_source(&self.owner, &self.index)?;
        Ok(&self.candidate_digest)
    }
    pub fn finalize(
        self,
        original_rank_json: &[u8],
    ) -> Result<VerifiedExportCollation, ExportCollationError> {
        self.finalize_with(original_rank_json, || Ok(()))
    }
    fn finalize_with(
        self,
        original_rank_json: &[u8],
        extra_check: impl Fn() -> Result<(), ExportCollationError>,
    ) -> Result<VerifiedExportCollation, ExportCollationError> {
        check_source(&self.owner, &self.index)?;
        let parsed = collation_ranks::parse(
            original_rank_json,
            self.candidates.strings(),
            Namespace::ReportExport,
            || {
                check_source(&self.owner, &self.index)?;
                extra_check()?;
                check_source(&self.owner, &self.index)
            },
        )
        .map_err(|error| match error {
            ParseError::InputTooLarge => ExportCollationError::TooLarge,
            ParseError::InvalidRanks => ExportCollationError::InvalidRanks,
            ParseError::Fence(error) => error,
        })?;
        let candidate_bytes = self.candidates.strings().iter().fold(
            4096_u64 + self.candidates.strings().len() as u64 * 24,
            |bytes, text| bytes.saturating_add(text.capacity() as u64 + 16),
        );
        let combined = candidate_bytes.saturating_add(parsed.bytes);
        if combined > MAX_CANDIDATE_BYTES as u64
            || combined > self.candidates.reserved_bytes() as u64
        {
            return Err(ExportCollationError::TooLarge);
        }
        check_source(&self.owner, &self.index)?;
        Ok(VerifiedExportCollation {
            owner: self.owner,
            stamp: self.stamp,
            index: self.index,
            period: self.period,
            candidate_digest: self.candidate_digest,
            ranks: parsed.ranks,
            rank_digest: parsed.digest,
            rank_bytes: parsed.bytes,
        })
    }
}
pub struct VerifiedExportCollation {
    owner: UtilityOwnerMarker,
    stamp: WriteContextStamp,
    index: Arc<ExportStructureIndex>,
    period: String,
    candidate_digest: String,
    ranks: Arc<CollationRanks>,
    rank_digest: String,
    rank_bytes: u64,
}
impl VerifiedExportCollation {
    pub fn verified_rank(&self, text: &str) -> Result<u32, ExportCollationError> {
        check_source(&self.owner, &self.index)?;
        self.ranks
            .rank(text)
            .map_err(|_| ExportCollationError::InvalidRanks)
    }
    pub fn candidate_digest(&self) -> Result<&str, ExportCollationError> {
        check_source(&self.owner, &self.index)?;
        Ok(&self.candidate_digest)
    }
    pub fn rank_digest(&self) -> Result<&str, ExportCollationError> {
        check_source(&self.owner, &self.index)?;
        Ok(&self.rank_digest)
    }
    pub fn retained_rank_bytes(&self) -> Result<u64, ExportCollationError> {
        check_source(&self.owner, &self.index)?;
        Ok(self.rank_bytes)
    }
    pub fn is_current(&self) -> Result<bool, ExportCollationError> {
        Ok(self
            .owner
            .is_current()
            .map_err(|_| ExportCollationError::OwnerChanged)?
            && self
                .index
                .is_current()
                .map_err(ExportCollationError::Structure)?
            && self.index.shares_owner(&self.owner))
    }
    pub fn ranks_for(
        &self,
        owner: &UtilityOwnerMarker,
        stamp: &WriteContextStamp,
        index: &Arc<ExportStructureIndex>,
        period: &str,
    ) -> Result<&CollationRanks, ExportCollationError> {
        check_source(&self.owner, &self.index)?;
        check(owner)?;
        if !self.owner.shares_owner(owner)
            || &self.stamp != stamp
            || !Arc::ptr_eq(&self.index, index)
            || self.period != period
        {
            return Err(ExportCollationError::ForeignBinding);
        }
        Ok(&self.ranks)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        contract::OwnerIdentity, input::calendar_rows::PreparedCalendarRows,
        runtime::SnapshotRegistry,
    };
    use serde_json::json;
    use std::cell::Cell;
    #[test]
    fn owner_reset_after_complete_parse_never_mints_an_export_proof() {
        let registry = SnapshotRegistry::default();
        registry
            .reset_for_owner(&OwnerIdentity::new("export", 1).unwrap())
            .unwrap();
        let calendar = PreparedCalendarRows::from_rows(Arc::new(vec![]), Arc::new(vec![]))
            .unwrap()
            .into_ranked_owned(CollationRanks::default())
            .unwrap();
        let index = Arc::new(ExportStructureIndex::from_calendar(Arc::new(calendar)).unwrap());
        let stamp=WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35})).unwrap();
        let draft = ExportCollationDraft::prepare(
            registry.utility_owner_marker().unwrap(),
            stamp,
            index,
            "2026",
        )
        .unwrap();
        let calls = Cell::new(0);
        let result = draft.finalize_with(b"{}", || {
            calls.set(calls.get() + 1);
            if calls.get() == 3 {
                registry.reset().unwrap();
            }
            Ok(())
        });
        assert!(matches!(result, Err(ExportCollationError::OwnerChanged)));
        assert_eq!(calls.get(), 3);
    }
    #[test]
    fn loaded_source_change_after_complete_rank_parse_never_mints_an_export_proof() {
        use crate::{
            calendar::loaded_scope::RawScopeRows,
            runtime::calendar_loaded::{CalendarLoadedPool, LoadedStart},
        };
        let registry = SnapshotRegistry::default();
        registry
            .reset_for_owner(&OwnerIdentity::new("export", 1).unwrap())
            .unwrap();
        let owner = registry.utility_owner_marker().unwrap();
        let pool = CalendarLoadedPool::new(registry);
        pool.bind_locale("boundary-only").unwrap();
        let LoadedStart::Read(ticket) = pool
            .active_month("2026-11", 1_794_744_000_000, "rows")
            .unwrap()
        else {
            panic!()
        };
        let intake = pool.reserve_source(&ticket).unwrap();
        let raw = RawScopeRows::new(Arc::from([]), Arc::from([]), Arc::from([])).unwrap();
        let query = pool.prepare_query(intake, raw).unwrap();
        let completion = pool.finish_query(query, b"{}").unwrap();
        let source = pool.finalize_cached(completion).unwrap().source.unwrap();
        let index = Arc::new(ExportStructureIndex::from_loaded(source).unwrap());
        let stamp=WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35})).unwrap();
        let draft = ExportCollationDraft::prepare(owner.clone(), stamp, index, "2026-11").unwrap();
        let calls = Cell::new(0);
        let result = draft.finalize_with(b"{}", || {
            calls.set(calls.get() + 1);
            if calls.get() == 3 {
                pool.reload(false, 1_794_744_000_000, "rows").unwrap();
            }
            Ok(())
        });
        assert!(owner.is_current().unwrap());
        assert!(matches!(
            result,
            Err(ExportCollationError::Structure(
                ExportTimeError::StaleSource
            ))
        ));
        assert_eq!(calls.get(), 3);
    }
}
