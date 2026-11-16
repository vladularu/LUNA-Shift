use super::PremiumError;
use crate::{
    remuneration::base::shift_days::RemunerationShiftDay,
    rules::{
        RuleResolver,
        holidays::{HolidayError, holiday_calendar},
    },
    time::{ShiftTime, shift_bounds},
};
use jiff::{Timestamp, Zoned};
use serde_json::Value;

pub(super) fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str, PremiumError> {
    v.get(key)
        .and_then(Value::as_str)
        .ok_or(PremiumError::InvalidInput)
}
pub(super) fn number(v: &Value, key: &str) -> Result<f64, PremiumError> {
    v.get(key)
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite())
        .ok_or(PremiumError::InvalidInput)
}
pub(super) fn in_window(minute: f64, start: f64, end: f64) -> bool {
    if start < end {
        minute >= start && minute < end
    } else {
        minute >= start || minute < end
    }
}
pub(super) struct Frame {
    pub gross: f64,
    pub pause_from: f64,
    pub pause_until: f64,
}
impl Frame {
    pub fn paused(&self, offset: f64) -> bool {
        offset >= self.pause_from && offset < self.pause_until
    }
}
pub(super) fn frame(shift: &Value, work: &Value) -> Result<Option<Frame>, PremiumError> {
    let input = ShiftTime {
        date: text(shift, "date")?.into(),
        start_time: Some(text(shift, "startTime")?.into()),
        end_time: Some(text(shift, "endTime")?.into()),
        break_minutes: 0,
        all_day: false,
        special_duty: None,
    };
    let Some(bounds) = shift_bounds(&input, text(work, "timeZone")?)? else {
        return Ok(None);
    };
    let gross = bounds.gross_minutes as f64;
    let pause = number(shift, "breakMinutes")?.min(gross);
    let pause_from = ((gross - pause) / 2.0).floor();
    Ok(Some(Frame {
        gross,
        pause_from,
        pause_until: pause_from + pause,
    }))
}
fn instant(epoch_minutes: f64) -> Result<Timestamp, PremiumError> {
    let ms = epoch_minutes * 60_000.0;
    if !ms.is_finite() || ms.fract() != 0.0 || ms.abs() > crate::money::MAX_SAFE_INTEGER as f64 {
        return Err(PremiumError::InvalidInstant);
    }
    Timestamp::from_millisecond(ms as i64).map_err(|_| PremiumError::InvalidInstant)
}
/// Match the original split day's wall-clock fast path. A true offset change
/// switches to elapsed-minute zoned arithmetic; fractional credited time is
/// retained separately from these sampled premium-minute buckets.
pub(super) struct DayClock {
    start: Zoned,
    from: f64,
    minute: f64,
    transition: bool,
    pub weekday: i8,
}
impl DayClock {
    pub fn new(day: &RemunerationShiftDay, work: &Value) -> Result<Self, PremiumError> {
        let zone = crate::time_zone::zone(text(work, "timeZone")?)?;
        let start = instant(day.from_epoch_minutes)?.to_zoned(zone.clone());
        let end = instant(day.until_epoch_minutes - 1.0)?.to_zoned(zone);
        let weekday = start.date().weekday().to_monday_one_offset();
        let minute = f64::from(start.hour()) * 60.0 + f64::from(start.minute());
        let transition = start.offset() != end.offset();
        Ok(Self {
            start,
            from: day.from,
            minute,
            transition,
            weekday,
        })
    }
    pub fn minute(&self, offset: f64) -> Result<f64, PremiumError> {
        if !self.transition {
            return Ok(self.minute + offset - self.from);
        }
        let delta = offset - self.from;
        if !delta.is_finite() || delta.fract() != 0.0 || delta.abs() > 20_160.0 {
            return Err(PremiumError::InvalidInput);
        }
        let cursor = self
            .start
            .checked_add(jiff::Span::new().minutes(delta as i64))
            .map_err(|_| PremiumError::InvalidInstant)?;
        Ok(f64::from(cursor.hour()) * 60.0 + f64::from(cursor.minute()))
    }
}
pub(super) fn holiday(
    date: &str,
    work: &Value,
    resolver: &RuleResolver,
) -> Result<Option<bool>, PremiumError> {
    let year = date
        .get(..4)
        .and_then(|s| s.parse::<i32>().ok())
        .ok_or(PremiumError::InvalidInput)?;
    let region = match work.get("holidayRegion") {
        None => "NONE",
        Some(Value::String(s)) => s.as_str(),
        _ => return Err(PremiumError::InvalidInput),
    };
    match holiday_calendar(year, text(work, "federalState")?, region, resolver) {
        Ok(calendar) => Ok(Some(calendar.contains(date))),
        Err(HolidayError::Resolution(_)) => Ok(None),
        Err(e) => Err(e.into()),
    }
}
