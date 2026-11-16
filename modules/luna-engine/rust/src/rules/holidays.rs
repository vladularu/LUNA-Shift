//! Existing catalog-based German holiday computation; no network or rate updates.
use super::{RulePackage, RuleResolutionFailure, RuleResolver};
use crate::calendar::{month_range, parse_date};
use jiff::civil::Date;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

pub(super) type HolidayCache = BTreeMap<(i32, String, String), Arc<HolidayCalendar>>;
const MAX_CACHED_CALENDARS: usize = 128;
#[derive(Debug)]
pub struct HolidayCalendar {
    entries: Vec<PublicHoliday>,
    dates: BTreeSet<String>,
}
impl HolidayCalendar {
    pub fn entries(&self) -> &[PublicHoliday] {
        &self.entries
    }
    pub fn contains(&self, date: &str) -> bool {
        self.dates.contains(date)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PublicHoliday {
    pub date: String,
    pub name: String,
    pub scope: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HolidayError {
    Resolution(Box<RuleResolutionFailure>),
    InvalidDate,
    InvalidRule,
    InvalidCollation,
}
impl From<RuleResolutionFailure> for HolidayError {
    fn from(e: RuleResolutionFailure) -> Self {
        Self::Resolution(Box::new(e))
    }
}
impl std::fmt::Display for HolidayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Resolution(e) => e.fmt(f),
            Self::InvalidDate => f.write_str("Invalid holiday date"),
            Self::InvalidRule => f.write_str("Invalid holiday rule"),
            Self::InvalidCollation => f.write_str("Missing holiday collation"),
        }
    }
}
impl std::error::Error for HolidayError {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HolidayRule {
    name: String,
    scope: String,
    valid_from: String,
    valid_to: Option<String>,
    federal_states: Option<Vec<String>>,
    region_ids: Option<Vec<String>>,
    calculation: Calculation,
}
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
enum Calculation {
    #[serde(rename_all = "camelCase")]
    FixedDate {
        month: i8,
        day: i8,
    },
    #[serde(rename_all = "camelCase")]
    EasterOffset {
        offset_days: i32,
    },
    RepentanceDay,
    SpecificDate {
        date: String,
    },
}

fn date(year: i32, month: i8, day: i8) -> Result<Date, HolidayError> {
    Date::new(
        i16::try_from(year).map_err(|_| HolidayError::InvalidDate)?,
        month,
        day,
    )
    .map_err(|_| HolidayError::InvalidDate)
}
fn add_days(value: Date, days: i32) -> Result<Date, HolidayError> {
    value
        .checked_add(jiff::Span::new().days(days))
        .map_err(|_| HolidayError::InvalidDate)
}

pub fn easter_sunday(year: i32) -> Result<String, HolidayError> {
    // Keep the source's Gregorian computus and operation boundaries.
    if !(0..=9999).contains(&year) {
        return Err(HolidayError::InvalidDate);
    }
    let a = year % 19;
    let b = year / 100;
    let c = year % 100;
    let d = b / 4;
    let e = b % 4;
    let f = (b + 8) / 25;
    let g = (b - f + 1) / 3;
    let h = (19 * a + b - d - g + 15) % 30;
    let i = c / 4;
    let k = c % 4;
    let l = (32 + 2 * e + 2 * i - h - k) % 7;
    let m = (a + 11 * h + 22 * l) / 451;
    let month = (h + l - 7 * m + 114) / 31;
    let day = ((h + l - 7 * m + 114) % 31) + 1;
    Ok(date(year, month as i8, day as i8)?.to_string())
}

fn holiday_date(rule: &HolidayRule, year: i32) -> Result<String, HolidayError> {
    Ok(match &rule.calculation {
        Calculation::FixedDate { month, day } => date(year, *month, *day)?.to_string(),
        Calculation::EasterOffset { offset_days } => add_days(
            parse_date(&easter_sunday(year)?).map_err(|_| HolidayError::InvalidDate)?,
            *offset_days,
        )?
        .to_string(),
        Calculation::RepentanceDay => {
            let day = date(year, 11, 23)?;
            let weekday = i32::from(day.weekday().to_monday_one_offset());
            let back = if weekday > 3 {
                weekday - 3
            } else {
                weekday + 4
            };
            add_days(day, -back)?.to_string()
        }
        Calculation::SpecificDate { date } => date.clone(),
    })
}

fn packages_for_year(
    year: i32,
    resolver: &RuleResolver,
) -> Result<Vec<&RulePackage>, HolidayError> {
    let mut cursor = date(year, 1, 1)?;
    let end = date(year, 12, 31)?;
    let mut packages: Vec<&RulePackage> = Vec::new();
    // Each package must advance at least one day. The catalog has at most 10k
    // packages and the report year at most 366 days; malformed ranges cannot loop.
    while cursor <= end {
        let package = resolver.resolve_holiday(&cursor.to_string())?;
        if !packages.iter().any(|p| std::ptr::eq(*p, package)) {
            packages.push(package);
        }
        let Some(ref until) = package.valid_to else {
            break;
        };
        let until = parse_date(until).map_err(|_| HolidayError::InvalidDate)?;
        if until >= end {
            break;
        }
        if until < cursor {
            return Err(HolidayError::InvalidRule);
        }
        cursor = add_days(until, 1)?;
    }
    Ok(packages)
}

fn active_for_state(rule: &HolidayRule, date: &str, state: &str, region: &str) -> bool {
    let region = match region {
        "BY_MARIA_HIMMELFAHRT" => Some("by.maria-himmelfahrt"),
        "BY_AUGSBURG" => Some("by.augsburg"),
        "SN_FRONLEICHNAM" => Some("sn.fronleichnam"),
        "TH_FRONLEICHNAM" => Some("th.fronleichnam"),
        _ => None,
    };
    rule.valid_from.as_str() <= date
        && rule.valid_to.as_deref().is_none_or(|until| date <= until)
        && (rule.scope == "NATIONWIDE"
            || rule
                .federal_states
                .as_ref()
                .is_some_and(|states| states.iter().any(|s| s == state))
                && (rule.scope == "STATEWIDE"
                    || region.is_some_and(|id| {
                        rule.region_ids
                            .as_ref()
                            .is_some_and(|regions| regions.iter().any(|r| r == id))
                    })))
}

fn compute_public_holidays(
    year: i32,
    state: &str,
    region: &str,
    resolver: &RuleResolver,
) -> Result<Vec<PublicHoliday>, HolidayError> {
    let mut result = Vec::new();
    for package in packages_for_year(year, resolver)? {
        let rules: Vec<HolidayRule> = serde_json::from_value(
            package
                .rules()
                .get("holidays")
                .cloned()
                .ok_or(HolidayError::InvalidRule)?,
        )
        .map_err(|_| HolidayError::InvalidRule)?;
        for rule in rules {
            let date = holiday_date(&rule, year)?;
            if !date.starts_with(&format!("{year}-"))
                || !active_for_state(&rule, &date, state, region)
            {
                continue;
            }
            let active = resolver.resolve_holiday(&date)?;
            if active.package_id != package.package_id || active.version_id != package.version_id {
                continue;
            }
            result.push(PublicHoliday {
                date,
                name: rule.name,
                scope: rule.scope,
            });
        }
    }
    // Locale comparison is required only for equal dates with differing names.
    // Validated host ranks retain the existing locale equality classes without
    // calling JS from a native sort comparator or silently assuming byte order.
    for a in &result {
        for b in &result {
            if a.date == b.date
                && a.name != b.name
                && (!resolver.collation_ranks.contains_key(&a.name)
                    || !resolver.collation_ranks.contains_key(&b.name))
            {
                return Err(HolidayError::InvalidCollation);
            }
        }
    }
    result.sort_by(|a, b| {
        a.date
            .cmp(&b.date)
            .then_with(|| {
                if a.name == b.name {
                    std::cmp::Ordering::Equal
                } else {
                    resolver
                        .collation_ranks
                        .get(&a.name)
                        .cmp(&resolver.collation_ranks.get(&b.name))
                }
            })
            .then_with(|| a.scope.cmp(&b.scope))
    });
    Ok(result)
}

/// Reused by the immutable snapshot/resolver, never keyed by process-global
/// pointers. The short mutex guards only bounded lookup/insertion, not work.
pub fn holiday_calendar(
    year: i32,
    state: &str,
    region: &str,
    resolver: &RuleResolver,
) -> Result<Arc<HolidayCalendar>, HolidayError> {
    let key = (year, state.to_owned(), region.to_owned());
    if let Some(calendar) = resolver
        .holiday_cache
        .lock()
        .map_err(|_| HolidayError::InvalidRule)?
        .get(&key)
        .cloned()
    {
        return Ok(calendar);
    }
    let entries = compute_public_holidays(year, state, region, resolver)?;
    let dates = entries.iter().map(|h| h.date.clone()).collect();
    let calendar = Arc::new(HolidayCalendar { entries, dates });
    let mut cache = resolver
        .holiday_cache
        .lock()
        .map_err(|_| HolidayError::InvalidRule)?;
    if let Some(existing) = cache.get(&key) {
        return Ok(Arc::clone(existing));
    }
    if cache.len() >= MAX_CACHED_CALENDARS {
        cache.pop_first();
    }
    cache.insert(key, Arc::clone(&calendar));
    Ok(calendar)
}

pub fn get_public_holidays(
    year: i32,
    state: &str,
    region: &str,
    resolver: &RuleResolver,
) -> Result<Vec<PublicHoliday>, HolidayError> {
    Ok(holiday_calendar(year, state, region, resolver)?
        .entries()
        .to_vec())
}

pub fn holiday_map_for_month(
    month: &str,
    state: &str,
    region: &str,
    resolver: &RuleResolver,
) -> Result<BTreeMap<String, PublicHoliday>, HolidayError> {
    month_range(month).map_err(|_| HolidayError::InvalidDate)?;
    let year = month[..4]
        .parse::<i32>()
        .map_err(|_| HolidayError::InvalidDate)?;
    Ok(holiday_calendar(year, state, region, resolver)?
        .entries()
        .iter()
        .filter(|h| h.date.starts_with(&format!("{month}-")))
        .map(|h| (h.date.clone(), h.clone()))
        .collect())
}

#[derive(Debug, Clone, Serialize)]
pub struct HolidayMonthResolution {
    pub status: &'static str,
    pub holidays: BTreeMap<String, PublicHoliday>,
    pub failure: Option<RuleResolutionFailure>,
}

pub fn resolve_holiday_map_for_month(
    month: &str,
    state: &str,
    region: &str,
    resolver: &RuleResolver,
) -> Result<HolidayMonthResolution, HolidayError> {
    match holiday_map_for_month(month, state, region, resolver) {
        Ok(holidays) => Ok(HolidayMonthResolution {
            status: "AVAILABLE",
            holidays,
            failure: None,
        }),
        Err(HolidayError::Resolution(failure)) => Ok(HolidayMonthResolution {
            status: "UNAVAILABLE",
            holidays: BTreeMap::new(),
            failure: Some(*failure),
        }),
        Err(error) => Err(error),
    }
}

pub fn resolve_holiday_map_for_months(
    months: &[String],
    state: &str,
    region: &str,
    resolver: &RuleResolver,
) -> Result<HolidayMonthResolution, HolidayError> {
    let mut resolution = HolidayMonthResolution {
        status: "AVAILABLE",
        holidays: BTreeMap::new(),
        failure: None,
    };
    let mut seen = BTreeSet::new();
    for month in months {
        if !seen.insert(month) {
            continue;
        }
        let next = resolve_holiday_map_for_month(month, state, region, resolver)?;
        resolution.holidays.extend(next.holidays);
        if resolution.failure.is_none() {
            resolution.failure = next.failure;
        }
    }
    if resolution.failure.is_some() {
        resolution.status = "UNAVAILABLE";
    }
    Ok(resolution)
}
