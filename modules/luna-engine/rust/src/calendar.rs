use crate::EngineError;
use jiff::ToSpan;
use jiff::civil::Date;
use serde::Serialize;
pub mod incoming;
pub mod loaded_scope;
pub mod notifications;
pub mod presentation;
pub mod widget;

pub(crate) fn parse_date(text: &str) -> Result<Date, EngineError> {
    if text.len() != 10
        || text.as_bytes()[4] != b'-'
        || text.as_bytes()[7] != b'-'
        || text
            .bytes()
            .enumerate()
            .any(|(i, b)| i != 4 && i != 7 && !b.is_ascii_digit())
    {
        return Err(EngineError::InvalidDate);
    }
    text.parse().map_err(|_| EngineError::InvalidDate)
}

fn month_start(month: &str) -> Result<Date, EngineError> {
    if month.len() != 7 {
        return Err(EngineError::InvalidDate);
    }
    parse_date(&format!("{month}-01"))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarCell {
    pub date: String,
    pub day: i8,
    pub in_month: bool,
    pub weekend: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MonthRange {
    pub start: String,
    pub end: String,
}

pub fn month_grid(month: &str) -> Result<Vec<CalendarCell>, EngineError> {
    let first = month_start(month)?;
    let start = first
        .checked_sub(first.weekday().to_monday_zero_offset().days())
        .map_err(|_| EngineError::InvalidDate)?;
    (0..42)
        .map(|index| {
            let date = start
                .checked_add(index.days())
                .map_err(|_| EngineError::InvalidDate)?;
            Ok(CalendarCell {
                date: date.to_string(),
                day: date.day(),
                in_month: date.month() == first.month() && date.year() == first.year(),
                weekend: date.weekday().to_monday_zero_offset() >= 5,
            })
        })
        .collect()
}

pub fn month_range(month: &str) -> Result<MonthRange, EngineError> {
    let first = month_start(month)?;
    let last = first.last_of_month();
    Ok(MonthRange {
        start: first.to_string(),
        end: last.to_string(),
    })
}

pub fn add_months(month: &str, amount: i32) -> Result<String, EngineError> {
    let next = month_start(month)?
        .checked_add(amount.months())
        .map_err(|_| EngineError::InvalidDate)?;
    Ok(format!("{:04}-{:02}", next.year(), next.month()))
}

pub fn iso_week(date: &str) -> Result<i8, EngineError> {
    Ok(parse_date(date)?.iso_week_date().week())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leap_days_and_iso_year_boundaries() {
        assert_eq!(month_range("2028-02").expect("fixture").end, "2028-02-29");
        assert_eq!(iso_week("2021-01-01"), Ok(53));
        assert_eq!(add_months("2026-12", 1).expect("fixture"), "2027-01");
        assert!(month_range("2026-13").is_err());
        assert!(parse_date("2026-02-29").is_err());
        let grid = month_grid("2026-11").expect("fixture");
        assert_eq!(grid.len(), 42);
        assert_eq!(grid[0].date, "2026-10-26");
        assert_eq!(grid[41].date, "2026-12-06");
    }
}
pub mod recurrence;
pub mod sharing;
pub mod window;
