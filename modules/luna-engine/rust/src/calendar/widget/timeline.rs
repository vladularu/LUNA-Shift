//! Native timeline assembly over typed source owners; no platform rendering or
//! source readiness/authorization is admitted through this pure leaf.
use super::*;
use crate::calendar::{
    incoming::{SharedCalendarDays, SharedDayWindow, timeline_source::IncomingTimelineSource},
    recurrence::CollationRanks,
};
use serde::{Serializer, ser::SerializeSeq};
use serde_json::Value;
use std::{collections::BTreeMap, sync::Arc};
const MAX_TIMELINE_BYTES: u64 = 16_515_072;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TimelineDay {
    #[serde(flatten)]
    rows: WidgetBusinessDay,
    weekday: &'static str,
    weekday_index: i8,
    short_date: String,
}
fn serialize_days<S: Serializer>(
    days: &[Arc<TimelineDay>],
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let mut seq = serializer.serialize_seq(Some(days.len()))?;
    for day in days {
        seq.serialize_element(day.as_ref())?;
    }
    seq.end()
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetBusinessFrame {
    observed_epoch_milliseconds: i64,
    today_date: String,
    month: String,
    month_title: &'static str,
    state: &'static str,
    #[serde(serialize_with = "serialize_days")]
    days: Vec<Arc<TimelineDay>>,
    #[serde(serialize_with = "serialize_days")]
    week_days: Vec<Arc<TimelineDay>>,
    #[serde(serialize_with = "serialize_days")]
    month_days: Vec<Arc<TimelineDay>>,
}
fn grid(
    plan: &[schedule::Day],
    own: &WidgetRows<'_>,
    incoming: &SharedCalendarDays,
    cache: &mut BTreeMap<String, Arc<TimelineDay>>,
) -> Result<Vec<Arc<TimelineDay>>, EngineError> {
    let mut result = Vec::with_capacity(plan.len());
    for day in plan {
        if let std::collections::btree_map::Entry::Vacant(slot) = cache.entry(day.date.clone()) {
            let rows = own.day(&day.date, incoming)?;
            slot.insert(Arc::new(TimelineDay {
                rows,
                weekday: day.weekday,
                weekday_index: day.weekday_index,
                short_date: day.short_date.clone(),
            }));
        }
        result.push(Arc::clone(&cache[&day.date]));
    }
    Ok(result)
}
impl WidgetClock {
    pub fn business_timeline_from_records<S: crate::calendar::window::CalendarRecordSource>(
        &self,
        entries: &S,
        ranks: &CollationRanks,
        incoming: &IncomingTimelineSource,
        options: WidgetRowOptions,
        has_profile: bool,
    ) -> Result<Vec<WidgetBusinessFrame>, EngineError> {
        let own = WidgetRows::from_records(entries, ranks, &self.zone_name, options)?;
        self.timeline_from_rows(own, has_profile.then_some(incoming), has_profile)
    }
    pub fn business_timeline(
        &self,
        entries: &[Value],
        ranks: &CollationRanks,
        calendars: Arc<Vec<Value>>,
        options: WidgetRowOptions,
        has_profile: bool,
    ) -> Result<Vec<WidgetBusinessFrame>, EngineError> {
        let own = WidgetRows::new(entries, ranks, &self.zone_name, options)?;
        let incoming = if has_profile {
            Some(IncomingTimelineSource::from_raw(calendars)?)
        } else {
            None
        };
        self.timeline_from_rows(own, incoming.as_ref(), has_profile)
    }
    /// Typed captured source from native account/visibility admission. This leaf
    /// alone does not prove live owner currentness or authorize OS publication.
    pub fn business_timeline_from_incoming(
        &self,
        entries: &[Value],
        ranks: &CollationRanks,
        incoming: &IncomingTimelineSource,
        options: WidgetRowOptions,
        has_profile: bool,
    ) -> Result<Vec<WidgetBusinessFrame>, EngineError> {
        let own = WidgetRows::new(entries, ranks, &self.zone_name, options)?;
        self.timeline_from_rows(own, has_profile.then_some(incoming), has_profile)
    }
    fn timeline_from_rows(
        &self,
        own: WidgetRows<'_>,
        incoming: Option<&IncomingTimelineSource>,
        has_profile: bool,
    ) -> Result<Vec<WidgetBusinessFrame>, EngineError> {
        let fetched = incoming
            .into_iter()
            .flat_map(IncomingTimelineSource::fetched_at)
            .collect::<Vec<_>>();
        let plans = self.frame_plan(has_profile, &fetched)?;
        let range = self.entry_range()?;
        let end = range
            .end_date
            .parse::<Date>()
            .map_err(|_| EngineError::InvalidDate)?
            .checked_add(1.days())
            .map_err(|_| EngineError::InvalidDate)?
            .to_string();
        let window = SharedDayWindow {
            start_date: &range.start_date,
            end_date: &end,
        };
        let mut visible = None;
        let mut projection = None;
        let mut cache = BTreeMap::new();
        let mut result = Vec::with_capacity(plans.len());
        let mut bytes = 2u64;
        for plan in plans {
            let (days, week_days, month_days) = if plan.state == "ready" {
                let source = incoming.ok_or(EngineError::InvalidCalendarEntry)?;
                let at = Some(plan.observed_epoch_milliseconds as f64);
                let key = source.eligible_key(at)?;
                if visible.as_ref() != Some(&key) {
                    projection = Some(source.project(&self.zone_name, at, Some(&window))?);
                    visible = Some(key);
                    cache.clear();
                }
                let shared = projection
                    .as_ref()
                    .ok_or(EngineError::InvalidCalendarEntry)?;
                (
                    grid(&plan.days, &own, shared, &mut cache)?,
                    grid(&plan.week_days, &own, shared, &mut cache)?,
                    grid(&plan.month_days, &own, shared, &mut cache)?,
                )
            } else {
                (Vec::new(), Vec::new(), Vec::new())
            };
            let frame = WidgetBusinessFrame {
                observed_epoch_milliseconds: plan.observed_epoch_milliseconds,
                today_date: plan.today_date,
                month: plan.month,
                month_title: plan.month_title,
                state: plan.state,
                days,
                week_days,
                month_days,
            };
            let separator = u64::from(!result.is_empty());
            let remaining = MAX_TIMELINE_BYTES
                .checked_sub(bytes + separator)
                .ok_or(EngineError::Overflow)?;
            let size = crate::report::cache_budget::serialized_bytes(&frame, remaining)
                .ok_or(EngineError::Overflow)?;
            bytes = bytes
                .checked_add(size + separator)
                .ok_or(EngineError::Overflow)?;
            result.push(frame);
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn date(day: &Arc<TimelineDay>) -> String {
        serde_json::to_value(day.as_ref()).unwrap()["date"]
            .as_str()
            .unwrap()
            .to_owned()
    }
    fn clock() -> WidgetClock {
        WidgetClock::from_epoch(
            "2026-11-10T10:00:00Z"
                .parse::<Timestamp>()
                .unwrap()
                .as_millisecond(),
            "Europe/Berlin",
        )
        .unwrap()
    }
    fn options() -> WidgetRowOptions {
        WidgetRowOptions {
            show_shifts: true,
            show_appointments: true,
            show_shift_times: true,
            show_shift_duration: false,
        }
    }
    #[test]
    fn overlapping_widget_grids_and_adjacent_frames_share_days_then_release_all_owners() {
        let source = Arc::new(Vec::new());
        let weak_source = Arc::downgrade(&source);
        let frames = clock()
            .business_timeline(
                &[],
                &CollationRanks::from(BTreeMap::new()),
                source.clone(),
                options(),
                true,
            )
            .unwrap();
        assert_eq!(
            Arc::strong_count(&source),
            1,
            "completed frames do not retain the complete raw source"
        );
        let today = &frames[0].days[0];
        let week = frames[0]
            .week_days
            .iter()
            .find(|d| date(d) == date(today))
            .unwrap();
        let month = frames[0]
            .month_days
            .iter()
            .find(|d| date(d) == date(today))
            .unwrap();
        assert!(Arc::ptr_eq(today, week));
        assert!(Arc::ptr_eq(today, month));
        assert!(Arc::ptr_eq(&frames[0].days[1], &frames[1].days[0]));
        let weak = Arc::downgrade(today);
        drop(frames);
        assert!(weak.upgrade().is_none());
        drop(source);
        assert!(weak_source.upgrade().is_none());
    }
    #[test]
    fn a_same_date_shared_cache_expiry_starts_a_new_day_cache_epoch() {
        let source = Arc::new(vec![
            serde_json::json!({"visible":true,"calendar":{"id":"calendar","isOwner":false},"fetchedAt":"2026-11-09T11:00:00Z","entries":[]}),
        ]);
        let frames = clock()
            .business_timeline(
                &[],
                &CollationRanks::from(BTreeMap::new()),
                source,
                options(),
                true,
            )
            .unwrap();
        assert_eq!(frames[0].today_date, frames[1].today_date);
        assert!(
            !Arc::ptr_eq(&frames[0].days[0], &frames[1].days[0]),
            "expiry changes the source eligibility epoch even on the same local date"
        );
        assert!(Arc::ptr_eq(&frames[1].days[1], &frames[2].days[0]));
    }
}
