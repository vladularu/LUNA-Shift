use super::SpecialDutyError;
use super::types::{self, clock_minute, duty, instant, integer, text, zoned};
use crate::rules::RuleResolver;
use jiff::{Timestamp, ToSpan, civil::Date};
use serde_json::Value;
use serde_json::json;
use std::collections::BTreeSet;

pub fn payroll_traces_from_lines(lines: &[Value]) -> Vec<Value> {
    let mut result = Vec::new();
    for line in lines {
        if let Some(trace) = line["standbyPay"]
            .get("payrollTrace")
            .filter(|trace| !trace.is_null())
        {
            result.push(trace.clone());
        } else if let Some(traces) = line["calloutPay"]["payrollTraces"].as_array() {
            result.extend(traces.iter().cloned());
        }
    }
    result
}
pub(super) fn timestamp(milliseconds: i64, zone: &str) -> Result<String, SpecialDutyError> {
    crate::pay::premium_minutes::timestamp(milliseconds, &crate::time::zone(zone)?)
        .map_err(|_| SpecialDutyError::InvalidInput)
}
fn parse(value: &str) -> Result<i64, SpecialDutyError> {
    value
        .parse::<Timestamp>()
        .map(|stamp| stamp.as_millisecond())
        .map_err(|_| SpecialDutyError::InvalidInput)
}
fn range(start: i64, end: i64, zone: &str) -> Result<Value, SpecialDutyError> {
    Ok(json!({"start":timestamp(start,zone)?,"end":timestamp(end,zone)?}))
}

pub fn duty_payroll_range(shift: &Value, from: i64, until: i64) -> Result<Value, SpecialDutyError> {
    range(
        instant(shift, from)?,
        instant(shift, until)?,
        text(duty(shift)?, "timeZone")?,
    )
}

fn day_rate(date: Date, minute: i64, holidays: &crate::rules::holidays::HolidayCalendar) -> i32 {
    if (date.month() == 12
        && (date.day() == 25 || date.day() == 26 || (date.day() == 24 && minute >= 840)))
        || (date.month() == 5 && date.day() == 1)
    {
        150
    } else if holidays.contains(&date.to_string())
        || (date.month() == 12 && date.day() == 31 && minute >= 840)
    {
        125
    } else if date.weekday().to_monday_one_offset() == 7 {
        50
    } else {
        0
    }
}

pub fn standby_payroll_trace(
    shift: &Value,
    payments: &[Value],
    profile: &Value,
    resolver: &RuleResolver,
) -> Result<Value, SpecialDutyError> {
    let duty = duty(shift)?;
    let zone = text(duty, "timeZone")?;
    let full = duty_payroll_range(
        shift,
        clock_minute(text(shift, "startTime")?)?,
        types::duty_end_minute(shift)?,
    )?;
    let start = parse(text(&full, "start")?)?;
    let end = parse(text(&full, "end")?)?;
    let break_minutes = integer(shift, "breakMinutes")?;
    let break_start = duty
        .get("breakStart")
        .filter(|value| !value.is_null())
        .map(|value| value.as_i64().ok_or(SpecialDutyError::InvalidInput))
        .transpose()?;
    if break_start.is_none()
        && break_minutes > 0
        && payments.iter().any(|payment| {
            payment["kind"] != "OTHER"
                && payment["amountCents"]
                    .as_f64()
                    .is_some_and(|amount| amount > 0.0)
        })
    {
        let date = crate::calendar::parse_date(text(shift, "date")?)?;
        let holidays = crate::rules::holidays::holiday_calendar(
            i32::from(date.year()),
            text(profile, "federalState")?,
            profile["holidayRegion"].as_str().unwrap_or("NONE"),
            resolver,
        )?;
        let mut points = BTreeSet::from([start]);
        for day in 0..=integer(duty, "endDay")? {
            for hour in [0, 4, 6, 14, 20, 24] {
                let at = instant(shift, day * 1440 + hour * 60)?;
                if at > start && at < end {
                    points.insert(at);
                }
            }
        }
        for payment in payments {
            for period in payment["periods"]
                .as_array()
                .ok_or(SpecialDutyError::InvalidInput)?
            {
                for field in ["start", "end"] {
                    let at = parse(text(period, field)?)?;
                    if at >= start && at < end {
                        points.insert(at);
                    }
                }
            }
        }
        let mut signatures = BTreeSet::new();
        for at in points {
            let local = zoned(at, zone)?;
            let date = local.date();
            let minute = i64::from(local.hour()) * 60 + i64::from(local.minute());
            let prior = date.to_string().as_str() > text(shift, "date")?;
            let night = if !(360..1200).contains(&minute) {
                if minute < 240 && prior { 40 } else { 25 }
            } else {
                0
            };
            let prior_day = date
                .checked_sub(1.days())
                .map_err(|_| SpecialDutyError::InvalidInput)?;
            let day = day_rate(date, minute, &holidays).max(if minute < 240 && prior {
                day_rate(prior_day, 1439, &holidays)
            } else {
                0
            });
            let mut signature = Vec::new();
            for payment in payments.iter().filter(|payment| {
                payment["amountCents"]
                    .as_f64()
                    .is_some_and(|amount| amount > 0.0)
            }) {
                let kind = text(payment, "kind")?;
                let mut inside = false;
                for period in payment["periods"]
                    .as_array()
                    .ok_or(SpecialDutyError::InvalidInput)?
                {
                    if parse(text(period, "start")?)? <= at && parse(text(period, "end")?)? > at {
                        inside = true;
                        break;
                    }
                }
                signature.push(format!(
                    "{kind}:{inside}:{}",
                    if kind == "NIGHT" {
                        night
                    } else if kind == "DAY" {
                        day
                    } else {
                        0
                    }
                ));
            }
            signatures.insert(signature.join("|"));
        }
        if signatures.len() != 1 {
            return Err(SpecialDutyError::InvalidInput);
        }
    }
    let pause = if break_minutes > 0 {
        let from = if let Some(minute) = break_start {
            instant(shift, minute)?
        } else {
            end.checked_sub(
                break_minutes
                    .checked_mul(60000)
                    .ok_or(SpecialDutyError::InvalidInput)?,
            )
            .ok_or(SpecialDutyError::InvalidInput)?
        };
        let until = if break_start.is_some() {
            from.checked_add(
                break_minutes
                    .checked_mul(60000)
                    .ok_or(SpecialDutyError::InvalidInput)?,
            )
            .ok_or(SpecialDutyError::InvalidInput)?
        } else {
            end
        };
        vec![range(from, until, zone)?]
    } else {
        Vec::new()
    };
    Ok(
        json!({"id":text(shift,"id")?,"start":full["start"],"end":full["end"],"unpaidBreaks":pause,"payments":payments}),
    )
}
