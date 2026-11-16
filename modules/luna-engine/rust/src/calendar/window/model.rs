use crate::{
    EngineError,
    calendar::{self, parse_date},
};
use serde::{Deserialize, Serialize};
use std::fmt;
pub(super) const MAX_SOURCE_ROWS: usize = 100_000;
pub(super) const MAX_PROJECTED_ROWS: usize = 100_000;
pub(super) const MAX_CANDIDATES: usize = 100_000;
pub(super) const MAX_CANDIDATE_BYTES: usize = 16 * 1024 * 1024;
pub(super) const MAX_STEPS: u64 = 20_000_000;
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum WindowSpec {
    Months { months: Vec<String> },
    CalendarYear { year: String },
    PrototypeYear { year: String },
    Day { date: String },
}
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowOptions {
    pub show_appointments: bool,
    pub show_shifts: bool,
}
#[derive(Debug, Clone, PartialEq)]
pub enum WindowError {
    InvalidQuery,
    ResourceLimit,
    Cancelled,
    Engine(EngineError),
}
impl From<EngineError> for WindowError {
    fn from(value: EngineError) -> Self {
        Self::Engine(value)
    }
}
impl WindowError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidQuery => "CALENDAR_WINDOW_INVALID_QUERY",
            Self::ResourceLimit => "CALENDAR_WINDOW_RESOURCE_LIMIT",
            Self::Cancelled => "CALENDAR_WINDOW_CANCELLED",
            Self::Engine(EngineError::InvalidCollation) => "CALENDAR_WINDOW_INVALID_COLLATION",
            Self::Engine(_) => "CALENDAR_WINDOW_INVALID_ENTRY",
        }
    }
}
impl fmt::Display for WindowError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}
impl std::error::Error for WindowError {}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub start_date: String,
    pub end_date: String,
}
impl WindowSpec {
    pub fn bounds(&self) -> Result<WindowBounds, WindowError> {
        WindowBounds::from_spec(self)
    }
}
fn year(year: &str) -> Result<(), WindowError> {
    if year.len() != 4
        || !year.bytes().all(|b| b.is_ascii_digit())
        || !(1900..=4099).contains(&year.parse::<u32>().map_err(|_| WindowError::InvalidQuery)?)
    {
        return Err(WindowError::InvalidQuery);
    }
    Ok(())
}
impl WindowBounds {
    pub(super) fn from_spec(spec: &WindowSpec) -> Result<Self, WindowError> {
        let result = match spec {
            WindowSpec::Day { date } => {
                parse_date(date)?;
                Self {
                    start_date: date.clone(),
                    end_date: date.clone(),
                }
            }
            WindowSpec::PrototypeYear { year: year_text } => {
                year(year_text)?;
                Self {
                    start_date: format!("{year_text}-01-01"),
                    end_date: format!("{year_text}-12-31"),
                }
            }
            WindowSpec::CalendarYear { year: year_text } => {
                year(year_text)?;
                let months = (0..16)
                    .map(|index| calendar::add_months(&format!("{year_text}-01"), index - 2))
                    .collect::<Result<Vec<_>, _>>()?;
                return Self::months(&months);
            }
            WindowSpec::Months { months } => return Self::months(months),
        };
        Ok(result)
    }
    fn months(months: &[String]) -> Result<Self, WindowError> {
        if months.is_empty() {
            return Err(WindowError::InvalidQuery);
        }
        if months.len() > 16 {
            return Err(WindowError::ResourceLimit);
        }
        for month in months {
            calendar::month_range(month)?;
        }
        let first = calendar::month_grid(&months[0])?;
        let last = calendar::month_grid(months.last().expect("nonempty"))?;
        let result = Self {
            start_date: first[0].date.clone(),
            end_date: last.last().expect("42 cells").date.clone(),
        };
        let start = parse_date(&result.start_date)?;
        let end = parse_date(&result.end_date)?;
        if end < start {
            return Err(WindowError::InvalidQuery);
        }
        // Includes the complete existing sixteen-month window and both grids.
        if start
            .checked_add(jiff::Span::new().days(550))
            .is_ok_and(|limit| end > limit)
        {
            return Err(WindowError::ResourceLimit);
        }
        Ok(result)
    }
}
