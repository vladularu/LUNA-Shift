//! Portable calculation engine. No React, SQLite, network, or device state.
pub mod calendar;
pub mod compliance;
pub mod contract;
pub mod credit;
pub mod employment;
pub mod ffi;
pub mod input;
pub mod money;
pub mod net;
pub mod pay;
pub mod remuneration;
pub mod report;
pub mod rules;
pub mod runtime;
pub mod target;
pub mod tax;
#[cfg(test)]
#[path = "../tests/support/value_pool.rs"]
pub(crate) mod test_value_pool;
pub mod time;
pub mod time_zone;
pub mod training;
pub mod wasm_transport;

use serde::Serialize;
use std::fmt;

pub const SCHEMA_VERSION: u32 = 1;
include!(concat!(env!("OUT_DIR"), "/engine_identity.rs"));

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EngineError {
    InvalidDate,
    InvalidTime,
    InvalidTimeZone,
    AmbiguousDutyTime,
    InvalidMoney,
    InvalidDuration,
    InvalidRecurrence,
    InvalidCalendarEntry,
    InvalidCollation,
    Overflow,
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidDate => "Invalid date",
            Self::InvalidTime => "Invalid time",
            Self::InvalidTimeZone => "Invalid time zone",
            Self::AmbiguousDutyTime => "Ambiguous special-duty time",
            Self::InvalidMoney => "Invalid calculation basis",
            Self::InvalidDuration => "Invalid duration",
            Self::InvalidRecurrence => "Invalid recurrence",
            Self::InvalidCalendarEntry => "Invalid calendar entry",
            Self::InvalidCollation => "Invalid collation",
            Self::Overflow => "Calculation range exceeded",
        })
    }
}

impl std::error::Error for EngineError {}
