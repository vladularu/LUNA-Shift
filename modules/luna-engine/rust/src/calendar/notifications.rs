//! Notification business intent only. Platform permission, generation, scheduling,
//! cancellation and schedule persistence remain separate I/O lifecycle boundaries.
use super::{
    parse_date,
    recurrence::{AppointmentStep, appointment_dates},
};
use crate::{
    EngineError,
    time::{ShiftTime, clock, shift_bounds},
};
use jiff::{
    Timestamp, ToSpan,
    civil::{Date, Time},
    tz::TimeZone,
};
use serde::Deserialize;
use serde_json::{Value, json};
pub mod command;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum Unit {
    Minute,
    Hour,
    Day,
    Week,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum Direction {
    Before,
    After,
}
#[derive(Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum Reference {
    Start,
    End,
}
#[derive(Clone, Copy, Deserialize)]
struct Rule {
    #[serde(deserialize_with = "super::recurrence::deserialize_integral_number")]
    amount: i64,
    unit: Unit,
    direction: Direction,
    reference: Reference,
}
impl Rule {
    fn offset(self) -> Result<i64, EngineError> {
        let multiplier = match self.unit {
            Unit::Minute => 1,
            Unit::Hour => 60,
            Unit::Day => 1440,
            Unit::Week => 10080,
        };
        self.amount
            .checked_mul(multiplier)
            .and_then(|n| {
                n.checked_mul(if matches!(self.direction, Direction::Before) {
                    -1
                } else {
                    1
                })
            })
            .ok_or(EngineError::Overflow)
    }
}
#[derive(Clone, Copy)]
struct Spec {
    alarm: bool,
    rule: Rule,
}

/// Borrows a native CalendarEntry snapshot. It neither owns nor authorizes the
/// selected application source. Permission is requested before `plan`, as before.
pub struct NotificationSource<'a> {
    entry: &'a Value,
    shift: bool,
    all_day: bool,
    start: Option<&'a str>,
    end: Option<&'a str>,
    specs: Vec<Spec>,
    deleted: bool,
}
pub struct NotificationCursor<'a> {
    source: &'a NotificationSource<'a>,
    zone_name: &'a str,
    zone: TimeZone,
    dates: Vec<Date>,
    date_at: usize,
    spec_at: usize,
}
pub struct NotificationCandidate {
    occurrence_date: String,
    epoch_milliseconds: i64,
    alarm: bool,
    body: &'static str,
}
/// One candidate per step. The platform must read its clock again after each OS
/// await, and must keep its current-generation guards around every I/O operation.
pub enum NotificationStep {
    Finished,
    Skipped,
    Schedule(NotificationCandidate),
}

