use super::{Family, FamilyError, common::*, profile};
use crate::{
    net::premium_trace::{premium_category, premium_kind},
    rules::{RuleResolver, holidays::holiday_map_for_month},
};
use serde_json::{Value, json};
use std::collections::BTreeMap;

struct Context {
    monthly: i64,
    hourly: i64,
}
fn context(
    date: &str,
    selection: &Value,
    weekly: i64,
    resolver: &RuleResolver,
) -> Result<Option<Context>, FamilyError> {
    let Some(selected) = profile::require_tvuk_nursing_tariff(selection)? else {
        return Ok(None);
    };
    let Some(table) = raw_table(Family::Tvuk, date, resolver)? else {
        return Ok(None);
    };
    if weekly <= 0 || weekly > 2310 {
        return Ok(None);
    }
    let group = string(&selected, "payGroup")?;
    let level = integer(&selected, "payLevel")?.to_string();
    let monthly = table["groups"][group][&level].as_i64();
    let Some(monthly) = monthly.filter(|v| *v > 0) else {
        return Ok(None);
    };
    Ok(Some(Context {
        monthly,
        hourly: round(monthly * 60000, 2310 * 4348)?,
    }))
}
fn is_night(minute: i64) -> bool {
    !(360..1200).contains(&minute)
}
#[derive(Clone)]
struct Bucket {
    key: &'static str,
    label: &'static str,
    percentage: i64,
    hourly: i64,
    minutes: i64,
    id: String,
}

