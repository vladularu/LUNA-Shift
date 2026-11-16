use super::{SharedCalendarDays, SharedDayWindow, source_view::Source, time, truthy};
use crate::EngineError;
use serde_json::Value;
use std::sync::Arc;

/// Raw account observations, never a host assertion that cached data is ready.
pub struct VisibilityContext<'a> {
    pub user_id: Option<&'a str>,
    pub status: &'a str,
    pub presentation_account_id: Option<&'a str>,
    pub observed_epoch_milliseconds: i64,
}
/// One original source allocation and source-ordered selected calendar locators.
/// The private constructor proof is valid only within its native clock interval.
pub struct PreparedIncomingCalendars {
    pub(super) source: Source,
    pub(super) selected: Vec<usize>,
    pub(super) observed: i64,
    pub(super) valid_until: Option<i64>,
}
impl PreparedIncomingCalendars {
    /// Native captured-array bridge; no deserializable visibility assertion.
    pub fn capture_timeline_at(
        &self,
        epoch: i64,
    ) -> Result<super::timeline_source::IncomingTimelineSource, EngineError> {
        if !self.is_fresh_at(epoch) {
            return Err(EngineError::InvalidCalendarEntry);
        }
        // Later widget frames recheck their own age predicate against this fixed
        // array, never against the complete current cache or another account.
        Ok(
            super::timeline_source::IncomingTimelineSource::from_selection(
                self.source.clone(),
                &self.selected,
            ),
        )
    }
    pub fn prepare(
        calendars: Arc<Vec<Value>>,
        context: &VisibilityContext<'_>,
    ) -> Result<Self, EngineError> {
        Self::prepare_source(Source::Raw(calendars), context)
    }
    pub(super) fn prepare_source(
        calendars: Source,
        context: &VisibilityContext<'_>,
    ) -> Result<Self, EngineError> {
        if calendars.len() > 10000
            || !(-8_640_000_000_000_000..=8_640_000_000_000_000)
                .contains(&context.observed_epoch_milliseconds)
        {
            return Err(EngineError::Overflow);
        }
        let account = context
            .user_id
            .or_else(|| {
                (context.status == "loading")
                    .then_some(context.presentation_account_id)
                    .flatten()
            })
            .filter(|id| !id.is_empty());
        let mut selected = Vec::new();
        let mut valid_until = None;
        let observed = context.observed_epoch_milliseconds;
        if let Some(account) = account {
            for index in 0..calendars.len() {
                let cached = calendars.get(index).unwrap();
                // Original visibleCalendars reads calendar.isOwner before the
                // account/visible predicates. Missing/null is a source error.
                let calendar = cached
                    .get("calendar")
                    .filter(|value| !value.is_null())
                    .ok_or(EngineError::InvalidCalendarEntry)?;
                if truthy(calendar.get("isOwner"))
                    || cached.get("accountId").and_then(Value::as_str) != Some(account)
                    || !truthy(cached.get("visible"))
                {
                    continue;
                }
                let Some(stamp) = cached
                    .get("fetchedAt")
                    .and_then(Value::as_str)
                    .and_then(time::date_milliseconds)
                else {
                    continue;
                };
                let age = observed as f64 - stamp;
                let next = if age < -300000.0 {
                    // A future cache becomes originally visible at this point.
                    Some((stamp - 300000.0) as i64)
                } else if age < 86400000.0 {
                    selected.push(index);
                    Some((stamp + 86400000.0) as i64)
                } else {
                    None
                };
                if let Some(next) = next {
                    valid_until = Some(valid_until.map_or(next, |current: i64| current.min(next)));
                }
            }
        }
        Ok(Self {
            source: calendars,
            selected,
            observed,
            valid_until,
        })
    }
    pub fn selected_indices(&self) -> &[usize] {
        &self.selected
    }
    pub fn valid_until_epoch_milliseconds(&self) -> Option<i64> {
        self.valid_until
    }
    pub fn is_fresh_at(&self, epoch: i64) -> bool {
        epoch >= self.observed && self.valid_until.is_none_or(|until| epoch < until)
    }
    pub fn project(
        &self,
        time_zone: &str,
        epoch: i64,
        window: Option<&SharedDayWindow<'_>>,
    ) -> Result<SharedCalendarDays, EngineError> {
        if !self.is_fresh_at(epoch) {
            return Err(EngineError::InvalidCalendarEntry);
        }
        // Original useSharedCalendarDays passes null only after the runtime's
        // cacheUsable/account gate. This private selection is that native proof.
        super::project(
            self.source.clone(),
            time_zone,
            None,
            window,
            Some(&self.selected),
        )
    }
}
