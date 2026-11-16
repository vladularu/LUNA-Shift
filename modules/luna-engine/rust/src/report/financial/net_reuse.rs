//! Closed native forecast-result sharing after current source/basis preparation.
use super::{
    super::{
        FinancialError,
        fingerprint::{
            FinancialFingerprint, FinancialFingerprintBook, LegacyFinancialView,
            canonical::{CanonicalHash, values_digest},
        },
        source::FinancialContext,
    },
    PaymentNetPreparation,
};
use crate::net::{
    payment_projection::{PaymentContribution, SalaryPaymentProjection},
    payment_schedule::{PaymentPreferences, SalaryPerspective},
};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::VecDeque,
    io::{self, Write},
    sync::{Arc, Mutex},
};
const MAX_ENTRIES: usize = 96;
const MAX_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ENTRY_BYTES: u64 = 4 * 1024 * 1024;
struct Entry {
    key: FinancialFingerprint,
    value: Arc<Value>,
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
pub struct NetReuseStats {
    pub entries: usize,
    pub retained_serialized_bytes: u64,
    pub hits: u64,
    pub misses: u64,
}
/// Only this native calculation module can insert a result. Failed/partial
/// forecasts and caller-supplied mutable projections are never shared.
#[derive(Default)]
pub struct SharedNetReuseCache(Mutex<State>);
impl SharedNetReuseCache {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn stats(&self) -> Result<NetReuseStats, FinancialError> {
        let state = self
            .0
            .lock()
            .map_err(|_| FinancialError::invalid("Nettospeicher nicht verfügbar."))?;
        Ok(NetReuseStats {
            entries: state.entries.len(),
            retained_serialized_bytes: state.bytes,
            hits: state.hits,
            misses: state.misses,
        })
    }
    pub(super) fn get(&self, key: &FinancialFingerprint) -> Option<Arc<Value>> {
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
    pub(super) fn insert(&self, key: FinancialFingerprint, value: Arc<Value>) {
        if value["result"]["status"] != "available" {
            return;
        }
        let mut count = Count(0);
        if serde_json::to_writer(&mut count, value.as_ref()).is_err() {
            return;
        }
        let Ok(mut state) = self.0.lock() else {
            return;
        };
        if let Some(index) = state.entries.iter().position(|e| e.key == key) {
            let old = state
                .entries
                .remove(index)
                .expect("located native forecast");
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
struct Count(u64);
impl Write for Count {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0 = self
            .0
            .checked_add(bytes.len() as u64)
            .filter(|n| *n <= MAX_ENTRY_BYTES)
            .ok_or_else(|| io::Error::other("native forecast too large"))?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub(super) fn scope_digest(
    payout: Option<(&PaymentPreferences, &[Value])>,
) -> Result<[u8; 32], FinancialError> {
    let mut h = CanonicalHash::new("luna:financial:net-scope:v1");
    if let Some((preferences, timeline)) = payout {
        h.array(2);
        h.value(
            &serde_json::to_value(preferences)
                .map_err(|_| FinancialError::invalid("Ungültige Zahlungspräferenzen."))?,
            false,
        )?;
        h.bytes(&values_digest(timeline, false)?.0);
    } else {
        h.null();
    }
    Ok(h.finish())
}
#[derive(Serialize)]
struct ProjectionFacts<'a> {
    month: &'a str,
    perspective: SalaryPerspective,
    available: bool,
    pay: [&'a Value; 10],
    contributions: &'a [PaymentContribution],
    outgoing_contributions: &'a [PaymentContribution],
    issues: &'a [Value],
    warnings: &'a [String],
}
pub(super) fn forecast_key(
    context: &FinancialContext<'_>,
    month: &str,
    settings: &Value,
    payout: Option<&PaymentNetPreparation<'_>>,
    projection: Option<&SalaryPaymentProjection>,
    scope: Option<&[u8; 32]>,
) -> Option<FinancialFingerprint> {
    if context.shared_net_cache.is_none() || payout.is_some_and(|p| p.projection.is_some()) {
        return None;
    }
    let book = context.semantic_fingerprints.as_ref()?;
    let calculated_scope;
    let scope = match scope {
        Some(s) => s,
        None => {
            calculated_scope =
                scope_digest(payout.map(|p| (p.preferences, p.source_settings))).ok()?;
            &calculated_scope
        }
    };
    make_key(book, month, settings, projection, scope).ok()
}
fn make_key(
    book: &FinancialFingerprintBook,
    month: &str,
    settings: &Value,
    projection: Option<&SalaryPaymentProjection>,
    scope: &[u8; 32],
) -> Result<FinancialFingerprint, FinancialError> {
    let mut h = book.native_part_hash("NET_FORECAST", month);
    h.array(4);
    h.value(settings, false)?;
    h.bytes(scope);
    if let Some(projection) = projection {
        let pay = &projection.pay;
        let facts = ProjectionFacts {
            month: &projection.month,
            perspective: projection.perspective,
            available: projection.available,
            pay: [
                &pay["month"],
                &pay["available"],
                &pay["estimatedGrossAmount"],
                &pay["personalBaseAmount"],
                &pay["careAllowanceAmount"],
                &pay["tvoedAllowanceAmount"],
                &pay["timePremiumAmount"],
                &pay["allowanceAmount"],
                &pay["overtimeAmount"],
                &pay["specialDutyAmount"],
            ],
            contributions: &projection.contributions,
            outgoing_contributions: &projection.outgoing_contributions,
            issues: &projection.issues,
            warnings: &projection.warnings,
        };
        // All other pay/trace facts are closed by the native source-month keys below.
        h.value(
            &serde_json::to_value(facts)
                .map_err(|_| FinancialError::invalid("Ungültige Auszahlungsgrundlage."))?,
            false,
        )?;
        h.array(projection.sources.len());
        for source in &projection.sources {
            h.string(
                &book
                    .legacy_month(source.month(), LegacyFinancialView::Actual)?
                    .to_string(),
            );
        }
    } else {
        h.null();
        h.array(1);
        h.string(
            &book
                .legacy_month(month, LegacyFinancialView::Salary)?
                .to_string(),
        );
    }
    Ok(FinancialFingerprint::from_native_digest(h.finish()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn key(index: u8) -> FinancialFingerprint {
        FinancialFingerprint::from_native_digest([index; 32])
    }
    fn result(text: &str) -> Arc<Value> {
        Arc::new(json!({"result":{"status":"available","notes":[text]}}))
    }
    #[test]
    fn native_forecast_cache_is_bounded_and_rejects_unavailable_and_oversized_outputs() {
        let cache = SharedNetReuseCache::new();
        let value = result("native result");
        cache.insert(key(0), Arc::clone(&value));
        assert!(Arc::ptr_eq(&cache.get(&key(0)).unwrap(), &value));
        cache.insert(key(1), Arc::new(json!({"result":{"status":"unavailable"}})));
        assert!(cache.get(&key(1)).is_none());
        cache.insert(key(2), result(&"x".repeat(MAX_ENTRY_BYTES as usize + 1)));
        assert!(cache.get(&key(2)).is_none());
        for index in 3..110 {
            cache.insert(key(index), Arc::clone(&value));
        }
        assert_eq!(cache.stats().unwrap().entries, MAX_ENTRIES);
        assert!(cache.get(&key(0)).is_none());
        for index in 120..130 {
            cache.insert(key(index), result(&"x".repeat(2 * 1024 * 1024)));
        }
        let stats = cache.stats().unwrap();
        assert!(stats.retained_serialized_bytes <= MAX_BYTES);
        assert!(stats.entries < 10);
    }
    #[test]
    fn optional_net_cache_poison_never_returns_a_ready_result() {
        let cache = SharedNetReuseCache::new();
        let p = std::panic::catch_unwind(|| {
            let _guard = cache.0.lock().unwrap();
            panic!("intentional optional cache poison");
        });
        assert!(p.is_err());
        assert!(cache.get(&key(0)).is_none());
        cache.insert(key(0), result("ignored"));
        assert!(cache.stats().is_err());
    }
}
