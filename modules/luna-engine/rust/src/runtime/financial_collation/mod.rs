//! Private structural resources. No financial calculation runs in this service.
mod book;
mod finalize;
mod model;
mod pool;
mod proof;
mod structure;
use super::SnapshotRegistry;
pub use model::{FinancialPoolError, FinancialScope, PoolStats, PrepareCompletion};
pub use proof::{FinalizeCompletion, FinancialAdmissionProof};
use std::sync::{Arc, Mutex, atomic::AtomicBool};
#[derive(Clone)]
pub struct FinancialCollationPool {
    registry: SnapshotRegistry,
    state: Arc<Mutex<book::Book>>,
    raw: Arc<AtomicBool>,
}
impl FinancialCollationPool {
    pub fn new(registry: SnapshotRegistry) -> Self {
        Self {
            registry,
            state: Arc::new(Mutex::new(book::Book {
                bytes: 1024 * 1024,
                ..Default::default()
            })),
            raw: Arc::new(AtomicBool::new(false)),
        }
    }
}
pub struct CandidatePageCompletion {
    draft: Arc<book::Draft>,
    start: usize,
    end: usize,
}
impl CandidatePageCompletion {
    pub fn is_current(&self) -> Result<bool, FinancialPoolError> {
        self.draft.current()
    }
    pub fn serialize_current(&self) -> Result<Vec<u8>, FinancialPoolError> {
        self.draft.check()?;
        let strings = &self.draft.owner.index.strings;
        model::response(
            "FINANCIAL_COLLATION_CANDIDATES",
            &self.draft.scope,
            serde_json::json!({"draftId":self.draft.id,"page":{"candidates":&strings[self.start..self.end],"nextAfter":(self.end<strings.len()).then_some(self.end),"total":strings.len(),"candidateDigest":self.draft.owner.index.digest}}),
            || self.is_current(),
        )
    }
}
