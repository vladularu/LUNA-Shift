//! Native forecast memoization bound to one immutable SnapshotFacts owner.
use crate::{
    contract::SalaryPerspective,
    report::cache_budget::serialized_bytes,
    runtime::report::{ReportIssue, SectionOutput},
};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex, OnceLock},
};
const MAX_MONTHS: usize = 4;
const MAX_ENTRY_BYTES: u64 = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 16 * 1024 * 1024;
struct Entry {
    month: String,
    perspective: SalaryPerspective,
    slot: Arc<OnceLock<Arc<SectionOutput>>>,
    bytes: Option<u64>,
}
#[derive(Default)]
struct State {
    entries: VecDeque<Entry>,
    bytes: u64,
}
#[derive(Default)]
pub(crate) struct PayrollNetCache {
    state: Mutex<State>,
}
impl PayrollNetCache {
    pub(super) fn get_or_prepare(
        &self,
        month: &str,
        perspective: SalaryPerspective,
        prepare: impl FnOnce() -> SectionOutput,
    ) -> Result<Arc<SectionOutput>, ReportIssue> {
        // Map bookkeeping only. In-progress slots are never evicted; a saturated
        // cache computes honestly without retaining another resource.
        let mut retired = vec![];
        let (slot, weighted) = {
            let mut state = self.state.lock().map_err(|_| error())?;
            if let Some(index) = state
                .entries
                .iter()
                .position(|e| e.month == month && e.perspective == perspective)
            {
                let entry = state.entries.remove(index).expect("existing cache index");
                let slot = Arc::clone(&entry.slot);
                let weighted = entry.bytes.is_some();
                state.entries.push_back(entry);
                (Some(slot), weighted)
            } else {
                if state.entries.len() >= MAX_MONTHS
                    && let Some(index) = state
                        .entries
                        .iter()
                        .position(|e| e.bytes.is_some() && Arc::strong_count(&e.slot) == 1)
                {
                    let old = state.entries.remove(index).expect("existing cache index");
                    state.bytes -= old.bytes.unwrap_or(0);
                    retired.push(old);
                }
                if state.entries.len() < MAX_MONTHS {
                    let slot = Arc::new(OnceLock::new());
                    state.entries.push_back(Entry {
                        month: month.into(),
                        perspective,
                        slot: Arc::clone(&slot),
                        bytes: None,
                    });
                    (Some(slot), false)
                } else {
                    (None, false)
                }
            }
        };
        drop(retired); // no forecast destruction while holding the map lock
        let Some(slot) = slot else {
            return Ok(Arc::new(prepare()));
        };
        if weighted {
            return Ok(Arc::clone(slot.get().ok_or_else(error)?));
        }
        let result = Arc::clone(slot.get_or_init(|| Arc::new(prepare())));
        // Serialization counts bytes without allocating a second result tree.
        let bytes = serialized_bytes(result.as_ref(), MAX_ENTRY_BYTES);
        let retired = {
            let mut state = self.state.lock().map_err(|_| error())?;
            if let Some(index) = state
                .entries
                .iter()
                .position(|e| Arc::ptr_eq(&e.slot, &slot))
            {
                if state.entries[index].bytes.is_none() {
                    if let Some(bytes) =
                        bytes.filter(|bytes| state.bytes.saturating_add(*bytes) <= MAX_TOTAL_BYTES)
                    {
                        state.entries[index].bytes = Some(bytes);
                        state.bytes += bytes;
                        None
                    } else {
                        state.entries.remove(index)
                    }
                } else {
                    None
                }
            } else {
                None
            }
        };
        drop(retired);
        Ok(result)
    }
}
fn error() -> ReportIssue {
    ReportIssue::new("PAYROLL_PREPARATION_UNAVAILABLE")
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn unavailable_native_results_remain_snapshot_local_and_computation_does_not_hold_the_map_lock()
    {
        let cache = PayrollNetCache::default();
        let first = cache
            .get_or_prepare("2026-01", SalaryPerspective::Payout, || {
                cache
                    .get_or_prepare("2026-02", SalaryPerspective::Payout, || {
                        SectionOutput::NotRequested {}
                    })
                    .unwrap();
                SectionOutput::Unavailable {
                    reason: ReportIssue::new("SOURCE_FAILED"),
                }
            })
            .unwrap();
        let repeated = cache
            .get_or_prepare("2026-01", SalaryPerspective::Payout, || {
                panic!("no duplicate native net pass")
            })
            .unwrap();
        assert!(Arc::ptr_eq(&first, &repeated));
        assert!(matches!(
            repeated.as_ref(),
            SectionOutput::Unavailable { .. }
        ));
        let other = PayrollNetCache::default()
            .get_or_prepare("2026-01", SalaryPerspective::Payout, || {
                SectionOutput::Ready {
                    value: json!({"changed":true}),
                }
            })
            .unwrap();
        assert!(!Arc::ptr_eq(&first, &other));
        let earned = cache
            .get_or_prepare("2026-01", SalaryPerspective::Earned, || {
                SectionOutput::NotRequested {}
            })
            .unwrap();
        assert!(!Arc::ptr_eq(&first, &earned));
    }
    #[test]
    fn concurrent_same_key_native_preparation_is_single_flight() {
        use std::sync::{
            Barrier,
            atomic::{AtomicUsize, Ordering},
        };
        let cache = Arc::new(PayrollNetCache::default());
        let calls = Arc::new(AtomicUsize::new(0));
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let (a, n, e, r) = (
            Arc::clone(&cache),
            Arc::clone(&calls),
            Arc::clone(&entered),
            Arc::clone(&release),
        );
        let first = std::thread::spawn(move || {
            a.get_or_prepare("2026-01", SalaryPerspective::Payout, || {
                n.fetch_add(1, Ordering::SeqCst);
                e.wait();
                r.wait();
                SectionOutput::Ready { value: json!(1) }
            })
            .unwrap()
        });
        entered.wait();
        let (a, n) = (Arc::clone(&cache), Arc::clone(&calls));
        let second = std::thread::spawn(move || {
            a.get_or_prepare("2026-01", SalaryPerspective::Payout, || {
                n.fetch_add(1, Ordering::SeqCst);
                SectionOutput::Ready { value: json!(2) }
            })
            .unwrap()
        });
        release.wait();
        let first = first.join().unwrap();
        let second = second.join().unwrap();
        assert!(Arc::ptr_eq(&first, &second));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
    #[test]
    fn native_results_are_count_and_byte_bounded_and_active_owners_survive_eviction() {
        let cache = PayrollNetCache::default();
        let original = cache
            .get_or_prepare("2026-01", SalaryPerspective::Payout, || {
                SectionOutput::Ready {
                    value: json!({"first":true}),
                }
            })
            .unwrap();
        for month in ["2026-02", "2026-03", "2026-04", "2026-05"] {
            cache
                .get_or_prepare(month, SalaryPerspective::Payout, || {
                    SectionOutput::NotRequested {}
                })
                .unwrap();
        }
        let state = cache.state.lock().unwrap();
        assert_eq!(state.entries.len(), 4);
        assert!(state.bytes <= MAX_TOTAL_BYTES);
        drop(state);
        assert!(matches!(original.as_ref(), SectionOutput::Ready { .. }));
        let new = cache
            .get_or_prepare("2026-01", SalaryPerspective::Payout, || {
                SectionOutput::Ready {
                    value: json!({"first":false}),
                }
            })
            .unwrap();
        assert!(!Arc::ptr_eq(&original, &new));
        cache
            .get_or_prepare("2026-06", SalaryPerspective::Payout, || {
                SectionOutput::Ready {
                    value: json!("x".repeat(MAX_ENTRY_BYTES as usize)),
                }
            })
            .unwrap();
        let state = cache.state.lock().unwrap();
        assert!(!state.entries.iter().any(|e| e.month == "2026-06"));
        assert!(state.bytes <= MAX_TOTAL_BYTES);
    }
}