pub fn calculate_shift(
    shift: &Value,
    work_profile: &Value,
    regular_shift_work: bool,
    paid_night_breaks: bool,
    resolver: &RuleResolver,
    capture_trace: bool,
) -> Result<Value, FamilyError> {
    let mut empty = empty_shift(shift);
    empty["nightCompensatoryMinutes"] = json!(0);
    if !work(shift) {
        return Ok(empty);
    }
    let Some(bounds) = bounds(shift, work_profile)? else {
        return Ok(empty);
    };
    let pause = integer(shift, "breakMinutes")?.min(bounds.gross_minutes);
    let pause_from = (bounds.gross_minutes - pause).div_euclid(2);
    let mut trace = traced(shift, &bounds, capture_trace, false)?;
    let start = start(&bounds, work_profile)?;
    let mut paid_pause = 0;
    if paid_night_breaks {
        for offset in pause_from..pause_from + pause {
            let section = Section {
                from: 0,
                until: bounds.gross_minutes,
                date: String::new(),
                weekday: 0,
                start_minute: 0,
                transition: true,
            };
            if is_night(minute(&start, &section, offset)?) {
                paid_pause += 1
            }
        }
    }
    let paid_minutes = bounds.net_minutes + paid_pause;
    let confirmed = if shift["tariffOvertimeConfirmed"] == true {
        integer(shift, "overtimeMinutes")?.min(paid_minutes)
    } else {
        0
    };
    let mut remaining = paid_minutes;
    let mut night_minutes = 0;
    let mut buckets: Vec<Bucket> = vec![];
    let mut overtime: BTreeMap<i64, i64> = BTreeMap::new();
    for section in sections(&start, bounds.gross_minutes)? {
        let ctx = context(
            &section.date,
            &work_profile["tvUkNursingTariff"],
            integer(work_profile, "weeklyMinutes")?,
            resolver,
        )?
        .ok_or_else(|| missing(Family::Tvuk, &section.date))?;
        let holidays = holiday_map_for_month(
            &section.date[..7],
            string(work_profile, "federalState")?,
            work_profile["holidayRegion"].as_str().unwrap_or("NONE"),
            resolver,
        )?;
        let core_rate = if section.date.as_str() < "2025-01-01" {
            3000
        } else {
            3500
        };
        let sunday_rate = if section.date.as_str() < "2025-01-01" {
            2500
        } else {
            4000
        };
        for offset in section.from..section.until {
            let minute = minute(&start, &section, offset)?;
            if offset >= pause_from
                && offset < pause_from + pause
                && !(paid_night_breaks && is_night(minute))
            {
                continue;
            }
            let mut count = |key: &'static str,
                             label: &'static str,
                             percentage: i64|
             -> Result<(), FamilyError> {
                let id = json!([key, percentage, ctx.hourly]).to_string();
                if let Some(bucket) = buckets.iter_mut().find(|b| b.id == id) {
                    bucket.minutes += 1
                } else {
                    buckets.push(Bucket {
                        key,
                        label,
                        percentage,
                        hourly: ctx.hourly,
                        minutes: 1,
                        id: id.clone(),
                    });
                }
                if let Some(trace) = &mut trace {
                    trace
                        .add_milliseconds(&id, bounds.start_epoch_milliseconds + offset * 60000)?;
                }
                Ok(())
            };
            if is_night(minute) {
                night_minutes += 1;
                count(
                    "night",
                    "Nacht",
                    if minute < 240 { core_rate } else { 2000 },
                )?;
            } else if regular_shift_work {
                count("shift", "Schichtdienst (6–20 Uhr)", 280)?;
            }
            if section.weekday == 7 {
                count("sunday", "Sonntag", sunday_rate)?;
            } else if holidays.contains_key(&section.date) {
                count("holiday", "Feiertag", 2500)?;
            } else if matches!(&section.date[5..], "12-24" | "12-31") {
                count("preholiday", "24./31. Dezember", 2500)?;
            }
            if remaining <= confirmed {
                *overtime.entry(ctx.hourly).or_default() += 1;
            }
            remaining -= 1;
        }
    }
    let mut lines = vec![];
    let mut premium_total = 0;
    for bucket in buckets {
        let amount = round(bucket.hourly * bucket.percentage * bucket.minutes, 600000)?;
        premium_total += amount;
        if let Some(trace) = &mut trace {
            trace.pay(
                &bucket.id,
                premium_kind(bucket.key),
                amount,
                Some(premium_category(bucket.key)),
            )?;
        }
        lines.push(json!({"key":bucket.key,"label":bucket.label,"ruleId":format!("tvuk-{}-{}",bucket.key,bucket.percentage),"minutes":bucket.minutes,"percentage":scalar(bucket.percentage as f64/100.0),"hourlyRate":euros(bucket.hourly),"amount":euros(amount)}));
    }
    let (mut overtime_base, mut overtime_premium) = (0, 0);
    for (rate, minutes) in overtime {
        overtime_base += round(rate * minutes, 60)?;
        overtime_premium += round(rate * minutes * 2500, 600000)?;
    }
    empty["netMinutes"] = json!(paid_minutes);
    empty["premiumLines"] = Value::Array(lines);
    empty["overtimeBaseAmount"] = euros(overtime_base);
    empty["overtimePremiumAmount"] = euros(overtime_premium);
    empty["totalAmount"] = euros(premium_total + overtime_base + overtime_premium);
    empty["nightCompensatoryMinutes"] = scalar(night_minutes as f64 / 20.0);
    if let Some(trace) = trace {
        empty["payrollTrace"] = trace.finish()?;
    }
    Ok(empty)
}

pub fn calculate_assessment(
    month: &str,
    shifts: &[Value],
    resolver: &RuleResolver,
) -> Result<Value, FamilyError> {
    let relevant: Vec<_> = shifts
        .iter()
        .filter(|s| {
            work(s)
                && s["date"]
                    .as_str()
                    .is_some_and(|date| date.starts_with(&format!("{month}-")))
        })
        .collect();
    let mut times = vec![];
    for shift in &relevant {
        let from = crate::time::clock(string(shift, "startTime")?)?;
        let end = crate::time::clock(string(shift, "endTime")?)?;
        let from = i64::from(from.hour()) * 60 + i64::from(from.minute());
        let until = i64::from(end.hour()) * 60 + i64::from(end.minute());
        times.push((from, if until <= from { until + 1440 } else { until }));
    }
    let change =
        times.len() > 1 && times.iter().map(|t| t.0).max() != times.iter().map(|t| t.0).min();
    let span = times
        .iter()
        .map(|t| t.1)
        .max()
        .zip(times.iter().map(|t| t.0).min())
        .map(|(end, start)| end - start)
        .unwrap_or(0);
    let regular = change && span >= 780;
    let state = if regular {
        "DETECTED"
    } else if times.is_empty() {
        "NOT_DETECTED"
    } else {
        "REVIEW"
    };
    // Source availability uses the local table, without a caller catalog override.
    let available = data()?
        .tvuk_tables
        .iter()
        .any(|t| active(&format!("{month}-01"), t));
    let _ = resolver;
    Ok(
        json!({"available":available,"tariffLabel":Family::Tvuk.label(),"assessment":{"shiftWork":state,"alternatingShiftWork":"NOT_DETECTED","suggestedAllowance":"NONE","evidence":if regular{vec!["Wechselnde Dienstbeginne und mindestens 13 Stunden Dienstspanne im Monat."]}else{vec![]},"criteria":[{"key":"SHIFT_CHANGES","label":"Regelmäßiger Schichtdienst","detail":"TV-UK: Wechsel der täglichen Arbeitszeit innerhalb eines Monats und eine Dienstspanne von mindestens 13 Stunden.","state":if regular{"MET"}else if times.is_empty(){"NOT_MET"}else{"OPEN"}}],"requiresConfirmation":false,"estimateNote":"Schichtdienst aus den erfassten Diensten geschätzt. Nachtpausen werden als unbezahlte Pausen berücksichtigt, solange die Voraussetzung für eine bezahlte Pause nicht bestätigt ist."}}),
    )
}

