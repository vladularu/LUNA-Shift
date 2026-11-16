use super::{PdfError, format::*};
use crate::{
    calendar::sharing::utf16_prefix, input::javascript_json::number_text,
    report::export_rows::ReportEntry,
};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

pub(super) struct DateGroup<'a> {
    pub date: &'a str,
    pub first: &'a ReportEntry,
    pub count: usize,
    entries: Vec<&'a ReportEntry>,
}
/// Only borrowed entry references are grouped; titles/plans are not cloned.
pub(super) fn date_groups(entries: &[ReportEntry], summary: bool) -> Vec<DateGroup<'_>> {
    let mut indices = HashMap::new();
    let mut groups: Vec<DateGroup<'_>> = Vec::new();
    for entry in entries {
        let index = *indices.entry(entry.date.as_str()).or_insert_with(|| {
            groups.push(DateGroup {
                date: &entry.date,
                first: entry,
                count: 0,
                entries: Vec::new(),
            });
            groups.len() - 1
        });
        let group = &mut groups[index];
        group.count += 1;
        if summary {
            group.entries.push(entry);
        }
    }
    groups
}
fn summary_title(group: &DateGroup<'_>) -> Value {
    let mut seen = HashSet::new();
    let mut units = Vec::new();
    let mut first = true;
    for entry in &group.entries {
        if !seen.insert(entry.title.as_str()) {
            continue;
        }
        if !first {
            units.extend([u16::from(b','), u16::from(b' ')]);
        }
        first = false;
        // Once 66 joined units are known, no suffix can change short(...,65).
        units.extend(utf16_prefix(
            &entry.title,
            66_usize.saturating_sub(units.len()),
        ));
        if units.len() > 65 {
            units.truncate(64);
            units.push(0x2026);
            break;
        }
    }
    json!(units)
}
fn entry_row(entry: &ReportEntry) -> Result<Value, PdfError> {
    for number in [
        entry.break_minutes,
        entry.duration_minutes,
        entry.credit_minutes,
    ]
    .into_iter()
    .flatten()
    {
        finite(number)?;
    }
    let time = if entry.kind == "APPOINTMENT" {
        if entry.all_day {
            "-".into()
        } else {
            minutes(entry.duration_minutes, false)?
        }
    } else if entry.duration_minutes.is_some() {
        minutes(entry.duration_minutes, false)?
    } else {
        match entry.credit_minutes {
            None => "Nicht verfügbar".into(),
            Some(value) if value > 0.0 => format!("{} *", minutes(Some(value), false)?),
            Some(_) => "-".into(),
        }
    };
    let entry_time = if entry.all_day {
        "Ganztägig".into()
    } else {
        format!(
            "{} - {}{}",
            entry.start_time.as_deref().unwrap_or("-"),
            entry.end_time.as_deref().unwrap_or("-"),
            if entry.next_day { " +1" } else { "" }
        )
    };
    Ok(
        json!({"date":day(&entry.date),"title":short(&entry.title,30),"appointment":entry.kind=="APPOINTMENT","color":entry.color,"entryTime":text(&entry_time),"pause":text(&entry.break_minutes.map_or_else(||"-".into(),|v|format!("{} min",number_text(v)))),"time":text(&time)}),
    )
}
pub(super) fn pages(entries: &[ReportEntry]) -> Result<Vec<Value>, PdfError> {
    if entries.len() > 60 {
        let rows=date_groups(entries,true).iter().map(|group|json!({"date":day(group.date),"title":summary_title(group),"count":text(&group.count.to_string())})).collect::<Vec<_>>();
        return Ok(vec![
            json!({"kind":"DAYS","heading":text("Tagesübersicht"),"caption":text(&format!("{} Einträge: PDF tagesweise verdichtet. Vollständige Einzelliste im CSV.",entries.len())),"dense":true,"rows":rows}),
        ]);
    }
    let mut pages = Vec::new();
    for index in 0..if entries.len() > 30 { 2 } else { 1 } {
        let selected = &entries[index * 30..(index * 30 + 30).min(entries.len())];
        pages.push(json!({"kind":"ROWS","heading":text(&format!("Dienste, Abwesenheiten & Termine{}",if index==0{""}else{" · Fortsetzung"})),"caption":text(&format!("{} Einträge im Monat. Dienstzeiten ohne unbezahlte Pause.",entries.len())),"dense":selected.len()>24,"rows":selected.iter().map(entry_row).collect::<Result<Vec<_>,_>>()?}));
    }
    Ok(pages)
}
