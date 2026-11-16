use super::model::{FinancialPoolError, MAX_RETAINED_BYTES};
use crate::{
    contract::SnapshotIdentity,
    runtime::{
        facts::SnapshotFacts, financial_report::candidates::FinancialCollationCandidates,
        report::ReportIssue,
    },
};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

pub(super) struct StructureIndex {
    pub identity: SnapshotIdentity,
    pub strings: Vec<String>,
    pub digest: String,
    pub bytes: u64,
    pub rank_reservation: u64,
}
pub(super) fn build(
    facts: &SnapshotFacts,
    identity: &SnapshotIdentity,
) -> Result<StructureIndex, ReportIssue> {
    let calendar = facts.calendar().map_err(ReportIssue::from)?;
    let shifts = calendar
        .payroll_shifts()
        .map_err(|_| ReportIssue::new("FINANCIAL_CANDIDATES_INVALID"))?;
    let mut union = calendar
        .collation()
        .comparison_strings()
        .map(str::to_owned)
        .collect::<BTreeSet<_>>();
    let additional = FinancialCollationCandidates::prepare(shifts, &union)
        .map_err(|_| ReportIssue::new("FINANCIAL_COLLATION_RESOURCE_LIMIT"))?;
    union.extend(additional.into_additional());
    let strings = union.into_iter().collect::<Vec<_>>();
    let text = strings
        .iter()
        .map(|s| s.capacity() as u64 + 16)
        .sum::<u64>();
    let bytes = 4096u64
        .saturating_add(text)
        .saturating_add(strings.capacity() as u64 * 24);
    let rank_reservation = 4096u64
        .saturating_add(text)
        .saturating_add(strings.len() as u64 * 128);
    if bytes.saturating_add(rank_reservation) > MAX_RETAINED_BYTES {
        return Err(ReportIssue::new("FINANCIAL_COLLATION_RESOURCE_LIMIT"));
    }
    let mut hash = Sha256::new();
    field(&mut hash, b"luna-financial-candidates-v1");
    field(&mut hash, crate::ENGINE_VERSION.as_bytes());
    for s in &strings {
        field(&mut hash, s.as_bytes());
    }
    Ok(StructureIndex {
        identity: identity.clone(),
        strings,
        digest: format!("{:x}", hash.finalize()),
        bytes,
        rank_reservation,
    })
}
pub(super) fn field(hash: &mut Sha256, bytes: &[u8]) {
    hash.update((bytes.len() as u64).to_be_bytes());
    hash.update(bytes);
}
pub(super) fn checked_next(sequence: &mut u64) -> Result<u64, FinancialPoolError> {
    *sequence = sequence
        .checked_add(1)
        .filter(|n| *n <= crate::contract::MAX_SAFE_REVISION)
        .ok_or(FinancialPoolError::SequenceExhausted)?;
    Ok(*sequence)
}
