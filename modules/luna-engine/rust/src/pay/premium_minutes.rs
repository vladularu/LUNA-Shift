//! Premium minute classification; monetary rates and line amounts are separate.
use super::{
    conditions::{ConditionShift, RuleConditions, conditions_match},
    tariff::TariffProfile,
};
use crate::{
    EngineError,
    calendar::parse_date,
    credit::{decimal, number},
    rules::{
        RuleResolver,
        holidays::{HolidayError, get_public_holidays},
    },
    time::{self, ShiftTime},
};
use bigdecimal::{BigDecimal, RoundingMode};
use jiff::{
    Timestamp, Zoned,
    civil::{Date, Time},
    tz::{Disambiguation, TimeZone},
};
use num_traits::ToPrimitive;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
};

#[derive(Debug)]
pub enum PremiumError {
    Calculation(EngineError),
    Holiday(HolidayError),
    InvalidInput,
    InvalidInterval,
    MissingPriorityWinner(String),
}
impl fmt::Display for PremiumError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Calculation(error) => fmt::Display::fmt(error, f),
            Self::Holiday(error) => fmt::Display::fmt(error, f),
            Self::InvalidInput => f.write_str("Invalid premium input"),
            Self::InvalidInterval => f.write_str("Ungültiges Zuschlagsintervall."),
            Self::MissingPriorityWinner(id) => {
                write!(f, "Combination rule {id} has no active priority winner.")
            }
        }
    }
}
impl std::error::Error for PremiumError {}
impl From<EngineError> for PremiumError {
    fn from(error: EngineError) -> Self {
        Self::Calculation(error)
    }
}
impl From<HolidayError> for PremiumError {
    fn from(error: HolidayError) -> Self {
        Self::Holiday(error)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum PremiumType {
    Night,
    Sunday,
    HolidayWithTimeOff,
    HolidayWithoutTimeOff,
    Saturday,
    PreHoliday,
    Overtime,
}
impl PremiumType {
    fn name(&self) -> &'static str {
        match self {
            Self::Night => "NIGHT",
            Self::Sunday => "SUNDAY",
            Self::HolidayWithTimeOff => "HOLIDAY_WITH_TIME_OFF",
            Self::HolidayWithoutTimeOff => "HOLIDAY_WITHOUT_TIME_OFF",
            Self::Saturday => "SATURDAY",
            Self::PreHoliday => "PRE_HOLIDAY",
            Self::Overtime => "OVERTIME",
        }
    }
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TimeWindow {
    start_minute: i64,
    end_minute: i64,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PremiumRule {
    id: String,
    premium_type: PremiumType,
    percentage_basis_points: i64,
    time_window: Option<TimeWindow>,
    conditions: RuleConditions,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum CombinationMode {
    Stack,
    ExclusiveHighest,
    Priority,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CombinationRule {
    id: String,
    member_rule_ids: Vec<String>,
    mode: CombinationMode,
    priority_rule_ids: Vec<String>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PremiumRules {
    premium_rules: Vec<PremiumRule>,
    combination_rules: Vec<CombinationRule>,
}
impl PremiumRules {
    pub fn from_json(rules: &Value) -> Result<Self, PremiumError> {
        Self::deserialize(rules).map_err(|_| PremiumError::InvalidInput)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PremiumMinuteInterval {
    pub from: i64,
    pub until: i64,
    #[serde(default)]
    pub capture_minutes: bool,
}
impl PremiumMinuteInterval {
    pub fn new(from: i64, until: i64) -> Self {
        Self {
            from,
            until,
            capture_minutes: false,
        }
    }
    pub fn with_capture(mut self) -> Self {
        self.capture_minutes = true;
        self
    }
}
#[derive(Debug, Clone)]
pub struct PremiumMinuteSpan {
    pub gross_minutes: i64,
    pub break_start: BigDecimal,
    pub break_end: BigDecimal,
}
#[derive(Debug, Clone, Default)]
pub struct ClassifiedMinutes {
    pub by_rule_id: BTreeMap<String, i64>,
    /// First-hit Map insertion order; downstream premium arrays must retain it.
    pub rule_order: Vec<String>,
    pub counted: Vec<CountedMinute>,
}

#[derive(Debug, Clone)]
pub struct CountedMinute {
    pub rule_id: String,
    pub epoch_milliseconds: i64,
}

impl CountedMinute {
    /// Only for consumers whose contract requires integral epoch minutes.
    /// Use epoch_milliseconds with the native trace builder to retain historical offsets.
    pub fn checked_epoch_minute(&self) -> Result<i64, PremiumError> {
        if self.epoch_milliseconds.rem_euclid(60_000) != 0 {
            return Err(PremiumError::InvalidInput);
        }
        Ok(self.epoch_milliseconds.div_euclid(60_000))
    }
}
impl ClassifiedMinutes {
    /// Native counted timestamps remain exact epoch milliseconds. This adapter
    /// mirrors the old onCount epoch-minute JSON contract for differential tests.
    pub fn to_json(&self) -> Result<Value, PremiumError> {
        let counted = self
            .counted
            .iter()
            .map(|minute| {
                Ok(json!([
                    minute.rule_id,
                    number(
                        &(BigDecimal::from(minute.epoch_milliseconds) / BigDecimal::from(60_000))
                    )?
                ]))
            })
            .collect::<Result<Vec<_>, PremiumError>>()?;
        Ok(json!({"byRuleId":self.by_rule_id,"counted":counted}))
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TimeRange {
    pub start: String,
    pub end: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinuteTraceItem {
    pub rule_id: String,
    pub premium_type: String,
    pub minutes: i64,
    pub periods: Vec<TimeRange>,
}
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PremiumMinuteTrace {
    pub start: String,
    pub end: String,
    pub unpaid_breaks: Vec<TimeRange>,
    pub premiums: Vec<MinuteTraceItem>,
    #[serde(skip)]
    classified: Option<ClassifiedMinutes>,
}
impl PremiumMinuteTrace {
    pub fn classified(&self) -> Option<&ClassifiedMinutes> {
        self.classified.as_ref()
    }
    pub fn to_json(&self) -> Result<Value, PremiumError> {
        serde_json::to_value(self).map_err(|_| PremiumError::InvalidInput)
    }
}

fn string<'a>(value: &'a Value, field: &str) -> Result<&'a str, PremiumError> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or(PremiumError::InvalidInput)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GrossShiftTime {
    date: String,
    start_time: Option<String>,
    end_time: Option<String>,
    #[serde(default)]
    all_day: bool,
    #[serde(default)]
    special_duty: Option<time::SpecialDutyTime>,
}

pub fn span_from_shift(shift: &Value, profile: &Value) -> Result<PremiumMinuteSpan, PremiumError> {
    let parsed = GrossShiftTime::deserialize(shift).map_err(|_| PremiumError::InvalidInput)?;
    let input = ShiftTime {
        date: parsed.date,
        start_time: parsed.start_time,
        end_time: parsed.end_time,
        all_day: parsed.all_day,
        special_duty: parsed.special_duty,
        break_minutes: 0,
    };
    let gross = time::shift_minutes(&input, string(profile, "timeZone")?)?;
    if !gross.is_finite() || gross.fract() != 0.0 || gross < 0.0 || gross >= i64::MAX as f64 {
        return Err(PremiumError::InvalidInput);
    }
    let gross_minutes = gross as i64;
    let pause = shift["breakMinutes"]
        .as_f64()
        .filter(|pause| pause.is_finite())
        .ok_or(PremiumError::InvalidInput)?
        .min(gross);
    // The source computes these two intermediate boundaries as IEEE-754 numbers.
    // Convert their results, rather than re-evaluating subtraction/addition in decimal.
    let source_start = ((gross - pause) / 2.0).floor();
    let break_start = decimal(&json!(source_start))?;
    let break_end = decimal(&json!(source_start + pause))?;
    Ok(PremiumMinuteSpan {
        gross_minutes,
        break_start,
        break_end,
    })
}

fn zoned_start(shift: &Value, profile: &Value) -> Result<Zoned, PremiumError> {
    let date = parse_date(string(shift, "date")?)?;
    let clock: Time = string(shift, "startTime")?
        .parse()
        .map_err(|_| PremiumError::InvalidInput)?;
    let clock =
        Time::new(clock.hour(), clock.minute(), 0, 0).map_err(|_| PremiumError::InvalidInput)?;
    time::zone(string(profile, "timeZone")?)?
        .to_ambiguous_zoned(date.to_datetime(clock))
        .disambiguate(Disambiguation::Earlier)
        .map_err(|_| PremiumError::InvalidInput)
}

fn milliseconds_at(start: i64, minute: i64) -> Result<i64, PremiumError> {
    minute
        .checked_mul(60_000)
        .and_then(|amount| start.checked_add(amount))
        .ok_or(PremiumError::Calculation(EngineError::Overflow))
}
fn zoned_at(milliseconds: i64, zone: &TimeZone) -> Result<Zoned, PremiumError> {
    Timestamp::from_millisecond(milliseconds)
        .map(|stamp| stamp.to_zoned(zone.clone()))
        .map_err(|_| PremiumError::Calculation(EngineError::Overflow))
}
fn rounded_bound(value: &BigDecimal) -> Result<i64, PremiumError> {
    value
        .with_scale_round(0, RoundingMode::Ceiling)
        .to_i64()
        .ok_or(PremiumError::InvalidInput)
}

#[derive(Clone, Copy)]
struct DayContext {
    holiday: bool,
    sunday: bool,
    saturday: bool,
}
struct DayMatch {
    context: DayContext,
    matches: Vec<bool>,
}
struct Matcher<'a> {
    rules: &'a PremiumRules,
    resolver: &'a RuleResolver,
    tariff: Option<TariffProfile>,
    state: &'a str,
    region: &'a str,
    shift_type: &'a str,
    holiday_mode: &'a str,
    holidays: BTreeMap<i16, BTreeSet<String>>,
    days: BTreeMap<String, DayMatch>,
    result: ClassifiedMinutes,
    capture: bool,
}
impl<'a> Matcher<'a> {
    fn new(
        shift: &'a Value,
        profile: &'a Value,
        rules: &'a PremiumRules,
        resolver: &'a RuleResolver,
        capture: bool,
    ) -> Result<Self, PremiumError> {
        let tariff = profile
            .get("tariff")
            .filter(|value| !value.is_null())
            .map(|value| {
                serde_json::from_value(value.clone()).map_err(|_| PremiumError::InvalidInput)
            })
            .transpose()?;
        Ok(Self {
            rules,
            resolver,
            tariff,
            state: string(profile, "federalState")?,
            region: profile
                .get("holidayRegion")
                .and_then(Value::as_str)
                .unwrap_or("NONE"),
            shift_type: string(shift, "type")?,
            holiday_mode: string(shift, "holidayPremiumMode")?,
            holidays: BTreeMap::new(),
            days: BTreeMap::new(),
            result: ClassifiedMinutes::default(),
            capture,
        })
    }
    fn prepare(&mut self, date: Date) -> Result<String, PremiumError> {
        let key = date.to_string();
        if let std::collections::btree_map::Entry::Vacant(day_entry) = self.days.entry(key.clone())
        {
            if let std::collections::btree_map::Entry::Vacant(holiday_entry) =
                self.holidays.entry(date.year())
            {
                let dates = get_public_holidays(
                    i32::from(date.year()),
                    self.state,
                    self.region,
                    self.resolver,
                )?
                .into_iter()
                .map(|day| day.date)
                .collect();
                holiday_entry.insert(dates);
            }
            let holiday = self
                .holidays
                .get(&date.year())
                .is_some_and(|dates| dates.contains(&key));
            let weekday = date.weekday().to_monday_one_offset();
            let matches = self
                .rules
                .premium_rules
                .iter()
                .map(|rule| {
                    conditions_match(
                        &rule.conditions,
                        self.tariff.as_ref(),
                        self.state,
                        &key,
                        Some(ConditionShift {
                            shift_type: self.shift_type,
                            holiday_premium_mode: self.holiday_mode,
                        }),
                        None,
                    )
                })
                .collect();
            day_entry.insert(DayMatch {
                context: DayContext {
                    holiday,
                    sunday: weekday == 7,
                    saturday: weekday == 6,
                },
                matches,
            });
        }
        Ok(key)
    }
    fn count(
        &mut self,
        date: &str,
        minute_of_day: i64,
        milliseconds: i64,
    ) -> Result<(), PremiumError> {
        let day = self.days.get(date).ok_or(PremiumError::InvalidInput)?;
        let candidates = self
            .rules
            .premium_rules
            .iter()
            .enumerate()
            .filter(|(index, rule)| {
                let applies = match rule.premium_type {
                    PremiumType::Night | PremiumType::PreHoliday => true,
                    PremiumType::Sunday => day.context.sunday,
                    PremiumType::Saturday => day.context.saturday,
                    PremiumType::HolidayWithTimeOff | PremiumType::HolidayWithoutTimeOff => {
                        day.context.holiday
                    }
                    PremiumType::Overtime => false,
                };
                let window = rule.time_window.as_ref().is_none_or(|window| {
                    if window.start_minute < window.end_minute {
                        minute_of_day >= window.start_minute && minute_of_day < window.end_minute
                    } else {
                        minute_of_day >= window.start_minute || minute_of_day < window.end_minute
                    }
                });
                applies && window && day.matches[*index]
            })
            .map(|(index, _)| index)
            .collect();
        for index in select_rules(self.rules, candidates)? {
            let id = &self.rules.premium_rules[index].id;
            if let Some(count) = self.result.by_rule_id.get_mut(id) {
                *count = count
                    .checked_add(1)
                    .ok_or(PremiumError::Calculation(EngineError::Overflow))?;
            } else {
                self.result.by_rule_id.insert(id.clone(), 1);
                self.result.rule_order.push(id.clone());
            }
            if self.capture {
                self.result.counted.push(CountedMinute {
                    rule_id: id.clone(),
                    epoch_milliseconds: milliseconds,
                });
            }
        }
        Ok(())
    }
}

fn select_rules(rules: &PremiumRules, candidates: Vec<usize>) -> Result<Vec<usize>, PremiumError> {
    // JavaScript Map replaces duplicate values without changing the first key position.
    let mut selected: Vec<usize> = Vec::new();
    for index in candidates {
        if let Some(position) = selected
            .iter()
            .position(|prior| rules.premium_rules[*prior].id == rules.premium_rules[index].id)
        {
            selected[position] = index;
        } else {
            selected.push(index);
        }
    }
    for combination in &rules.combination_rules {
        let members: Vec<usize> = combination
            .member_rule_ids
            .iter()
            .filter_map(|id| {
                selected
                    .iter()
                    .find(|index| rules.premium_rules[**index].id == *id)
                    .copied()
            })
            .collect();
        if members.len() <= 1 || matches!(combination.mode, CombinationMode::Stack) {
            continue;
        }
        let winner = match combination.mode {
            CombinationMode::Priority => combination
                .priority_rule_ids
                .iter()
                .find_map(|id| {
                    selected
                        .iter()
                        .find(|index| rules.premium_rules[**index].id == *id)
                        .copied()
                })
                .ok_or_else(|| PremiumError::MissingPriorityWinner(combination.id.clone()))?,
            CombinationMode::ExclusiveHighest => members
                .iter()
                .copied()
                .reduce(|left, right| {
                    if rules.premium_rules[left].percentage_basis_points
                        >= rules.premium_rules[right].percentage_basis_points
                    {
                        left
                    } else {
                        right
                    }
                })
                .ok_or(PremiumError::InvalidInput)?,
            CombinationMode::Stack => continue,
        };
        selected.retain(|index| !members.contains(index) || *index == winner);
    }
    Ok(selected)
}

pub fn count_premium_minutes(
    shift: &Value,
    profile: &Value,
    span: &PremiumMinuteSpan,
    rules: &PremiumRules,
    resolver: &RuleResolver,
    interval: Option<&PremiumMinuteInterval>,
) -> Result<ClassifiedMinutes, PremiumError> {
    let default = PremiumMinuteInterval::new(0, span.gross_minutes);
    let interval = interval.unwrap_or(&default);
    if interval.from < 0 || interval.until < interval.from || interval.until > span.gross_minutes {
        return Err(PremiumError::InvalidInterval);
    }
    if span.gross_minutes <= 0 || interval.from == interval.until {
        return Ok(ClassifiedMinutes::default());
    }
    let start = zoned_start(shift, profile)?;
    let start_ms = start.timestamp().as_millisecond();
    let zone = start.time_zone();
    let last = zoned_at(milliseconds_at(start_ms, span.gross_minutes - 1)?, zone)?;
    let crosses_offset = start.offset() != last.offset();
    let break_start = rounded_bound(&span.break_start)?;
    let break_end = rounded_bound(&span.break_end)?;
    let mut matcher = Matcher::new(shift, profile, rules, resolver, interval.capture_minutes)?;
    if crosses_offset {
        for index in interval.from..interval.until {
            if index >= break_start && index < break_end {
                continue;
            }
            let milliseconds = milliseconds_at(start_ms, index)?;
            let cursor = zoned_at(milliseconds, zone)?;
            let date = matcher.prepare(cursor.date())?;
            matcher.count(
                &date,
                i64::from(cursor.hour()) * 60 + i64::from(cursor.minute()),
                milliseconds,
            )?;
        }
    } else {
        let first_minute = i64::from(start.hour()) * 60 + i64::from(start.minute());
        let mut day_offset = first_minute
            .checked_add(interval.from)
            .ok_or(PremiumError::InvalidInput)?
            .div_euclid(1440);
        let initial = start
            .date()
            .checked_add(
                jiff::Span::new()
                    .try_days(day_offset)
                    .map_err(|_| PremiumError::InvalidInput)?,
            )
            .map_err(|_| PremiumError::InvalidInput)?;
        let mut date = matcher.prepare(initial)?;
        for index in interval.from..interval.until {
            if index >= break_start && index < break_end {
                continue;
            }
            let local = first_minute
                .checked_add(index)
                .ok_or(PremiumError::InvalidInput)?;
            let offset = local.div_euclid(1440);
            if offset != day_offset {
                day_offset = offset;
                let next = start
                    .date()
                    .checked_add(
                        jiff::Span::new()
                            .try_days(offset)
                            .map_err(|_| PremiumError::InvalidInput)?,
                    )
                    .map_err(|_| PremiumError::InvalidInput)?;
                date = matcher.prepare(next)?;
            }
            matcher.count(
                &date,
                local.rem_euclid(1440),
                milliseconds_at(start_ms, index)?,
            )?;
        }
    }
    Ok(matcher.result)
}

pub(crate) fn timestamp(milliseconds: i64, zone: &TimeZone) -> Result<String, PremiumError> {
    // Temporal's smallestUnit:"minute" stringification truncates the absolute
    // instant first, then renders the local clock and a minute-rounded UTC offset.
    // Truncating the local clock alone is observably different for historical LMT.
    let truncated = milliseconds
        .div_euclid(60_000)
        .checked_mul(60_000)
        .ok_or(PremiumError::Calculation(EngineError::Overflow))?;
    let time = zoned_at(truncated, zone)?;
    let offset = time.offset().seconds();
    let absolute_minutes = (offset.unsigned_abs() + 30) / 60;
    let sign = if offset < 0 { '-' } else { '+' };
    let suffix = format!(
        "{sign}{:02}:{:02}",
        absolute_minutes / 60,
        absolute_minutes % 60
    );
    Ok(format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}{suffix}",
        time.year(),
        time.month(),
        time.day(),
        time.hour(),
        time.minute()
    ))
}

pub fn premium_minute_trace(
    shift: &Value,
    profile: &Value,
    rules: Option<&PremiumRules>,
    resolver: &RuleResolver,
) -> Result<PremiumMinuteTrace, PremiumError> {
    let span = span_from_shift(shift, profile)?;
    let interval = PremiumMinuteInterval::new(0, span.gross_minutes).with_capture();
    let tariff = profile.get("tariff").ok_or(PremiumError::InvalidInput)?;
    let active_rules =
        rules.filter(|_| super::pattern::is_pay_work_shift(shift) && !tariff.is_null());
    let classified = if let Some(rules) = active_rules {
        count_premium_minutes(shift, profile, &span, rules, resolver, Some(&interval))?
    } else {
        ClassifiedMinutes::default()
    };
    let start = zoned_start(shift, profile)?;
    let start_ms = start.timestamp().as_millisecond();
    let zone = start.time_zone();
    // Temporal validates the raw capped duration, even if adding a tiny fraction to
    // the centered boundary rounded it away in the minute-classification loop.
    let source_pause = shift["breakMinutes"]
        .as_f64()
        .filter(|pause| pause.is_finite())
        .ok_or(PremiumError::InvalidInput)?
        .min(span.gross_minutes as f64);
    let pause = decimal(&json!(source_pause))?;
    let pause_minutes = pause
        .to_i64()
        .filter(|integer| pause == *integer)
        .ok_or(PremiumError::InvalidInput)?;
    let pause_from = span
        .break_start
        .to_i64()
        .ok_or(PremiumError::InvalidInput)?;
    let mut by_id: BTreeMap<String, Vec<(i64, i64)>> = BTreeMap::new();
    for minute in &classified.counted {
        let milliseconds = minute.epoch_milliseconds;
        let end = milliseconds
            .checked_add(60_000)
            .ok_or(PremiumError::Calculation(EngineError::Overflow))?;
        let periods = by_id.entry(minute.rule_id.clone()).or_default();
        if let Some(last) = periods.last_mut().filter(|period| period.1 == milliseconds) {
            last.1 = end;
        } else {
            periods.push((milliseconds, end));
        }
    }
    let mut premiums = Vec::new();
    for rule in rules.into_iter().flat_map(|rules| &rules.premium_rules) {
        let Some(periods) = by_id.get(&rule.id) else {
            continue;
        };
        if matches!(rule.premium_type, PremiumType::Overtime) {
            continue;
        }
        let periods = periods
            .iter()
            .map(|(from, until)| {
                Ok(TimeRange {
                    start: timestamp(*from, zone)?,
                    end: timestamp(*until, zone)?,
                })
            })
            .collect::<Result<Vec<_>, PremiumError>>()?;
        premiums.push(MinuteTraceItem {
            rule_id: rule.id.clone(),
            premium_type: rule.premium_type.name().to_owned(),
            minutes: *classified
                .by_rule_id
                .get(&rule.id)
                .ok_or(PremiumError::InvalidInput)?,
            periods,
        });
    }
    let unpaid_breaks = if pause_minutes != 0 {
        vec![TimeRange {
            start: timestamp(milliseconds_at(start_ms, pause_from)?, zone)?,
            end: timestamp(
                milliseconds_at(
                    start_ms,
                    pause_from
                        .checked_add(pause_minutes)
                        .ok_or(PremiumError::InvalidInput)?,
                )?,
                zone,
            )?,
        }]
    } else {
        Vec::new()
    };
    Ok(PremiumMinuteTrace {
        start: timestamp(start_ms, zone)?,
        end: timestamp(milliseconds_at(start_ms, span.gross_minutes)?, zone)?,
        unpaid_breaks,
        premiums,
        classified: active_rules.map(|_| classified),
    })
}
