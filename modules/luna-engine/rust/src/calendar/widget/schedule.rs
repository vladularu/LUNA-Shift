//! Native timeline/grid planning only. Entry projections and platform widget
//! rendering remain separate; no caller Ready state is deserialized here.
use super::*;
use serde::Serializer;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
fn serialize_days<S: Serializer>(days: &Arc<[Day]>, serializer: S) -> Result<S::Ok, S::Error> {
    days.as_ref().serialize(serializer)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetFramePlan {
    pub(super) observed_epoch_milliseconds: i64,
    pub(super) today_date: String,
    pub(super) month: String,
    pub(super) month_title: &'static str,
    pub(super) state: &'static str,
    #[serde(serialize_with = "serialize_days")]
    pub(super) days: Arc<[Day]>,
    #[serde(serialize_with = "serialize_days")]
    pub(super) week_days: Arc<[Day]>,
    #[serde(serialize_with = "serialize_days")]
    pub(super) month_days: Arc<[Day]>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Day {
    pub(super) date: String,
    pub(super) weekday: &'static str,
    pub(super) weekday_index: i8,
    pub(super) short_date: String,
}
#[derive(Clone)]
struct Grids {
    days: Arc<[Day]>,
    week_days: Arc<[Day]>,
    month_days: Arc<[Day]>,
}
fn add(date: Date, n: i64) -> Result<Date, EngineError> {
    date.checked_add(n.days())
        .map_err(|_| EngineError::InvalidDate)
}
fn monday(date: Date) -> Result<Date, EngineError> {
    date.checked_sub(date.weekday().to_monday_zero_offset().days())
        .map_err(|_| EngineError::InvalidDate)
}
fn days(date: Date, count: i64) -> Result<Arc<[Day]>, EngineError> {
    (0..count)
        .map(|offset| {
            let d = add(date, offset)?;
            let w = d.weekday().to_monday_zero_offset();
            Ok(Day {
                date: d.to_string(),
                weekday: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"][w as usize],
                weekday_index: w + 1,
                short_date: format!("{:02}.{:02}.", d.day(), d.month()),
            })
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Arc::from)
}
fn empty_grids() -> Grids {
    Grids {
        days: Arc::from([]),
        week_days: Arc::from([]),
        month_days: Arc::from([]),
    }
}
fn grids(date: Date) -> Result<Grids, EngineError> {
    let first = date.first_of_month();
    let count =
        (i64::from(first.weekday().to_monday_zero_offset()) + i64::from(first.days_in_month()) + 6)
            / 7
            * 7;
    Ok(Grids {
        days: days(date, 6)?,
        week_days: days(monday(date)?, 28)?,
        month_days: days(monday(first)?, count)?,
    })
}
fn frame(epoch: i64, date: Date, state: &'static str, grids: Grids) -> WidgetFramePlan {
    let day = date.to_string();
    WidgetFramePlan {
        observed_epoch_milliseconds: epoch,
        month: day[..7].to_owned(),
        today_date: day,
        month_title: [
            "Januar",
            "Februar",
            "März",
            "April",
            "Mai",
            "Juni",
            "Juli",
            "August",
            "September",
            "Oktober",
            "November",
            "Dezember",
        ][(date.month() - 1) as usize],
        state,
        days: grids.days,
        week_days: grids.week_days,
        month_days: grids.month_days,
    }
}
impl WidgetClock {
    /// The native source supplies profile presence and borrowed original cache
    /// timestamps. No profile or calendar tree is accepted as wire readiness.
    pub fn frame_plan(
        &self,
        has_profile: bool,
        shared_fetched_at: &[&str],
    ) -> Result<Vec<WidgetFramePlan>, EngineError> {
        if !has_profile {
            return Ok(vec![frame(
                self.observed_epoch_milliseconds,
                self.date,
                "setup",
                empty_grids(),
            )]);
        }
        if shared_fetched_at.len() > 10000 {
            return Err(EngineError::Overflow);
        }
        let midnight = |day: Date| {
            self.zone
                .to_ambiguous_zoned(day.at(0, 0, 0, 0))
                .compatible()
                .map(|z| z.timestamp().as_millisecond())
                .map_err(|_| EngineError::InvalidDate)
        };
        let expires = midnight(add(self.date, 14)?)?;
        let mut instants = BTreeSet::from([self.observed_epoch_milliseconds]);
        for offset in 1..=14 {
            instants.insert(midnight(add(self.date, offset)?)?);
        }
        for raw in shared_fetched_at {
            if let Some(expiry) = crate::calendar::incoming::cache_expiry_milliseconds(raw)
                && expiry > self.observed_epoch_milliseconds
                && expiry < expires
            {
                instants.insert(expiry);
            }
        }
        let mut cache = BTreeMap::new();
        let mut frames = Vec::with_capacity(instants.len());
        for epoch in instants {
            let date = Timestamp::from_millisecond(epoch)
                .map_err(|_| EngineError::InvalidDate)?
                .to_zoned(self.zone.clone())
                .date();
            let expired = epoch >= expires;
            let layout = if expired {
                empty_grids()
            } else {
                if let std::collections::btree_map::Entry::Vacant(slot) = cache.entry(date) {
                    slot.insert(grids(date)?);
                }
                cache[&date].clone()
            };
            frames.push(frame(
                epoch,
                date,
                if expired { "expired" } else { "ready" },
                layout,
            ));
        }
        crate::report::cache_budget::serialized_bytes(&frames, 16_515_072)
            .ok_or(EngineError::Overflow)?;
        Ok(frames)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn same_day_expiry_frames_share_layout_and_release_it_when_frames_are_dropped() {
        let epoch = "2026-11-10T10:00:00Z"
            .parse::<Timestamp>()
            .unwrap()
            .as_millisecond();
        let clock = WidgetClock::from_epoch(epoch, "Europe/Berlin").unwrap();
        let frames = clock
            .frame_plan(true, &["2026-11-09T11:00:00Z", "2026-11-09T12:00:00Z"])
            .unwrap();
        assert_eq!(frames[0].today_date, frames[1].today_date);
        assert!(Arc::ptr_eq(&frames[0].days, &frames[1].days));
        assert!(Arc::ptr_eq(&frames[0].week_days, &frames[1].week_days));
        assert!(Arc::ptr_eq(&frames[0].month_days, &frames[1].month_days));
        let weak = Arc::downgrade(&frames[0].month_days);
        drop(frames);
        assert!(weak.upgrade().is_none());
    }
    #[test]
    fn invalid_cache_times_never_create_frames_and_profile_setup_needs_no_cache_tree() {
        let clock = WidgetClock::from_epoch(1794304800000, "Europe/Berlin").unwrap();
        assert_eq!(clock.frame_plan(true, &["not-a-date"]).unwrap().len(), 15);
        let oversized = vec!["not-a-date"; 10001];
        assert!(clock.frame_plan(true, &oversized).is_err());
        let setup = clock.frame_plan(false, &oversized).unwrap();
        assert_eq!(setup.len(), 1);
        assert_eq!(setup[0].state, "setup");
        assert!(setup[0].month_days.is_empty());
    }
}
