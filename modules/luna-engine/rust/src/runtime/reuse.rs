//! Bounded native OUTPUT pools survive immutable snapshot replacements.
//! Every entry is keyed by native semantic inputs and a stable data space;
//! lifecycle generations, request IDs and host Ready values are never keys.
use crate::{
    net::provider::reuse::SharedGrossReuseCache,
    report::financial::{
        assessed_source::SharedAssessedReuseCache, net::reuse::SharedNetReuseCache,
    },
};
use std::sync::Arc;
#[derive(Default)]
pub(crate) struct FinancialReuseCaches {
    pub assessed: Arc<SharedAssessedReuseCache>,
    pub gross: Arc<SharedGrossReuseCache>,
    pub net: Arc<SharedNetReuseCache>,
}
impl std::fmt::Debug for FinancialReuseCaches {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FinancialReuseCaches")
            .finish_non_exhaustive()
    }
}
