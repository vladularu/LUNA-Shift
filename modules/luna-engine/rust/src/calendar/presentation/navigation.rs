use crate::{EngineError, calendar::CalendarCell};
use serde::{Deserialize, Serialize};
fn present_selection<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(d)
}
/// Pure internal projection input. Runtime must supply reference_date from its
/// own CalendarClockLease; a host DTO is not a clock/readiness proof.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NavigationInput {
    pub anchor_month: String,
    pub reference_date: String,
    #[serde(deserialize_with = "present_selection")]
    pub selected_date: Option<String>,
    pub before: u16,
    pub after: u16,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthGridFrame {
    pub month: String,
    pub month_number: i8,
    pub full_title: String,
    pub title: String,
    pub recenter: bool,
    pub cells: Vec<CalendarCell>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayScroll {
    pub animate: bool,
    pub start_month: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarNavigation {
    pub anchor_month: String,
    pub reference_date: String,
    pub reference_month: String,
    pub initial_selected_date: String,
    pub selected_date: String,
    pub selected_date_title: String,
    pub previous_month: String,
    pub next_month: String,
    pub previous_year: String,
    pub next_year: String,
    pub months: Vec<String>,
    pub data_months: Vec<String>,
    pub year_months: Vec<String>,
    pub today_scroll: TodayScroll,
    pub grids: Vec<MonthGridFrame>,
}
const MONTHS: [&str; 12] = [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
];
const WEEKDAYS: [&str; 7] = [
    "Montag",
    "Dienstag",
    "Mittwoch",
    "Donnerstag",
    "Freitag",
    "Samstag",
    "Sonntag",
];
fn month_date(month: &str) -> Result<jiff::civil::Date, EngineError> {
    crate::calendar::parse_date(&crate::calendar::month_range(month)?.start)
}
fn display_year(year: i16) -> i32 {
    if year <= 0 {
        1 - i32::from(year)
    } else {
        i32::from(year)
    }
}
pub(crate) fn date_title(date: &str) -> Result<String, EngineError> {
    let date = crate::calendar::parse_date(date)?;
    Ok(format!(
        "{}, {:02}. {} {}",
        WEEKDAYS[date.weekday().to_monday_zero_offset() as usize],
        date.day(),
        MONTHS[(date.month() - 1) as usize],
        display_year(date.year())
    ))
}
pub fn calculate(input: &NavigationInput) -> Result<CalendarNavigation, EngineError> {
    use crate::calendar::{add_months, month_grid, parse_date};
    if usize::from(input.before) + usize::from(input.after) + 1 > 128 {
        return Err(EngineError::InvalidDuration);
    }
    let anchor = month_date(&input.anchor_month)?;
    let reference = parse_date(&input.reference_date)?;
    let reference_month = input.reference_date[..7].to_owned();
    let initial_selected_date = if input.anchor_month == reference_month {
        input.reference_date.clone()
    } else {
        format!("{}-01", input.anchor_month)
    };
    let selected_date = match &input.selected_date {
        Some(date) => crate::credit::metrics::clamp_date_to_month(date, &input.anchor_month)
            .map_err(|_| EngineError::InvalidDate)?,
        None => initial_selected_date.clone(),
    };
    let months = (-i32::from(input.before)..=i32::from(input.after))
        .map(|offset| add_months(&input.anchor_month, offset))
        .collect::<Result<Vec<_>, _>>()?;
    let year_start = format!("{}-01", &input.anchor_month[..4]);
    let data_months = (-2..14)
        .map(|offset| add_months(&year_start, offset))
        .collect::<Result<Vec<_>, _>>()?;
    let year_months = (1..=12)
        .map(|month| format!("{}-{month:02}", anchor.year()))
        .collect();
    let distance = (i32::from(reference.year()) - i32::from(anchor.year())) * 12
        + i32::from(reference.month())
        - i32::from(anchor.month());
    let today_scroll = TodayScroll {
        animate: distance.abs() > 0 && distance.abs() < 3,
        start_month: if distance.abs() <= 4 {
            input.anchor_month.clone()
        } else {
            add_months(&reference_month, if distance > 0 { -4 } else { 4 })?
        },
    };
    let grids = months
        .iter()
        .enumerate()
        .map(|(index, month)| {
            let date = month_date(month)?;
            let name = MONTHS[(date.month() - 1) as usize];
            let year = display_year(date.year());
            let full_title = format!("{name} {year}");
            // The original JSX removes only a four-digit suffix, including its existing
            // behavior for proleptic years rendered with fewer than four digits.
            let title = if date.year() == reference.year() && (1000..=9999).contains(&year) {
                name.to_owned()
            } else {
                full_title.clone()
            };
            Ok(MonthGridFrame {
                month: month.clone(),
                month_number: date.month(),
                full_title,
                title,
                recenter: index <= 2 || index >= months.len().saturating_sub(3),
                cells: month_grid(month)?,
            })
        })
        .collect::<Result<Vec<_>, EngineError>>()?;
    Ok(CalendarNavigation {
        anchor_month: input.anchor_month.clone(),
        reference_date: input.reference_date.clone(),
        reference_month,
        initial_selected_date,
        selected_date_title: date_title(&selected_date)?,
        selected_date,
        previous_month: add_months(&input.anchor_month, -1)?,
        next_month: add_months(&input.anchor_month, 1)?,
        previous_year: add_months(&input.anchor_month, -12)?,
        next_year: add_months(&input.anchor_month, 12)?,
        months,
        data_months,
        year_months,
        today_scroll,
        grids,
    })
}