fn optional_time<'a>(entry: &'a Value, key: &str) -> Result<Option<&'a str>, EngineError> {
    match entry.get(key) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => {
            clock(s)?;
            Ok(Some(s))
        }
        _ => Err(EngineError::InvalidCalendarEntry),
    }
}
impl<'a> NotificationSource<'a> {
    pub fn from_entry(entry: &'a Value) -> Result<Self, EngineError> {
        let shift = match entry["kind"].as_str() {
            Some("SHIFT") => true,
            Some("APPOINTMENT") => false,
            _ => return Err(EngineError::InvalidCalendarEntry),
        };
        // Original legacy entries may omit allDay; that remains a timed entry.
        let all_day = match entry.get("allDay") {
            None => false,
            Some(value) => value.as_bool().ok_or(EngineError::InvalidCalendarEntry)?,
        };
        let start = optional_time(entry, "startTime")?;
        let end = optional_time(entry, "endTime")?;
        parse_date(
            entry["date"]
                .as_str()
                .ok_or(EngineError::InvalidCalendarEntry)?,
        )?;
        let notification = entry
            .get("notification")
            .filter(|v| !v.is_null())
            .map(|v| {
                serde_json::from_value::<Rule>(v.clone())
                    .map_err(|_| EngineError::InvalidCalendarEntry)
            })
            .transpose()?;
        let mut specs = Vec::with_capacity(2);
        if let Some(rule) = notification {
            if rule.amount < 0 {
                return Err(EngineError::InvalidCalendarEntry);
            }
            rule.offset()?;
            specs.push(Spec { alarm: false, rule });
        }
        if shift && entry["alarmEnabled"] == true && start.is_some() {
            if notification.is_some_and(|r| r.amount == 0 && r.reference == Reference::Start) {
                specs.clear()
            }
            specs.push(Spec {
                alarm: true,
                rule: Rule {
                    amount: 0,
                    unit: Unit::Minute,
                    direction: Direction::Before,
                    reference: Reference::Start,
                },
            });
        }
        Ok(Self {
            entry,
            shift,
            all_day,
            start,
            end,
            specs,
            deleted: !entry["deletedAt"].is_null(),
        })
    }
    pub fn needs_permission(&self) -> bool {
        !self.deleted && !self.specs.is_empty()
    }
    fn overnight(&self) -> bool {
        !self.all_day && self.start.zip(self.end).is_some_and(|(s, e)| e <= s)
    }
    fn instant(
        &self,
        date: Date,
        spec: Spec,
        zone_name: &str,
        zone: &TimeZone,
    ) -> Result<i64, EngineError> {
        let offset = spec
            .rule
            .offset()?
            .checked_mul(60000)
            .ok_or(EngineError::Overflow)?;
        let reference = if spec.rule.reference == Reference::End && self.overnight() {
            let shift = ShiftTime {
                date: date.to_string(),
                start_time: self.start.map(str::to_owned),
                end_time: self.end.map(str::to_owned),
                break_minutes: 0,
                all_day: self.all_day,
                special_duty: None,
            };
            shift_bounds(&shift, zone_name)?
                .ok_or(EngineError::InvalidTime)?
                .end_epoch_minutes
                .checked_mul(60000)
                .ok_or(EngineError::Overflow)?
        } else {
            let time = if self.all_day {
                Time::midnight()
            } else {
                clock(if spec.rule.reference == Reference::End {
                    self.end.or(self.start).unwrap_or("00:00")
                } else {
                    self.start.unwrap_or("00:00")
                })?
            };
            zone.to_ambiguous_zoned(date.to_datetime(time))
                .compatible()
                .map_err(|_| EngineError::InvalidTime)?
                .timestamp()
                .as_millisecond()
        };
        reference.checked_add(offset).ok_or(EngineError::Overflow)
    }
    pub fn plan(
        &'a self,
        zone_name: &'a str,
        epoch: i64,
    ) -> Result<NotificationCursor<'a>, EngineError> {
        crate::contract::RawClockContext::from_epoch_milliseconds(epoch)
            .map_err(|_| EngineError::InvalidDate)?;
        let zone = crate::time_zone::zone(zone_name)?;
        let today = Timestamp::from_millisecond(epoch)
            .map_err(|_| EngineError::InvalidDate)?
            .to_zoned(zone.clone())
            .date();
        let yesterday = today
            .checked_sub(1.days())
            .map_err(|_| EngineError::InvalidDate)?;
        let mut start = today;
        if self.overnight() {
            for spec in &self.specs {
                if self.instant(yesterday, *spec, zone_name, &zone)? > epoch {
                    start = yesterday;
                    break;
                }
            }
        }
        let end = today
            .checked_add(2.years())
            .map_err(|_| EngineError::InvalidDate)?;
        let mut dates = Vec::new();
        if self.needs_permission() {
            if self.shift {
                let date = parse_date(
                    self.entry["date"]
                        .as_str()
                        .ok_or(EngineError::InvalidCalendarEntry)?,
                )?;
                // Original SHIFT branch has no appointment-horizon upper bound.
                if date >= start {
                    dates.push(date)
                }
            } else {
                for step in appointment_dates(self.entry, &start.to_string(), &end.to_string())? {
                    if let AppointmentStep::Occurrence(date) = step? {
                        dates.push(
                            date.unwrap_or(parse_date(
                                self.entry["date"]
                                    .as_str()
                                    .ok_or(EngineError::InvalidCalendarEntry)?,
                            )?),
                        );
                        if dates.len() == 48 {
                            break;
                        }
                    }
                }
            }
        }
        Ok(NotificationCursor {
            source: self,
            zone_name,
            zone,
            dates,
            date_at: 0,
            spec_at: 0,
        })
    }
}
impl NotificationCursor<'_> {
    pub fn step(&mut self, epoch: i64) -> Result<NotificationStep, EngineError> {
        let Some(&date) = self.dates.get(self.date_at) else {
            return Ok(NotificationStep::Finished);
        };
        crate::contract::RawClockContext::from_epoch_milliseconds(epoch)
            .map_err(|_| EngineError::InvalidDate)?;
        let spec = *self
            .source
            .specs
            .get(self.spec_at)
            .ok_or(EngineError::InvalidCalendarEntry)?;
        let instant = self
            .source
            .instant(date, spec, self.zone_name, &self.zone)?;
        self.spec_at += 1;
        if self.spec_at == self.source.specs.len() {
            self.spec_at = 0;
            self.date_at += 1
        }
        if instant <= epoch {
            return Ok(NotificationStep::Skipped);
        }
        let body = match (self.source.all_day, self.source.shift, spec.rule.reference) {
            (true, true, _) => "Erinnerung: Dienst",
            (true, false, _) => "Erinnerung: Termin",
            (false, true, Reference::End) => "Erinnerung: Dienstende",
            (false, true, Reference::Start) => "Erinnerung: Dienstbeginn",
            (false, false, Reference::End) => "Erinnerung: Terminende",
            (false, false, Reference::Start) => "Erinnerung: Terminbeginn",
        };
        Ok(NotificationStep::Schedule(NotificationCandidate {
            occurrence_date: date.to_string(),
            epoch_milliseconds: instant,
            alarm: spec.alarm,
            body,
        }))
    }
}
impl NotificationCandidate {
    pub fn epoch_milliseconds(&self) -> i64 {
        self.epoch_milliseconds
    }
    pub fn occurrence_date(&self) -> &str {
        &self.occurrence_date
    }
    pub fn is_alarm(&self) -> bool {
        self.alarm
    }
    pub fn content(&self) -> Value {
        let mut content = json!({"title":"LUNA Shift","body":self.body,
            "data":{"reminderKind":if self.alarm {"ALARM"}else{"NOTIFICATION"}}});
        if self.alarm {
            content["sound"] = json!("default")
        }
        content
    }
}
