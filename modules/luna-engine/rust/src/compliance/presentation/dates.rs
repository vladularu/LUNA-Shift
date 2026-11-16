use jiff::{ToSpan, civil::Date};
use serde_json::{Value, json};
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
const SHORT: [&str; 12] = [
    "Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez.",
];
pub(super) fn parse(raw: &str) -> Option<Date> {
    let normalized = crate::input::calendar::require_local_date(&json!(raw)).ok()?;
    crate::calendar::parse_date(&normalized).ok()
}
pub(super) fn full(date: Date) -> String {
    format!(
        "{}. {} {}",
        date.day(),
        MONTHS[date.month() as usize - 1],
        date.year()
    )
}
pub fn labels(raw: &str) -> Value {
    let Some(date) = parse(raw) else {
        return json!({"checkDate":"Datum nicht verfügbar","checkDateWithoutYear":"Datum nicht verfügbar","dayParts":["—",""],"formatted":{"ok":false}});
    };
    // Date.UTC has a source-specific 1900 offset for years zero through99 and
    // constrains by carrying an out-of-range day into the next month.
    let utc = if (0..=99).contains(&date.year()) {
        Date::new(date.year() + 1900, date.month(), 1)
            .ok()
            .and_then(|d| d.checked_add((date.day() - 1).days()).ok())
    } else {
        Some(date)
    };
    let formatted=utc.map(|date|json!({"ok":true,"value":format!("{}, {:02}. {}",["Mo.","Di.","Mi.","Do.","Fr.","Sa.","So."][date.weekday().to_monday_zero_offset() as usize],date.day(),SHORT[date.month() as usize-1])})).unwrap_or(json!({"ok":false}));
    json!({"checkDate":full(date),"checkDateWithoutYear":format!("{}. {}",date.day(),MONTHS[date.month() as usize-1]),"dayParts":[date.day().to_string(),SHORT[date.month() as usize-1]],"formatted":formatted})
}
pub fn period(from: &str, until: &str) -> Value {
    let Some((first, last)) = parse(from)
        .zip(parse(until))
        .filter(|(first, last)| first <= last)
    else {
        return json!({"label":"Zeitraum nicht verfügbar","compact":null});
    };
    let label = if first == last {
        full(first)
    } else if first.year() == last.year() && first.month() == last.month() {
        format!(
            "{}.–{}. {} {}",
            first.day(),
            last.day(),
            MONTHS[last.month() as usize - 1],
            last.year()
        )
    } else {
        format!("{} – {}", full(first), full(last))
    };
    let part = |date: Date, year: bool| {
        format!(
            "{:02}.{:02}.{}",
            date.day(),
            date.month(),
            if year {
                date.year().to_string()
            } else {
                String::new()
            }
        )
    };
    json!({"label":label,"compact":format!("{}–{}",part(first,first.year()!=last.year()),part(last,true))})
}
