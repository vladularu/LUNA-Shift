use super::LoadedPoolError;
use crate::{
    calendar::recurrence::CollationRanks,
    runtime::collation_ranks::{self, Namespace, ParseError},
};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, sync::Arc};
pub(super) struct Candidates {
    pub values: Vec<String>,
    pub digest: String,
}
impl Candidates {
    pub fn new(set: &BTreeSet<String>, phase: &[u8]) -> Result<Self, LoadedPoolError> {
        if set.len() > 100_000 {
            return Err(LoadedPoolError::Capacity);
        }
        let mut bytes = 0usize;
        let mut wire = 2u64;
        let mut hash = Sha256::new();
        for text in [b"luna-calendar-loaded-candidates-v1".as_slice(), phase] {
            hash.update((text.len() as u64).to_be_bytes());
            hash.update(text);
        }
        for text in set {
            bytes = bytes
                .checked_add(text.len())
                .ok_or(LoadedPoolError::Capacity)?;
            if text.len() > 300_000 || bytes > 16 * 1024 * 1024 {
                return Err(LoadedPoolError::Capacity);
            }
            let encoded = crate::report::cache_budget::serialized_bytes(text, 33_554_432)
                .ok_or(LoadedPoolError::Capacity)?;
            wire = wire
                .checked_add(encoded + 12)
                .ok_or(LoadedPoolError::Capacity)?;
            if wire > 33_554_432 {
                return Err(LoadedPoolError::Capacity);
            }
            hash.update((text.len() as u64).to_be_bytes());
            hash.update(text.as_bytes());
        }
        Ok(Self {
            values: set.iter().cloned().collect(),
            digest: format!("{:x}", hash.finalize()),
        })
    }
}
pub(super) fn parse(
    raw: &[u8],
    candidates: &Candidates,
    query: bool,
    check: impl Fn() -> Result<(), LoadedPoolError>,
) -> Result<Arc<CollationRanks>, LoadedPoolError> {
    collation_ranks::parse(
        raw,
        &candidates.values,
        if query {
            Namespace::CalendarLoadedQuery
        } else {
            Namespace::CalendarLoadedCompletion
        },
        check,
    )
    .map(|result| result.ranks)
    .map_err(|error| match error {
        ParseError::InputTooLarge => LoadedPoolError::Capacity,
        ParseError::InvalidRanks => LoadedPoolError::InvalidRanks,
        ParseError::Fence(error) => error,
    })
}
