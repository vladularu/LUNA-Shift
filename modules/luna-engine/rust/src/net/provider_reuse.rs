//! Optional bounded sharing of native-produced monthly money and trace cores.
use super::super::gross_evidence::{PremiumEvidence, TraceCoverage};
use crate::report::financial::{
    FinancialError,
    fingerprint::{FinancialFingerprint, FinancialFingerprintBook, LegacyFinancialView},
};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::VecDeque,
    io::{self, Write},
    sync::{Arc, Mutex},
};
const MAX_ENTRIES: usize = 48;
const MAX_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ENTRY_BYTES: u64 = 4 * 1024 * 1024;
/// No source profile, plan, employment view or externally supplied proof is
/// retained. The current snapshot must rebind all source metadata on each hit.
#[derive(Clone, Serialize)]
pub(super) struct GrossCore {
    pub pay: Value,
    pub premium_evidence: Vec<PremiumEvidence>,
    pub special_duty_traces: Vec<Value>,
    pub coverage: TraceCoverage,
}
struct Entry {
    key: FinancialFingerprint,
    value: Arc<GrossCore>,
    bytes: u64,
}
#[derive(Default)]
struct State {
    entries: VecDeque<Entry>,
    bytes: u64,
    hits: u64,
    misses: u64,
}
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrossReuseStats {
    pub entries: usize,
    pub retained_serialized_bytes: u64,
    pub hits: u64,
    pub misses: u64,
}
/// An optional native-only producer cache. Poisoned locks are an optional miss,
/// and calculations run without holding its mutex. There is no host insertion.
#[derive(Default)]
pub struct SharedGrossReuseCache(Mutex<State>);
impl SharedGrossReuseCache {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn stats(&self) -> Result<GrossReuseStats, FinancialError> {
        let state = self
            .0
            .lock()
            .map_err(|_| FinancialError::invalid("Finanzspeicher nicht verfügbar."))?;
        Ok(GrossReuseStats {
            entries: state.entries.len(),
            retained_serialized_bytes: state.bytes,
            hits: state.hits,
            misses: state.misses,
        })
    }
    pub(super) fn get(&self, key: &FinancialFingerprint) -> Option<Arc<GrossCore>> {
        let mut state = self.0.lock().ok()?;
        if let Some(index) = state.entries.iter().position(|e| &e.key == key) {
            let entry = state.entries.remove(index)?;
            let result = Arc::clone(&entry.value);
            state.entries.push_back(entry);
            state.hits = state.hits.saturating_add(1);
            Some(result)
        } else {
            state.misses = state.misses.saturating_add(1);
            None
        }
    }
    pub(super) fn insert(&self, key: FinancialFingerprint, value: Arc<GrossCore>) {
        let mut count = Count(0);
        if serde_json::to_writer(&mut count, value.as_ref()).is_err() {
            return;
        }
        let Ok(mut state) = self.0.lock() else {
            return;
        };
        if let Some(index) = state.entries.iter().position(|e| e.key == key) {
            let old = state.entries.remove(index).expect("located gross core");
            state.bytes -= old.bytes;
        }
        while state.entries.len() >= MAX_ENTRIES || state.bytes + count.0 > MAX_BYTES {
            let Some(old) = state.entries.pop_front() else {
                break;
            };
            state.bytes -= old.bytes;
        }
        state.bytes += count.0;
        state.entries.push_back(Entry {
            key,
            value,
            bytes: count.0,
        });
    }
}
pub(super) struct ReuseBinding {
    pub fingerprints: Arc<FinancialFingerprintBook>,
    pub view: LegacyFinancialView,
    pub cache: Arc<SharedGrossReuseCache>,
}
struct Count(u64);
impl Write for Count {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0 = self
            .0
            .checked_add(bytes.len() as u64)
            .filter(|n| *n <= MAX_ENTRY_BYTES)
            .ok_or_else(|| io::Error::other("gross core too large"))?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn core(text: &str) -> Arc<GrossCore> {
        Arc::new(GrossCore {
            pay: json!({"available":false,"notes":[text]}),
            premium_evidence: vec![],
            special_duty_traces: vec![],
            coverage: TraceCoverage::NotRequested,
        })
    }
    fn key(index: u8) -> FinancialFingerprint {
        FinancialFingerprint::from_native_digest([index; 32])
    }
    #[test]
    fn shared_native_gross_cache_bounds_storage_and_shares_only_result_cores() {
        let cache = SharedGrossReuseCache::new();
        let first = core("native unavailable result");
        cache.insert(key(0), Arc::clone(&first));
        assert!(Arc::ptr_eq(&cache.get(&key(0)).unwrap(), &first));
        cache.insert(key(1), core(&"x".repeat(MAX_ENTRY_BYTES as usize + 1)));
        assert!(cache.get(&key(1)).is_none());
        for index in 2..=81 {
            cache.insert(key(index), Arc::clone(&first));
        }
        assert_eq!(cache.stats().unwrap().entries, MAX_ENTRIES);
        assert!(cache.get(&key(0)).is_none());
        for index in 90..100 {
            cache.insert(key(index), core(&"x".repeat(2 * 1024 * 1024)));
        }
        let stats = cache.stats().unwrap();
        assert!(stats.retained_serialized_bytes <= MAX_BYTES);
        assert!(stats.entries < 10);
    }
    #[test]
    fn optional_shared_cache_poison_is_a_miss_and_never_native_money() {
        let cache = SharedGrossReuseCache::new();
        let poisoned = std::panic::catch_unwind(|| {
            let _guard = cache.0.lock().unwrap();
            panic!("intentional optional cache poison");
        });
        assert!(poisoned.is_err());
        assert!(cache.get(&key(0)).is_none());
        cache.insert(key(0), core("ignored"));
        assert!(cache.stats().is_err());
    }
}
