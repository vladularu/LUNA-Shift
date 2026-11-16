use super::{IncomingPoolError, quota::Charge};
use crate::{
    EngineError,
    calendar::incoming::{
        cache::{IncomingObservation, RetainedIncomingCache},
        raw_source::RawParseStatistics,
    },
    runtime::utility_lease::UtilityOwnerMarker,
};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

pub(super) struct SourceOwner {
    pub owner: UtilityOwnerMarker,
    pub active: Arc<AtomicBool>,
    pub token: String,
    pub cache: RetainedIncomingCache,
    pub observation: IncomingObservation,
    pub stats: RawParseStatistics,
    pub _charge: Charge,
}
#[derive(Clone)]
pub struct IncomingSourceLease(pub(super) Arc<SourceOwner>);
/// A native projection retains its source witness even after its producing
/// request ends. There is deliberately no ownership-extracting `into_value`.
pub struct IncomingSourceConsumption<T> {
    value: T,
    // Rust drops fields in declaration order. Keep the quota/source witness
    // alive until the projected data itself has finished dropping.
    source: IncomingSourceLease,
}
impl<T> IncomingSourceConsumption<T> {
    pub fn is_current(&self) -> Result<bool, IncomingPoolError> {
        self.source.is_current()
    }
    pub fn value(&self) -> Result<&T, IncomingPoolError> {
        if !self.is_current()? {
            return Err(IncomingPoolError::Stale);
        }
        Ok(&self.value)
    }
}
impl IncomingSourceLease {
    pub fn is_current(&self) -> Result<bool, IncomingPoolError> {
        Ok(self.0.active.load(Ordering::Acquire)
            && self
                .0
                .owner
                .is_current()
                .map_err(|_| IncomingPoolError::OwnerChanged)?)
    }
    pub fn source_token(&self) -> &str {
        &self.0.token
    }
    pub fn statistics(&self) -> &RawParseStatistics {
        &self.0.stats
    }
    /// Native-only borrowed consumption. This is not a deserializable source proof.
    pub fn with_observation<T>(
        &self,
        consumer: impl FnOnce(&IncomingObservation) -> Result<T, EngineError>,
    ) -> Result<IncomingSourceConsumption<T>, IncomingPoolError> {
        if !self.is_current()? {
            return Err(IncomingPoolError::Stale);
        }
        let result = consumer(&self.0.observation).map_err(IncomingPoolError::Projection)?;
        if !self.is_current()? {
            return Err(IncomingPoolError::Stale);
        }
        Ok(IncomingSourceConsumption {
            source: self.clone(),
            value: result,
        })
    }
}
