//! Snapshot-local Finance-produced seeds. Utility can only borrow retained data.
use crate::input::net_form::InitialNetSettings;
use crate::input::payroll_form::AnnualEditorSeed;
use crate::report::cache_budget::serialized_bytes;
use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex};

const MAX_MONTHS: usize = 4;
const MAX_ENTRY_BYTES: u64 = 64 * 1024;
const MAX_TOTAL_BYTES: u64 = 256 * 1024;

#[derive(Debug)]
pub(super) struct SeedSource {
    pub(super) seed: AnnualEditorSeed,
    pub(super) settings: InitialNetSettings,
    pub(super) presentation: serde_json::Value,
}
#[derive(Debug, Clone)]
pub(super) enum Lookup {
    Missing,
    Unavailable(&'static str),
    Seed(Arc<SeedSource>),
}
struct Record {
    value: Lookup,
    bytes: u64,
}
#[derive(Default)]
struct State {
    months: BTreeMap<String, Record>,
    lru: VecDeque<String>,
    bytes: u64,
}
#[derive(Default)]
pub(crate) struct PayrollFormStore {
    state: Mutex<State>,
}
impl PayrollFormStore {
    pub(super) fn lookup(&self, month: &str) -> Lookup {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.months.get(month).map(|record| record.value.clone()))
            .unwrap_or(Lookup::Missing)
    }
    pub(super) fn retain(&self, month: &str, source: SeedSource) {
        let bytes = serialized_bytes(
            &(
                &source.seed.value(),
                source.settings.settings(),
                &source.presentation,
            ),
            MAX_ENTRY_BYTES,
        );
        match bytes {
            Some(bytes) => self.insert(month, Lookup::Seed(Arc::new(source)), bytes),
            None => self.unavailable(month, "PAYROLL_FORM_LIMIT"),
        }
    }
    pub(super) fn unavailable(&self, month: &str, code: &'static str) {
        self.insert(month, Lookup::Unavailable(code), 0);
    }
    fn insert(&self, month: &str, value: Lookup, bytes: u64) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        if let Some(previous) = state.months.remove(month) {
            state.bytes -= previous.bytes;
        }
        state.lru.retain(|value| value != month);
        state.lru.push_back(month.to_owned());
        state
            .months
            .insert(month.to_owned(), Record { value, bytes });
        state.bytes += bytes;
        while state.months.len() > MAX_MONTHS || state.bytes > MAX_TOTAL_BYTES {
            let Some(oldest) = state.lru.pop_front() else {
                break;
            };
            if let Some(previous) = state.months.remove(&oldest) {
                state.bytes -= previous.bytes;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unavailable_seed_metadata_is_bounded_and_evicted_without_a_fallback() {
        let store = PayrollFormStore::default();
        for month in ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"] {
            store.unavailable(month, "NET_NOT_CONFIGURED");
        }
        assert!(matches!(store.lookup("2026-01"), Lookup::Missing));
        assert!(matches!(
            store.lookup("2026-05"),
            Lookup::Unavailable("NET_NOT_CONFIGURED")
        ));
        let state = store.state.lock().unwrap();
        assert_eq!(state.months.len(), 4);
        assert!(state.bytes <= MAX_TOTAL_BYTES);
    }
}
