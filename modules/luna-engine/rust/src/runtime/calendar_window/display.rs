//! Small display outputs from the same borrowed source window and native clock.
use crate::{
    EngineError,
    calendar::{
        presentation::{self, preview, rows},
        window::CalendarWindowView,
    },
    contract::calendar_window::EntryPresentation,
};
use serde::Serialize;
#[derive(Serialize)]
pub(super) struct EntryRow {
    index: u32,
    date: String,
    label: presentation::LabelPresentation,
    detail: Option<String>,
}
pub(super) fn entry(
    view: &CalendarWindowView,
    index: u32,
    options: &EntryPresentation,
    zone: &str,
) -> Result<EntryRow, EngineError> {
    let row = view
        .window()
        .entry(index)
        .ok_or(EngineError::InvalidCalendarEntry)?;
    let original = row.original();
    Ok(EntryRow {
        index,
        date: row.date().to_owned(),
        label: rows::label(original, options.label_mode)?,
        detail: if original["kind"] == "SHIFT" {
            rows::shift_detail(
                original,
                presentation::DisplayOptions {
                    show_shift_times: options.show_shift_times,
                    show_shift_duration: options.show_shift_duration,
                },
                zone,
            )?
        } else {
            None
        },
    })
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DayPreview {
    date: String,
    indices: Vec<u32>,
    overflow_count: u32,
}
pub(super) fn day(
    view: &CalendarWindowView,
    index: usize,
    options: &EntryPresentation,
) -> Result<DayPreview, EngineError> {
    let (date, indices) = view
        .date_groups()
        .get(index)
        .ok_or(EngineError::InvalidCalendarEntry)?;
    let selected = preview::entry_preview_with(
        indices.len(),
        |i| {
            view.window()
                .entry(indices[i])
                .expect("indexed source row")
                .original()
        },
        f64::from(options.row_capacity),
        options.detailed_shifts,
        options.reserve_overflow,
    )?;
    Ok(DayPreview {
        date: date.to_owned(),
        indices: selected
            .indices
            .into_iter()
            .map(|i| indices[i as usize])
            .collect(),
        overflow_count: selected.overflow_count,
    })
}
