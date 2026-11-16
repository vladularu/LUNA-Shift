use super::super::{FinancialError, assessed::NativeAssessedMonth};
use serde::Serialize;
use std::{
    collections::VecDeque,
    io::{self, Write},
    sync::Mutex,
};
const MAX_MONTHS: usize = 48;
const MAX_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ENTRY_BYTES: u64 = 4 * 1024 * 1024;
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub entries: u16,
    pub retained_serialized_bytes: u64,
    pub hits: u64,
    pub misses: u64,
    pub calculations: u64,
}
struct Entry {
    month: String,
    value: Option<NativeAssessedMonth>,
    bytes: u64,
}
struct State {
    entries: VecDeque<Entry>,
    bytes: u64,
    hits: u64,
    misses: u64,
    calculations: u64,
}
pub(super) struct MonthCache(Mutex<State>);
impl MonthCache {
    pub fn new() -> Self {
        Self(Mutex::new(State {
            entries: VecDeque::new(),
            bytes: 0,
            hits: 0,
            misses: 0,
            calculations: 0,
        }))
    }
    pub fn get(&self, month: &str) -> Result<Option<Option<NativeAssessedMonth>>, FinancialError> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| FinancialError::invalid("Vergütungsspeicher nicht verfügbar."))?;
        if let Some(index) = state.entries.iter().position(|e| e.month == month) {
            let entry = state.entries.remove(index).expect("located cache entry");
            let value = entry.value.clone();
            state.entries.push_back(entry);
            state.hits = state.hits.saturating_add(1);
            Ok(Some(value))
        } else {
            state.misses = state.misses.saturating_add(1);
            Ok(None)
        }
    }
    pub fn calculation(&self) -> Result<(), FinancialError> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| FinancialError::invalid("Vergütungsspeicher nicht verfügbar."))?;
        state.calculations = state.calculations.saturating_add(1);
        Ok(())
    }
    pub fn insert(
        &self,
        month: &str,
        value: Option<NativeAssessedMonth>,
    ) -> Result<(), FinancialError> {
        let mut count = Count(0);
        if serde_json::to_writer(&mut count, &value.as_ref().map(NativeAssessedMonth::value))
            .is_err()
        {
            return Ok(());
        }
        let bytes = count.0;
        let mut state = self
            .0
            .lock()
            .map_err(|_| FinancialError::invalid("Vergütungsspeicher nicht verfügbar."))?;
        // A concurrent request can complete the same immutable month. Keep one
        // source-bound entry without holding the cache lock during calculation.
        if let Some(index) = state.entries.iter().position(|e| e.month == month) {
            let old = state.entries.remove(index).expect("located cache entry");
            state.bytes -= old.bytes;
        }
        while state.entries.len() >= MAX_MONTHS || state.bytes + bytes > MAX_BYTES {
            let Some(old) = state.entries.pop_front() else {
                break;
            };
            state.bytes -= old.bytes;
        }
        state.bytes += bytes;
        state.entries.push_back(Entry {
            month: month.into(),
            value,
            bytes,
        });
        Ok(())
    }
    pub fn stats(&self) -> Result<CacheStats, FinancialError> {
        let state = self
            .0
            .lock()
            .map_err(|_| FinancialError::invalid("Vergütungsspeicher nicht verfügbar."))?;
        Ok(CacheStats {
            entries: state.entries.len() as u16,
            retained_serialized_bytes: state.bytes,
            hits: state.hits,
            misses: state.misses,
            calculations: state.calculations,
        })
    }
}
struct Count(u64);
impl Write for Count {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0 = self
            .0
            .checked_add(bytes.len() as u64)
            .filter(|n| *n <= MAX_ENTRY_BYTES)
            .ok_or_else(|| io::Error::other("cache entry too large"))?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    #[test]
    fn cached_months_share_result_storage_and_evict_the_least_recent_month() {
        let cache = MonthCache::new();
        let value = NativeAssessedMonth::from_native(json!({"month":"2026-01","complete":false}));
        cache.insert("2026-01", Some(value.clone())).unwrap();
        let reused = cache.get("2026-01").unwrap().unwrap().unwrap();
        assert!(std::ptr::eq(reused.value(), value.value()));
        for index in 0..60 {
            let month = format!("{}-{:02}", 2027 + index / 12, index % 12 + 1);
            cache
                .insert(
                    &month,
                    Some(NativeAssessedMonth::from_native(json!({"month":month}))),
                )
                .unwrap();
        }
        assert_eq!(cache.stats().unwrap().entries, 48);
        assert!(cache.get("2026-01").unwrap().is_none());
        assert!(cache.get("2031-12").unwrap().is_some());
    }
    #[test]
    fn oversized_months_are_not_retained_and_cache_byte_accounting_is_bounded() {
        let cache = MonthCache::new();
        let huge = NativeAssessedMonth::from_native(Value::String(
            "x".repeat(MAX_ENTRY_BYTES as usize + 1),
        ));
        cache.insert("2026-01", Some(huge)).unwrap();
        assert_eq!(cache.stats().unwrap().entries, 0);
        for index in 1..=10 {
            cache
                .insert(
                    &format!("2026-{index:02}"),
                    Some(NativeAssessedMonth::from_native(
                        json!({"text":"x".repeat(2*1024*1024)}),
                    )),
                )
                .unwrap();
        }
        let stats = cache.stats().unwrap();
        assert!(stats.retained_serialized_bytes <= MAX_BYTES);
        assert!(stats.entries < 10);
    }
    #[test]
    fn unavailable_month_is_a_cached_null_result_and_not_a_ready_zero_pay_object() {
        let cache = MonthCache::new();
        assert!(cache.get("2026-09").unwrap().is_none());
        cache.insert("2026-09", None).unwrap();
        assert!(matches!(cache.get("2026-09").unwrap(), Some(None)));
        assert_eq!(cache.stats().unwrap().hits, 1);
        assert_eq!(cache.stats().unwrap().entries, 1);
    }
}
