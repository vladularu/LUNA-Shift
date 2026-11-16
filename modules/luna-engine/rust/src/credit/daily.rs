use super::{
    decimal,
    interval::{MinuteInterval, merge_interval, overlapping_minutes},
    number,
    prepared::PreparedCreditEntries,
    string, zero,
};
use crate::{
    EngineError,
    calendar::recurrence::CollationRanks,
    time::{ShiftTime, TimedShiftBounds, shift_bounds},
};
use bigdecimal::BigDecimal;
use serde_json::{Value, json};
use std::collections::BTreeMap;

/// Resolved by the Rust target/employment/holiday package before app activation.
/// It is calculation input, never a guessed READY state or permanent TS fallback.
#[derive(Debug, Clone)]
pub struct DailyCreditContext {
    pub target_minutes: BigDecimal,
    pub absence_reference_minutes: BigDecimal,
}

impl DailyCreditContext {
    pub fn from_json(value: &Value) -> Result<Self, EngineError> {
        Ok(Self {
            target_minutes: decimal(&value["targetMinutes"])?,
            absence_reference_minutes: decimal(&value["absenceReferenceMinutes"])?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct CreditAllocation {
    pub entry: Value,
    pub minutes: BigDecimal,
}

#[derive(Debug, Clone)]
pub struct TimedDailyWorkCredit {
    pub date: String,
    pub actual_minutes: BigDecimal,
    pub work_minutes: BigDecimal,
    pub training_minutes: BigDecimal,
    pub overlap_minutes: BigDecimal,
    pub minutes_by_type: BTreeMap<String, BigDecimal>,
}

#[derive(Debug, Clone)]
pub struct DailyWorkCredit {
    pub timed: TimedDailyWorkCredit,
    pub target_minutes: BigDecimal,
    pub actual_minutes: BigDecimal,
    pub balance_minutes: BigDecimal,
    pub vacation_minutes: BigDecimal,
    pub sick_minutes: BigDecimal,
    pub minutes_by_type: BTreeMap<String, BigDecimal>,
}

#[derive(Debug, Clone)]
pub struct CreditResult<T> {
    pub summary: T,
    pub allocations: Vec<CreditAllocation>,
}

/// Native calculation view. Original metadata is borrowed from the prepared
/// immutable owner; the compatibility API below owns it only at its output edge.
pub struct BorrowedCreditAllocation<'a> {
    pub entry: &'a Value,
    pub minutes: BigDecimal,
}
pub struct BorrowedCreditResult<'a, T> {
    pub summary: T,
    pub allocations: Vec<BorrowedCreditAllocation<'a>>,
}
impl<T> BorrowedCreditResult<'_, T> {
    fn into_owned(self) -> CreditResult<T> {
        CreditResult {
            summary: self.summary,
            allocations: self
                .allocations
                .into_iter()
                .map(|allocation| CreditAllocation {
                    entry: allocation.entry.clone(),
                    minutes: allocation.minutes,
                })
                .collect(),
        }
    }
}

fn by_type_json(values: &BTreeMap<String, BigDecimal>) -> Result<Value, EngineError> {
    values
        .iter()
        .map(|(key, value)| number(value).map(|value| (key.clone(), value)))
        .collect::<Result<serde_json::Map<_, _>, _>>()
        .map(Value::Object)
}

fn allocations_json(values: &[CreditAllocation]) -> Result<Value, EngineError> {
    values
        .iter()
        .map(|allocation| {
            Ok(json!({"entry":allocation.entry,"minutes":number(&allocation.minutes)?}))
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

impl TimedDailyWorkCredit {
    /// Compatibility JSON is only the wire representation; all allocation arithmetic
    /// above it retains exact decimal minutes, including projected fractional pauses.
    pub fn to_json(&self) -> Result<Value, EngineError> {
        Ok(
            json!({"date":self.date,"actualMinutes":number(&self.actual_minutes)?,"workMinutes":number(&self.work_minutes)?,"trainingMinutes":number(&self.training_minutes)?,"overlapMinutes":number(&self.overlap_minutes)?,"minutesByType":by_type_json(&self.minutes_by_type)?}),
        )
    }
}

impl CreditResult<TimedDailyWorkCredit> {
    pub fn to_json(&self) -> Result<Value, EngineError> {
        Ok(
            json!({"summary":self.summary.to_json()?,"allocations":allocations_json(&self.allocations)?}),
        )
    }
}

impl CreditResult<DailyWorkCredit> {
    pub fn to_json(&self) -> Result<Value, EngineError> {
        let summary = &self.summary;
        let mut value = summary.timed.to_json()?;
        let map = value
            .as_object_mut()
            .ok_or(EngineError::InvalidCalendarEntry)?;
        for (key, minutes) in [
            ("targetMinutes", &summary.target_minutes),
            ("actualMinutes", &summary.actual_minutes),
            ("balanceMinutes", &summary.balance_minutes),
            ("vacationMinutes", &summary.vacation_minutes),
            ("sickMinutes", &summary.sick_minutes),
        ] {
            map.insert(key.to_owned(), number(minutes)?);
        }
        map.insert(
            "minutesByType".into(),
            by_type_json(&summary.minutes_by_type)?,
        );
        Ok(json!({"summary":value,"allocations":allocations_json(&self.allocations)?}))
    }
}

fn nullable_time(entry: &Value, field: &str) -> Result<Option<String>, EngineError> {
    match entry.get(field) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        _ => Err(EngineError::InvalidCalendarEntry),
    }
}

fn bounds(
    entry: &Value,
    time_zone: &str,
) -> Result<Option<(TimedShiftBounds, BigDecimal)>, EngineError> {
    if entry.get("allDay").and_then(Value::as_bool) == Some(true) {
        return Ok(None);
    }
    let start_time = nullable_time(entry, "startTime")?;
    let end_time = nullable_time(entry, "endTime")?;
    if start_time.is_none() || end_time.is_none() {
        return Ok(None);
    }
    // Projection already removed specialDuty. Reuse the shared date/DST policy,
    // but not its validated-integer pause field: business projections may be decimal.
    let time = ShiftTime {
        date: string(entry, "date")?.to_owned(),
        start_time,
        end_time,
        break_minutes: 0,
        all_day: false,
        special_duty: None,
    };
    let Some(bounds) = shift_bounds(&time, time_zone)? else {
        return Ok(None);
    };
    let net =
        (BigDecimal::from(bounds.gross_minutes) - decimal(&entry["breakMinutes"])?).max(zero());
    Ok(Some((bounds, net)))
}

struct GroupCredit<'a> {
    minutes: BigDecimal,
    overlap_minutes: BigDecimal,
    coverage: Vec<MinuteInterval>,
    minutes_by_type: BTreeMap<String, BigDecimal>,
    allocations: Vec<BorrowedCreditAllocation<'a>>,
}

fn credit_timed_entries<'a>(
    entries: &[&'a Value],
    time_zone: &str,
    initial_coverage: &[MinuteInterval],
    collation: &CollationRanks,
    capture_allocations: bool,
) -> Result<GroupCredit<'a>, EngineError> {
    let mut candidates = Vec::new();
    for entry in entries {
        if let Some((bounds, net)) = bounds(entry, time_zone)? {
            candidates.push((*entry, bounds, net, collation.rank(string(entry, "id")?)?));
        }
    }
    candidates.sort_by_key(|(_, bounds, _, id_rank)| (bounds.start_epoch_minutes, *id_rank));
    let mut result = GroupCredit {
        minutes: zero(),
        overlap_minutes: zero(),
        coverage: initial_coverage.to_vec(),
        minutes_by_type: BTreeMap::new(),
        allocations: Vec::new(),
    };
    for (entry, bounds, net, _) in candidates {
        let interval = MinuteInterval {
            start: bounds.start_epoch_minutes,
            end: bounds.end_epoch_minutes,
        };
        let uncovered = bounds
            .gross_minutes
            .checked_sub(overlapping_minutes(interval, &result.coverage)?)
            .ok_or(EngineError::Overflow)?
            .max(0);
        let credited = net.clone().min(BigDecimal::from(uncovered));
        result.minutes += &credited;
        *result
            .minutes_by_type
            .entry(string(entry, "type")?.to_owned())
            .or_insert_with(zero) += &credited;
        if capture_allocations {
            result.allocations.push(BorrowedCreditAllocation {
                entry,
                minutes: credited.clone(),
            });
        }
        result.overlap_minutes += net - credited;
        result.coverage = merge_interval(&result.coverage, interval);
    }
    Ok(result)
}

pub fn calculate_timed_daily_work_credit(
    date: &str,
    entries: &[Value],
    time_zone: &str,
    collation: &CollationRanks,
) -> Result<CreditResult<TimedDailyWorkCredit>, EngineError> {
    let prepared = PreparedCreditEntries::new(entries)?;
    calculate_timed_daily_work_credit_prepared(date, &prepared, time_zone, collation)
}
pub fn calculate_timed_daily_work_credit_prepared(
    date: &str,
    entries: &PreparedCreditEntries<'_>,
    time_zone: &str,
    collation: &CollationRanks,
) -> Result<CreditResult<TimedDailyWorkCredit>, EngineError> {
    Ok(
        calculate_timed_daily_work_credit_borrowed_prepared(date, entries, time_zone, collation)?
            .into_owned(),
    )
}
pub fn calculate_timed_daily_work_credit_borrowed_prepared<'a>(
    date: &str,
    entries: &'a PreparedCreditEntries<'_>,
    time_zone: &str,
    collation: &CollationRanks,
) -> Result<BorrowedCreditResult<'a, TimedDailyWorkCredit>, EngineError> {
    timed_from_active(date, &entries.active(date), time_zone, collation, true)
}
fn timed_from_active<'a>(
    date: &str,
    active: &[&'a Value],
    time_zone: &str,
    collation: &CollationRanks,
    capture_allocations: bool,
) -> Result<BorrowedCreditResult<'a, TimedDailyWorkCredit>, EngineError> {
    let mut work_entries = Vec::new();
    let mut training_entries = Vec::new();
    for entry in active {
        match string(entry, "type")? {
            "TRAINING" => training_entries.push(*entry),
            "VACATION" | "SICK" | "FREE" => {}
            _ => work_entries.push(*entry),
        }
    }
    let work = credit_timed_entries(
        &work_entries,
        time_zone,
        &[],
        collation,
        capture_allocations,
    )?;
    let training = credit_timed_entries(
        &training_entries,
        time_zone,
        &work.coverage,
        collation,
        capture_allocations,
    )?;
    let mut minutes_by_type = work.minutes_by_type;
    minutes_by_type.extend(training.minutes_by_type);
    let mut allocations = work.allocations;
    allocations.extend(training.allocations);
    Ok(BorrowedCreditResult {
        summary: TimedDailyWorkCredit {
            date: date.to_owned(),
            actual_minutes: &work.minutes + &training.minutes,
            work_minutes: work.minutes,
            training_minutes: training.minutes,
            overlap_minutes: work.overlap_minutes + training.overlap_minutes,
            minutes_by_type,
        },
        allocations,
    })
}

