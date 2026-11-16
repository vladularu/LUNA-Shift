use crate::{EngineError, calendar::parse_date};
use jiff::{
    ToSpan,
    civil::Time,
    tz::{Disambiguation, TimeZone},
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DutyPart {
    pub start: i64,
    pub end: i64,
    pub break_minutes: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DutyCallout {
    pub departure: i64,
    pub returned: i64,
    pub break_minutes: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DutyKind {
    Split,
    OnCall,
    Standby,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialDutyTime {
    pub kind: DutyKind,
    pub time_zone: String,
    pub end_day: i64,
    pub parts: Vec<DutyPart>,
    pub callouts: Vec<DutyCallout>,
}

/// This operation accepts the time projection of a validated full ShiftEntry.
/// Other entry metadata is intentionally not used by time arithmetic.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftTime {
    pub date: String,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub break_minutes: i64,
    #[serde(default)]
    pub all_day: bool,
    #[serde(default)]
    pub special_duty: Option<SpecialDutyTime>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimedShiftBounds {
    pub start_epoch_minutes: i64,
    pub end_epoch_minutes: i64,
    pub gross_minutes: i64,
    pub net_minutes: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimedShiftInstants {
    pub start_epoch_milliseconds: i64,
    pub end_epoch_milliseconds: i64,
}

pub(crate) fn clock(text: &str) -> Result<Time, EngineError> {
    if text.len() != 5 || text.as_bytes()[2] != b':' {
        return Err(EngineError::InvalidTime);
    }
    text.parse().map_err(|_| EngineError::InvalidTime)
}

pub(crate) fn zone(name: &str) -> Result<TimeZone, EngineError> {
    crate::time_zone::zone(name)
}

fn rounded_minutes(milliseconds: i64) -> Result<i64, EngineError> {
    milliseconds
        .checked_add(30_000)
        .map(|n| n.div_euclid(60_000))
        .ok_or(EngineError::Overflow)
}

pub fn shift_instants(
    shift: &ShiftTime,
    time_zone: &str,
) -> Result<Option<TimedShiftInstants>, EngineError> {
    if shift.all_day || shift.start_time.is_none() || shift.end_time.is_none() {
        return Ok(None);
    }
    let (Some(start_text), Some(end_text)) = (&shift.start_time, &shift.end_time) else {
        return Ok(None);
    };
    let start_time = clock(start_text)?;
    let end_time = clock(end_text)?;
    let date = parse_date(&shift.date)?;
    let tz = zone(
        shift
            .special_duty
            .as_ref()
            .map_or(time_zone, |d| d.time_zone.as_str()),
    )?;
    let end_day = shift
        .special_duty
        .as_ref()
        .map_or(i64::from(end_time <= start_time), |d| d.end_day);
    if !(0..=14).contains(&end_day) || shift.break_minutes < 0 {
        return Err(EngineError::InvalidDuration);
    }
    let end_date = date
        .checked_add(end_day.days())
        .map_err(|_| EngineError::InvalidDate)?;
    let start = tz
        .to_ambiguous_zoned(date.to_datetime(start_time))
        .disambiguate(Disambiguation::Earlier)
        .map_err(|_| EngineError::InvalidTime)?;
    let end = tz
        .to_ambiguous_zoned(end_date.to_datetime(end_time))
        .disambiguate(Disambiguation::Later)
        .map_err(|_| EngineError::InvalidTime)?;
    let start_ms = start.timestamp().as_millisecond();
    let end_ms = end.timestamp().as_millisecond();
    Ok(Some(TimedShiftInstants {
        start_epoch_milliseconds: start_ms,
        end_epoch_milliseconds: end_ms,
    }))
}

pub fn shift_bounds(
    shift: &ShiftTime,
    time_zone: &str,
) -> Result<Option<TimedShiftBounds>, EngineError> {
    let Some(instants) = shift_instants(shift, time_zone)? else {
        return Ok(None);
    };
    let start_ms = instants.start_epoch_milliseconds;
    let end_ms = instants.end_epoch_milliseconds;
    let gross = rounded_minutes(end_ms.checked_sub(start_ms).ok_or(EngineError::Overflow)?)?;
    Ok(Some(TimedShiftBounds {
        start_epoch_minutes: rounded_minutes(start_ms)?,
        end_epoch_minutes: rounded_minutes(end_ms)?,
        gross_minutes: gross,
        net_minutes: gross
            .checked_sub(shift.break_minutes)
            .ok_or(EngineError::Overflow)?
            .max(0),
    }))
}

pub(crate) fn duty_instant(date: &str, minute: i64, tz: &TimeZone) -> Result<i64, EngineError> {
    // A fourteen-day parent starting after midnight may finish on day 14
    // at the same clock time (relative minute > 14 * 1440).
    if !(0..15 * 1440).contains(&minute) {
        return Err(EngineError::InvalidDuration);
    }
    let day = parse_date(date)?
        .checked_add(minute.div_euclid(1440).days())
        .map_err(|_| EngineError::InvalidDate)?;
    let clock = Time::new(
        (minute.rem_euclid(1440) / 60) as i8,
        (minute % 60) as i8,
        0,
        0,
    )
    .map_err(|_| EngineError::InvalidTime)?;
    tz.to_ambiguous_zoned(day.to_datetime(clock))
        .disambiguate(Disambiguation::Reject)
        .map(|z| z.timestamp().as_millisecond())
        .map_err(|_| EngineError::AmbiguousDutyTime)
}

pub fn shift_minutes(shift: &ShiftTime, time_zone: &str) -> Result<f64, EngineError> {
    let Some(duty) = &shift.special_duty else {
        return Ok(shift_bounds(shift, time_zone)?.map_or(0.0, |b| b.net_minutes as f64));
    };
    if duty.parts.len() > 100 || duty.callouts.len() > 100 {
        return Err(EngineError::InvalidDuration);
    }
    let tz = zone(&duty.time_zone)?;
    let (Some(start), Some(end)) = (&shift.start_time, &shift.end_time) else {
        return Ok(0.0);
    };
    let mut parts = Vec::new();
    match duty.kind {
        DutyKind::OnCall => parts.extend(
            duty.callouts
                .iter()
                .map(|c| (c.departure, c.returned, c.break_minutes)),
        ),
        DutyKind::Split | DutyKind::Standby => {
            let a = clock(start)?;
            let b = clock(end)?;
            parts.push((
                i64::from(a.hour()) * 60 + i64::from(a.minute()),
                duty.end_day * 1440 + i64::from(b.hour()) * 60 + i64::from(b.minute()),
                shift.break_minutes,
            ));
            parts.extend(duty.parts.iter().map(|p| (p.start, p.end, p.break_minutes)));
        }
    }
    let mut total = 0.0;
    for (start, end, pause) in parts {
        if pause < 0 {
            return Err(EngineError::InvalidDuration);
        }
        let elapsed = duty_instant(&shift.date, end, &tz)?
            .checked_sub(duty_instant(&shift.date, start, &tz)?)
            .ok_or(EngineError::Overflow)?;
        // Recorded elapsed time mirrors the TS millisecond/minute operation.
        // Weighted tariff credits are a separate exact decimal type.
        total += (elapsed as f64 / 60_000.0 - pause as f64).max(0.0);
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn shift(date: &str) -> ShiftTime {
        ShiftTime {
            date: date.into(),
            start_time: Some("21:00".into()),
            end_time: Some("07:00".into()),
            break_minutes: 30,
            all_day: false,
            special_duty: None,
        }
    }
    #[test]
    fn overnight_hours_follow_real_dst_elapsed_time() {
        assert_eq!(
            shift_minutes(&shift("2026-03-28"), "Europe/Berlin"),
            Ok(510.0)
        );
        assert_eq!(
            shift_minutes(&shift("2026-10-24"), "Europe/Berlin"),
            Ok(630.0)
        );
        assert_eq!(
            shift_minutes(&shift("2026-11-01"), "Europe/Berlin"),
            Ok(570.0)
        );
    }
}