pub fn calculate_month(
    month: &str,
    shifts: &[Value],
    work_profile: &Value,
    assessment_shifts: &[Value],
    resolver: &RuleResolver,
) -> Result<Value, FamilyError> {
    calculate_month_with_capture(
        month,
        shifts,
        work_profile,
        assessment_shifts,
        resolver,
        false,
    )
}
pub(super) fn calculate_month_with_capture(
    month: &str,
    shifts: &[Value],
    work_profile: &Value,
    assessment_shifts: &[Value],
    resolver: &RuleResolver,
    capture: bool,
) -> Result<Value, FamilyError> {
    let selected = selection(Family::Tvuk, work_profile)?
        .ok_or(FamilyError::Message("TV-UK-Pflegegruppe fehlt."))?;
    let assessment = calculate_assessment(month, assessment_shifts, resolver)?;
    let regular = assessment["assessment"]["shiftWork"] == "DETECTED";
    let date = month_first(month)?;
    let weekly = integer(work_profile, "weeklyMinutes")?;
    let ctx = context(&date, &selected, weekly, resolver)?;
    let mut result = empty_month(month, Family::Tvuk, ctx.is_some())?;
    result["nightCompensatoryMinutes"] = json!(0);
    let Some(ctx) = ctx else { return Ok(result) };
    let mut breakdowns = vec![];
    for shift in shifts.iter().filter(|s| {
        work(s)
            && s["date"]
                .as_str()
                .is_some_and(|date| date.starts_with(&format!("{month}-")))
    }) {
        breakdowns.push(calculate_shift(
            shift,
            work_profile,
            regular,
            false,
            resolver,
            capture,
        )?);
    }
    let base = round(ctx.monthly * weekly, 2310)?;
    let care = if selected["payGroup"] == "PUK5" {
        0
    } else {
        round(20000 * weekly, 2310)?
    };
    let (premiums, overtime) = sum_breakdowns(&breakdowns)?;
    result["fullTimeTableAmount"] = euros(ctx.monthly);
    result["personalBaseAmount"] = euros(base);
    result["careAllowanceAmount"] = euros(care);
    result["timePremiumAmount"] = euros(premiums);
    result["overtimeAmount"] = euros(overtime);
    result["nightCompensatoryMinutes"] = scalar(
        breakdowns
            .iter()
            .map(|b| b["nightCompensatoryMinutes"].as_f64().unwrap_or(0.0))
            .sum::<f64>(),
    );
    result["shiftBreakdowns"] = Value::Array(breakdowns);
    result["estimatedGrossAmount"] = euros(base + care + premiums + overtime);
    result["assessment"] = assessment["assessment"].clone();
    Ok(result)
}

pub fn duty_hourly(
    date: &str,
    work_profile: &Value,
    resolver: &RuleResolver,
) -> Result<Value, FamilyError> {
    let selection = &work_profile["tvUkNursingTariff"];
    if selection.is_null() {
        return Ok(Value::Null);
    }
    Ok(context(
        date,
        selection,
        integer(work_profile, "weeklyMinutes")?,
        resolver,
    )?
    .map(|c| json!(c.hourly))
    .unwrap_or(Value::Null))
}
