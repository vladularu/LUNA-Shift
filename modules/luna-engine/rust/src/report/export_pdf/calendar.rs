use super::{PdfError, format::*, rows::date_groups};
use crate::report::export_rows::ReportEntry;
use jiff::{ToSpan, civil::Date};
use serde_json::{Value, json};
use std::collections::HashMap;

pub(super) fn month(period: &str, entries: &[ReportEntry]) -> Result<Value, PdfError> {
    let first = format!("{period}-01")
        .parse::<Date>()
        .map_err(|_| PdfError)?;
    let offset = first.weekday().to_monday_zero_offset();
    let week_count = (i32::from(offset) + i32::from(first.last_of_month().day()) + 6) / 7;
    let start = first.checked_sub(offset.days()).map_err(|_| PdfError)?;
    let groups = date_groups(entries, false);
    let by_date = groups
        .iter()
        .map(|group| (group.date, group))
        .collect::<HashMap<_, _>>();
    let mut weeks = Vec::new();
    for week in 0..week_count {
        let mut days = Vec::new();
        for index in 0..7 {
            let date = start
                .checked_add((week * 7 + index).days())
                .map_err(|_| PdfError)?;
            let key = date.to_string();
            let group = by_date.get(key.as_str());
            let event=group.map(|group|json!({"title":short(&group.first.title,15),"color":group.first.color,"time":text(if group.first.all_day{"Ganztägig"}else{group.first.start_time.as_deref().unwrap_or("")})}));
            days.push(json!({"outside":date.month()!=first.month(),"day":text(&date.day().to_string()),"event":event,"more":group.filter(|g|g.count>1).map(|g|text(&format!("+{} weitere",g.count-1)))}));
        }
        weeks.push(days);
    }
    Ok(
        json!({"weekCount":week_count,"weeks":weeks,"note":text(&format!("Leere Tage: kein Eintrag. Kontozeit inkl. Abwesenheitsgutschriften.{}",if groups.iter().any(|g|g.count>1){" Weitere Einträge siehe Standard-Bericht oder CSV."}else{""}))}),
    )
}
