//! Temporal 0.5.1 timezone identifiers, including fully validated ISO references.
//! Never use Jiff's unrestricted POSIX parser for a Temporal timezone string.
use crate::EngineError;
use jiff::tz::TimeZone;
use std::{
    collections::BTreeMap,
    sync::{Mutex, OnceLock},
};
const INVALID: EngineError = EngineError::InvalidTimeZone;
const MAX_CACHED_ZONES: usize = 1024;
static ZONES: OnceLock<Mutex<BTreeMap<&'static str, TimeZone>>> = OnceLock::new();
/// This identity is part of the calculation/cache contract, not inferred from the host OS.
pub fn tzdb_version() -> Option<&'static str> {
    source_tzdb::VERSION
}

fn offset_parts(name: &str) -> Option<i32> {
    let b = name.as_bytes();
    if !matches!(b.first(), Some(b'+' | b'-')) {
        return None;
    }
    let (hours, minutes) = match b.len() {
        3 if b[1..].iter().all(u8::is_ascii_digit) => (&name[1..3], "00"),
        5 if b[1..].iter().all(u8::is_ascii_digit) => (&name[1..3], &name[3..5]),
        6 if b[3] == b':' && b[1..3].iter().chain(&b[4..6]).all(u8::is_ascii_digit) => {
            (&name[1..3], &name[4..6])
        }
        _ => return None,
    };
    let hours = hours.parse::<i32>().ok()?;
    let minutes = minutes.parse::<i32>().ok()?;
    if hours > 23 || minutes > 59 {
        return None;
    }
    Some((hours * 3600 + minutes * 60) * if b[0] == b'-' { -1 } else { 1 })
}
fn named_syntax(name: &str) -> bool {
    !name.is_empty()
        && name.split('/').all(|component| {
            let mut bytes = component.bytes();
            bytes
                .next()
                .is_some_and(|b| b.is_ascii_alphabetic() || b"._".contains(&b))
                && bytes.all(|b| b.is_ascii_alphanumeric() || b"._+-".contains(&b))
        })
}
fn identifier_syntax(name: &str) -> bool {
    offset_parts(name).is_some() || named_syntax(name)
}
fn basic_zone(name: &str) -> Result<TimeZone, EngineError> {
    if name.is_empty() || name.len() > 100 {
        return Err(INVALID);
    }
    if matches!(name.as_bytes()[0], b'+' | b'-') {
        let seconds = offset_parts(name).ok_or(INVALID)?;
        return jiff::tz::Offset::from_seconds(seconds)
            .map(TimeZone::fixed)
            .map_err(|_| INVALID);
    }
    if !named_syntax(name) {
        return Err(INVALID);
    }
    let (canonical, data) = source_tzdb::get(name).ok_or(INVALID)?;
    // TZDB ships this internal placeholder, but the frozen Temporal/Intl
    // implementation rejects it as a time-zone identifier (including aliases).
    if canonical == "Factory" {
        return Err(INVALID);
    }
    let cache = ZONES.get_or_init(Default::default);
    if let Some(zone) = cache
        .lock()
        .ok()
        .and_then(|zones| zones.get(canonical).cloned())
    {
        return Ok(zone);
    }
    // Parse outside the lock. Only the immutable source-compatible whole database is used.
    let zone = TimeZone::tzif(canonical, data).map_err(|_| INVALID)?;
    if let Ok(mut zones) = cache.lock()
        && zones.len() < MAX_CACHED_ZONES
    {
        zones.entry(canonical).or_insert_with(|| zone.clone());
    }
    Ok(zone)
}
pub fn zone(name: &str) -> Result<TimeZone, EngineError> {
    if identifier_syntax(name) {
        basic_zone(name)
    } else {
        basic_zone(iso_identifier(name)?)
    }
}
/// The borrowed arithmetic identifier; the original persisted string remains unchanged.
pub fn identifier(name: &str) -> Result<&str, EngineError> {
    let id = if identifier_syntax(name) {
        name
    } else {
        iso_identifier(name)?
    };
    basic_zone(id)?;
    Ok(id)
}

