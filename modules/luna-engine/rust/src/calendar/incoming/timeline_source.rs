//! Immutable source view for a native widget timeline; no readiness wire type.
use super::*;
pub struct IncomingTimelineSource {
    source: Source,
    selected: Option<Arc<[usize]>>,
}

impl IncomingTimelineSource {
    pub fn from_raw(source: Arc<Vec<Value>>) -> Result<Self, EngineError> {
        if source.len() > 10000 {
            return Err(EngineError::Overflow);
        }
        Ok(Self {
            source: Source::Raw(source),
            selected: None,
        })
    }
    pub(super) fn from_selection(source: Source, selected: &[usize]) -> Self {
        Self {
            source,
            selected: Some(Arc::from(selected)),
        }
    }
    fn indices(&self) -> impl Iterator<Item = usize> + '_ {
        self.selected.iter().flat_map(|v| v.iter().copied()).chain(
            0..if self.selected.is_none() {
                self.source.len()
            } else {
                0
            },
        )
    }
    /// Only members of the already captured visible array contribute TTL frames.
    pub(crate) fn fetched_at(&self) -> impl Iterator<Item = &str> {
        self.indices().filter_map(|index| {
            self.source
                .get(index)
                .and_then(|c| c.get("fetchedAt"))
                .and_then(Value::as_str)
        })
    }
    pub fn eligible_key(&self, now: Option<f64>) -> Result<Vec<usize>, EngineError> {
        let mut indices = Vec::new();
        for index in self.indices() {
            let cached = self
                .source
                .get(index)
                .ok_or(EngineError::InvalidCalendarEntry)?;
            if super::eligible_calendar(&cached, now)? {
                indices.push(index);
            }
        }
        Ok(indices)
    }
    pub fn project(
        &self,
        time_zone: &str,
        now: Option<f64>,
        window: Option<&SharedDayWindow<'_>>,
    ) -> Result<SharedCalendarDays, EngineError> {
        super::project(
            self.source.clone(),
            time_zone,
            now,
            window,
            self.selected.as_deref(),
        )
    }
}

#[cfg(test)]
mod captured_tests {
    use super::super::visible::{PreparedIncomingCalendars, VisibilityContext};
    use super::*;
    use serde_json::json;
    #[test]
    fn retained_record_capture_shares_the_native_record_owner_until_last_drop() {
        use super::super::cache::RetainedIncomingCache;
        let epoch = 1792929600000;
        let mut state = RetainedIncomingCache::new();
        let observed = state
            .observe(
                vec![json!({"accountId":"viewer","visible":true,
            "calendar":{"id":"shared","isOwner":false},"entries":[],
            "fetchedAt":"2026-10-25T12:00:00Z"})],
                &VisibilityContext {
                    user_id: Some("viewer"),
                    status: "signedIn",
                    presentation_account_id: None,
                    observed_epoch_milliseconds: epoch,
                },
            )
            .unwrap();
        let captured = observed.capture_timeline_at(epoch).unwrap();
        let second = observed.capture_timeline_at(epoch).unwrap();
        let Source::Records(records) = &captured.source else {
            panic!("lost native record source")
        };
        let Source::Records(other) = &second.source else {
            panic!("lost native record source")
        };
        assert!(Arc::ptr_eq(records, other));
        let weak = Arc::downgrade(records);
        assert_eq!(captured.eligible_key(Some(epoch as f64)).unwrap(), vec![0]);
        assert_eq!(
            captured.fetched_at().collect::<Vec<_>>(),
            vec!["2026-10-25T12:00:00Z"]
        );
        assert!(observed.capture_timeline_at(epoch + 86400000).is_err());
        drop(second);
        drop(observed);
        drop(state);
        assert_eq!(weak.strong_count(), 1);
        drop(captured);
        assert!(weak.upgrade().is_none());
    }
    #[test]
    fn captured_selection_never_promotes_previously_excluded_future_caches() {
        let epoch = 1792929600000;
        let cache = |fetched: &str| {
            json!({"accountId":"viewer","visible":true,
            "calendar":{"id":"shared","isOwner":false},"entries":[],"fetchedAt":fetched})
        };
        let raw = Arc::new(vec![
            cache("2026-10-25T12:00:00Z"),
            cache("2026-10-25T13:00:00Z"),
        ]);
        let prepared = PreparedIncomingCalendars::prepare(
            raw,
            &VisibilityContext {
                user_id: Some("viewer"),
                status: "signedIn",
                presentation_account_id: None,
                observed_epoch_milliseconds: epoch,
            },
        )
        .unwrap();
        assert_eq!(prepared.selected_indices(), &[0]);
        let captured = prepared.capture_timeline_at(epoch).unwrap();
        assert_eq!(
            captured.fetched_at().collect::<Vec<_>>(),
            vec!["2026-10-25T12:00:00Z"]
        );
        assert_eq!(
            captured
                .eligible_key(Some((epoch + 3660000) as f64))
                .unwrap(),
            vec![0]
        );
        assert!(
            captured
                .eligible_key(Some((epoch + 86400000) as f64))
                .unwrap()
                .is_empty()
        );
        assert!(prepared.capture_timeline_at(epoch - 1).is_err());
        assert!(prepared.capture_timeline_at(epoch + 86400000).is_err());
    }
    #[test]
    fn captured_timeline_keeps_one_large_raw_allocation_until_its_last_owner_drops() {
        let rows = (0..50000)
            .map(|i| json!({"id":i,"text":"retained input"}))
            .collect::<Vec<_>>();
        let raw = Arc::new(vec![
            json!({"accountId":"viewer","visible":true,"calendar":{"isOwner":false},
            "fetchedAt":"2026-10-25T12:00:00Z","entries":rows}),
        ]);
        let pointer = raw[0]["entries"].as_array().unwrap().as_ptr();
        let weak = Arc::downgrade(&raw);
        let prepared = PreparedIncomingCalendars::prepare(
            Arc::clone(&raw),
            &VisibilityContext {
                user_id: Some("viewer"),
                status: "signedIn",
                presentation_account_id: None,
                observed_epoch_milliseconds: 1792929600000,
            },
        )
        .unwrap();
        let captured = prepared.capture_timeline_at(1792929600000).unwrap();
        assert_eq!(
            captured
                .source
                .get(0)
                .unwrap()
                .get("entries")
                .unwrap()
                .as_array()
                .unwrap()
                .as_ptr(),
            pointer
        );
        drop(raw);
        drop(prepared);
        assert_eq!(weak.strong_count(), 1);
        drop(captured);
        assert!(weak.upgrade().is_none());
    }
}
