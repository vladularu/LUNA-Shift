//! Widget dates are derived natively. The eventual source owner supplies its
//! already verified calculation-preferred time zone, not a Host calculation-ready profile.
use crate::EngineError;
use jiff::{Timestamp, ToSpan, civil::Date, tz::TimeZone};
use serde::Serialize;
pub(crate) mod command;
mod highlights;
mod rows;
mod schedule;
mod timeline;
pub use highlights::widget_calendar_highlights;
pub use rows::{WidgetBusinessDay, WidgetRowOptions, WidgetRows};
pub use schedule::WidgetFramePlan;
pub use timeline::WidgetBusinessFrame;

pub struct WidgetClock {
    observed_epoch_milliseconds: i64,
    date: Date,
    zone: TimeZone,
    zone_name: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetRange {
    pub start_date: String,
    pub end_date: String,
}
impl WidgetClock {
    pub fn from_epoch(epoch: i64, time_zone: &str) -> Result<Self, EngineError> {
        crate::contract::RawClockContext::from_epoch_milliseconds(epoch)
            .map_err(|_| EngineError::InvalidDate)?;
        let zone = crate::time_zone::zone(time_zone)?;
        let date = Timestamp::from_millisecond(epoch)
            .map_err(|_| EngineError::InvalidDate)?
            .to_zoned(zone.clone())
            .date();
        Ok(Self {
            observed_epoch_milliseconds: epoch,
            date,
            zone: zone.clone(),
            zone_name: time_zone.to_owned(),
        })
    }
    pub fn entry_range(&self) -> Result<WidgetRange, EngineError> {
        let add = |date: Date, days: i64| {
            date.checked_add(days.days())
                .map_err(|_| EngineError::InvalidDate)
        };
        let monday = |date: Date| {
            date.checked_sub(date.weekday().to_monday_zero_offset().days())
                .map_err(|_| EngineError::InvalidDate)
        };
        let start = monday(self.date.first_of_month())?;
        let last = add(self.date, 13)?;
        let month_end = last.last_of_month();
        let grid_end = add(
            month_end,
            i64::from(6 - month_end.weekday().to_monday_zero_offset()),
        )?;
        let week_end = add(monday(last)?, 27)?;
        Ok(WidgetRange {
            start_date: start.to_string(),
            end_date: grid_end.max(week_end).to_string(),
        })
    }
    pub fn next_midnight(&self) -> Result<i64, EngineError> {
        let next = self
            .date
            .checked_add(1.days())
            .map_err(|_| EngineError::InvalidDate)?;
        Ok(self
            .zone
            .to_ambiguous_zoned(next.at(0, 0, 0, 0))
            .compatible()
            .map_err(|_| EngineError::InvalidDate)?
            .timestamp()
            .as_millisecond())
    }
}