struct Cursor<'a> {
    raw: &'a str,
    at: usize,
}
impl<'a> Cursor<'a> {
    fn byte(&self) -> Option<u8> {
        self.raw.as_bytes().get(self.at).copied()
    }
    fn take(&mut self, b: u8) -> bool {
        if self.byte() == Some(b) {
            self.at += 1;
            true
        } else {
            false
        }
    }
    fn digits(&mut self, count: usize) -> Option<i32> {
        let end = self.at.checked_add(count)?;
        let bytes = self.raw.as_bytes().get(self.at..end)?;
        if !bytes.iter().all(u8::is_ascii_digit) {
            return None;
        }
        self.at = end;
        Some(bytes.iter().fold(0, |n, b| n * 10 + i32::from(b - b'0')))
    }
    fn fraction(&mut self) -> Result<(), EngineError> {
        if matches!(self.byte(), Some(b'.' | b',')) {
            self.at += 1;
            let start = self.at;
            while self.byte().is_some_and(|b| b.is_ascii_digit()) {
                self.at += 1;
            }
            if !(1..=9).contains(&(self.at - start)) {
                return Err(INVALID);
            }
        }
        Ok(())
    }
    fn annotation(&mut self) -> Result<&'a str, EngineError> {
        if !self.take(b'[') {
            return Err(INVALID);
        }
        let remainder = self.raw.get(self.at..).ok_or(INVALID)?;
        let end = remainder.find(']').ok_or(INVALID)?;
        let annotation = &remainder[..end];
        self.at += end + 1;
        Ok(annotation)
    }
}
fn javascript_space(c: char) -> bool {
    matches!(c,'\u{0009}'..='\u{000d}'|'\u{0020}'|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}')
}
fn valid_annotation(key: &str, value: &str) -> bool {
    let mut bytes = key.bytes();
    bytes
        .next()
        .is_some_and(|b| b.is_ascii_lowercase() || b == b'_')
        && bytes.all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"_-".contains(&b))
        && !value.is_empty()
        && value
            .split('-')
            .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_alphanumeric()))
}
fn iso_identifier(raw: &str) -> Result<&str, EngineError> {
    let mut c = Cursor { raw, at: 0 };
    let negative = c.take(b'-');
    let positive = if negative { false } else { c.take(b'+') };
    let year = c
        .digits(if negative || positive { 6 } else { 4 })
        .ok_or(INVALID)?
        * if negative { -1 } else { 1 };
    if negative && year == 0 {
        return Err(INVALID);
    }
    let dashed = c.take(b'-');
    let month = c.digits(2).ok_or(INVALID)?;
    if dashed && !c.take(b'-') {
        return Err(INVALID);
    }
    let day = c.digits(2).ok_or(INVALID)?;
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        _ => return Err(INVALID),
    };
    if day < 1 || day > max_day {
        return Err(INVALID);
    }
    let mut has_time = c.take(b'T') || c.take(b't');
    if !has_time {
        let start = c.at;
        while let Some(ch) = raw
            .get(c.at..)
            .and_then(|s| s.chars().next())
            .filter(|ch| javascript_space(*ch))
        {
            c.at += ch.len_utf8();
        }
        has_time = c.at > start;
    }
    let (mut z, mut offset) = (false, None);
    if has_time {
        let hour = c.digits(2).ok_or(INVALID)?;
        let mut minute = 0;
        let mut second = 0;
        let mut has_second = false;
        if c.take(b':') {
            minute = c.digits(2).ok_or(INVALID)?;
            if c.take(b':') {
                second = c.digits(2).ok_or(INVALID)?;
                has_second = true;
            }
        } else if c.byte().is_some_and(|b| b.is_ascii_digit()) {
            minute = c.digits(2).ok_or(INVALID)?;
            if c.byte().is_some_and(|b| b.is_ascii_digit()) {
                second = c.digits(2).ok_or(INVALID)?;
                has_second = true;
            }
        }
        if hour > 23 || minute > 59 || second > 60 {
            return Err(INVALID);
        }
        if has_second {
            c.fraction()?;
        }
        if c.take(b'Z') || c.take(b'z') {
            z = true;
        } else if matches!(c.byte(), Some(b'+' | b'-')) {
            let start = c.at;
            c.at += 1;
            let h = c.digits(2).ok_or(INVALID)?;
            let mut m = 0;
            let mut s = 0;
            let mut has_seconds = false;
            if c.take(b':') || c.byte().is_some_and(|b| b.is_ascii_digit()) {
                m = c.digits(2).ok_or(INVALID)?;
                if c.take(b':') || c.byte().is_some_and(|b| b.is_ascii_digit()) {
                    s = c.digits(2).ok_or(INVALID)?;
                    has_seconds = true;
                    c.fraction()?;
                }
            }
            if h > 23 || m > 59 || s > 59 {
                return Err(INVALID);
            }
            offset = Some((&raw[start..c.at], has_seconds));
        }
    }
    let mut named = None;
    let mut generic_started = false;
    let mut calendar_seen = false;
    let mut calendar_critical = false;
    while c.byte() == Some(b'[') {
        let annotation = c.annotation()?;
        let critical = annotation.starts_with('!');
        let annotation = annotation.strip_prefix('!').unwrap_or(annotation);
        if let Some((key, value)) = annotation.split_once('=') {
            generic_started = true;
            if !valid_annotation(key, value) {
                return Err(INVALID);
            }
            if key == "u-ca" {
                if calendar_seen && (critical || calendar_critical) {
                    return Err(INVALID);
                }
                if !calendar_seen {
                    calendar_seen = true;
                    calendar_critical = critical;
                }
            } else if critical {
                return Err(INVALID);
            }
        } else {
            if generic_started || named.is_some() || !identifier_syntax(annotation) {
                return Err(INVALID);
            }
            named = Some(annotation);
        }
    }
    if c.at != raw.len() {
        return Err(INVALID);
    }
    if let Some(named) = named {
        return Ok(named);
    }
    if z {
        return Ok("UTC");
    }
    match offset {
        Some((offset, false)) => Ok(offset),
        _ => Err(INVALID),
    }
}
