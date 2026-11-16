use super::{
    model::{FinancialPoolError, FinancialScope, Witness},
    structure::StructureIndex,
};
use crate::{calendar::recurrence::CollationRanks, runtime::PreparationMarker};
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};
pub(super) struct Ranked {
    pub ranks: Arc<CollationRanks>,
    pub digest: String,
    pub bytes: u64,
}
pub(super) struct RankOwner {
    pub index: Arc<StructureIndex>,
    pub locale: String,
    pub marker: PreparationMarker,
    pub active: AtomicBool,
    pub ranks: Mutex<Option<Ranked>>,
    pub last: AtomicU64,
    pub bytes: AtomicU64,
}
impl RankOwner {
    pub fn has_ranks(&self) -> Result<bool, FinancialPoolError> {
        Ok(self
            .ranks
            .lock()
            .map_err(|_| FinancialPoolError::Poisoned)?
            .is_some())
    }
}
pub(super) struct Draft {
    pub id: u64,
    pub owner: Arc<RankOwner>,
    pub witness: Arc<Witness>,
    pub scope: Arc<FinancialScope>,
    pub active: AtomicBool,
}
impl Draft {
    pub fn current(&self) -> Result<bool, FinancialPoolError> {
        Ok(self.active.load(Ordering::Acquire)
            && self.owner.active.load(Ordering::Acquire)
            && self.owner.marker.is_current()?
            && self.witness.current()?)
    }
    pub fn check(&self) -> Result<(), FinancialPoolError> {
        if self.current()? {
            Ok(())
        } else {
            Err(FinancialPoolError::Stale)
        }
    }
}
pub(super) enum Retired {
    Draft(Arc<Draft>),
    Proof(Arc<super::proof::FinancialAdmissionProof>),
    Owner(Arc<RankOwner>),
}
#[derive(Default)]
pub(super) struct Book {
    pub sequence: u64,
    pub drafts: BTreeMap<u64, Arc<Draft>>,
    pub proofs: BTreeMap<u64, Arc<super::proof::FinancialAdmissionProof>>,
    pub owners: Vec<Arc<RankOwner>>,
    pub retired: Vec<Retired>,
    pub bytes: u64,
    pub structure_builds: u64,
    pub rank_parses: u64,
    pub reserved: u64,
    pub failed: Vec<(
        crate::contract::SnapshotIdentity,
        crate::runtime::report::ReportIssue,
    )>,
}
