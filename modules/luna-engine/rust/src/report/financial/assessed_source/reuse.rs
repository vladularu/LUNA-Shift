//! Closed native producer cache; monetary results cannot be imported from transport.
use super::{
    super::{FinancialError, fingerprint::StableFinancialDataSpace},
    cache::{CacheStats, MonthCache},
};
use std::sync::Arc;
pub struct SharedAssessedReuseCache {
    pub(super) cache: MonthCache,
}
impl Default for SharedAssessedReuseCache {
    fn default() -> Self {
        Self::new()
    }
}
impl SharedAssessedReuseCache {
    pub fn new() -> Self {
        Self {
            cache: MonthCache::new(),
        }
    }
    pub fn stats(&self) -> Result<CacheStats, FinancialError> {
        self.cache.stats()
    }
}
pub(super) struct ReuseBinding {
    pub space: StableFinancialDataSpace,
    pub cache: Arc<SharedAssessedReuseCache>,
    pub index: super::fingerprint::AssessedFingerprintIndex,
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::financial::assessed::NativeAssessedMonth;
    use serde_json::json;
    #[test]
    fn shared_producer_cache_retains_arcs_distinguishes_none_and_enforces_byte_bounds() {
        let cache = SharedAssessedReuseCache::new();
        let value = NativeAssessedMonth::from_native(json!({"month":"2026-05","complete":false}));
        cache
            .cache
            .insert("native-key", Some(value.clone()))
            .unwrap();
        let same = cache.cache.get("native-key").unwrap().unwrap().unwrap();
        assert!(std::ptr::eq(value.value(), same.value()));
        cache.cache.insert("unavailable", None).unwrap();
        assert!(cache.cache.get("unavailable").unwrap().unwrap().is_none());
        let large = NativeAssessedMonth::from_native(
            json!({"month":"2026-06","label":"x".repeat(4*1024*1024)}),
        );
        cache.cache.insert("too-large", Some(large)).unwrap();
        assert!(cache.cache.get("too-large").unwrap().is_none());
        for index in 0..80 {
            cache
                .cache
                .insert(&format!("native-{index}"), Some(value.clone()))
                .unwrap();
        }
        let stats = cache.stats().unwrap();
        assert!(stats.entries <= 48);
        assert!(stats.retained_serialized_bytes <= 16 * 1024 * 1024);
    }
}
