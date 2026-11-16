use super::{
    entries::YouthEntry,
    helpers,
    interval_math::{YouthSpan, plain},
};
use serde_json::Value;
fn located(
    training: &YouthEntry,
    entries: &[&YouthEntry],
    details: Option<&Value>,
) -> Option<Vec<YouthSpan>> {
    let Some(details) = details else {
        return Some(vec![]);
    };
    let mut routes = Vec::new();
    for (minutes, interval, before) in [
        ("travelFromWorkMinutes", "travelFromWorkInterval", true),
        ("travelToWorkMinutes", "travelToWorkInterval", false),
    ] {
        let minutes = details.get(minutes)?;
        if minutes.is_null() {
            return None;
        }
        if minutes.as_f64() == Some(0.0) {
            continue;
        }
        let interval = details.get(interval).filter(|v| helpers::truthy(Some(v)))?;
        let start = i64::try_from(helpers::millis(&interval["start"])?).ok()?;
        let end = i64::try_from(helpers::millis(&interval["end"])?).ok()?;
        let matching = entries
            .iter()
            .filter(|e| e.school.is_none() && e.exam.is_none())
            .any(|work| {
                if before {
                    work.end_milliseconds <= start && end <= training.start_milliseconds
                } else {
                    training.end_milliseconds <= start && end <= work.start_milliseconds
                }
            });
        if !matching
            || entries.iter().any(|e| {
                !std::ptr::eq(*e, training)
                    && e.start_milliseconds < end
                    && e.end_milliseconds > start
            })
        {
            return None;
        }
        routes.push(plain(start, end));
    }
    Some(routes)
}
pub fn school(entry: &YouthEntry, entries: &[&YouthEntry]) -> Option<Vec<YouthSpan>> {
    located(entry, entries, entry.school.as_ref())
}
pub fn exam(entry: &YouthEntry, entries: &[&YouthEntry]) -> Option<Vec<YouthSpan>> {
    located(entry, entries, entry.exam.as_ref())
}
pub fn activity(entry: &YouthEntry, entries: &[&YouthEntry]) -> YouthSpan {
    let routes = if entry.school.is_some() {
        school(entry, entries)
    } else {
        exam(entry, entries)
    };
    let mut start = entry.start_milliseconds;
    let mut end = entry.end_milliseconds;
    for route in routes.iter().flatten() {
        start = start.min(route.start_milliseconds);
        end = end.max(route.end_milliseconds);
    }
    plain(start, end)
}