pub fn calculate_daily_work_credit(
    date: &str,
    entries: &[Value],
    time_zone: &str,
    context: &DailyCreditContext,
    collation: &CollationRanks,
) -> Result<CreditResult<DailyWorkCredit>, EngineError> {
    let prepared = PreparedCreditEntries::new(entries)?;
    calculate_daily_work_credit_prepared(date, &prepared, time_zone, context, collation)
}
pub fn calculate_daily_work_credit_prepared(
    date: &str,
    entries: &PreparedCreditEntries<'_>,
    time_zone: &str,
    context: &DailyCreditContext,
    collation: &CollationRanks,
) -> Result<CreditResult<DailyWorkCredit>, EngineError> {
    Ok(
        calculate_daily_work_credit_borrowed_prepared(
            date, entries, time_zone, context, collation,
        )?
        .into_owned(),
    )
}
pub fn calculate_daily_work_credit_borrowed_prepared<'a>(
    date: &str,
    entries: &'a PreparedCreditEntries<'_>,
    time_zone: &str,
    context: &DailyCreditContext,
    collation: &CollationRanks,
) -> Result<BorrowedCreditResult<'a, DailyWorkCredit>, EngineError> {
    daily_from_active(
        date,
        &entries.active(date),
        time_zone,
        context,
        collation,
        true,
    )
}
/// Same validation, fold order and absence-owner ranking, without cloning the
/// original allocation metadata when the caller only consumes daily totals.
pub fn calculate_daily_work_credit_summary_prepared(
    date: &str,
    entries: &PreparedCreditEntries<'_>,
    time_zone: &str,
    context: &DailyCreditContext,
    collation: &CollationRanks,
) -> Result<DailyWorkCredit, EngineError> {
    Ok(daily_from_active(
        date,
        &entries.active(date),
        time_zone,
        context,
        collation,
        false,
    )?
    .summary)
}
fn daily_from_active<'a>(
    date: &str,
    active: &[&'a Value],
    time_zone: &str,
    context: &DailyCreditContext,
    collation: &CollationRanks,
    capture_allocations: bool,
) -> Result<BorrowedCreditResult<'a, DailyWorkCredit>, EngineError> {
    let mut timed = timed_from_active(date, active, time_zone, collation, capture_allocations)?;
    let has_type = |kind: &str| {
        active
            .iter()
            .any(|entry| entry.get("type").and_then(Value::as_str) == Some(kind))
    };
    let absence = if has_type("VACATION") || has_type("SICK") {
        (&context.absence_reference_minutes - &timed.summary.actual_minutes).max(zero())
    } else {
        zero()
    };
    let sick = if has_type("SICK") {
        absence.clone()
    } else {
        zero()
    };
    let vacation = if sick == zero() && has_type("VACATION") {
        absence.clone()
    } else {
        zero()
    };
    let actual = &timed.summary.actual_minutes + &absence;
    let mut minutes_by_type = timed.summary.minutes_by_type.clone();
    if sick > zero() {
        minutes_by_type.insert("SICK".into(), sick.clone());
    }
    if vacation > zero() {
        minutes_by_type.insert("VACATION".into(), vacation.clone());
    }
    if absence > zero() {
        let absence_type = if sick > zero() { "SICK" } else { "VACATION" };
        let mut owners = active
            .iter()
            .copied()
            .filter(|entry| entry.get("type").and_then(Value::as_str) == Some(absence_type))
            .map(|entry| {
                collation
                    .rank(string(entry, "id")?)
                    .map(|rank| (rank, entry))
            })
            .collect::<Result<Vec<_>, _>>()?;
        owners.sort_by_key(|(rank, _)| *rank);
        if capture_allocations && let Some((_, owner)) = owners.first() {
            timed.allocations.push(BorrowedCreditAllocation {
                entry: owner,
                minutes: absence,
            });
        }
    }
    Ok(BorrowedCreditResult {
        summary: DailyWorkCredit {
            target_minutes: context.target_minutes.clone(),
            balance_minutes: &actual - &context.target_minutes,
            actual_minutes: actual,
            vacation_minutes: vacation,
            sick_minutes: sick,
            minutes_by_type,
            timed: timed.summary,
        },
        allocations: timed.allocations,
    })
}
