use super::{CombinedPreview, PreviewSelection, RowKind, SelectedRow};
use crate::EngineError;
use serde_json::Value;
const LIMIT: usize = 100000;
fn row_cost(entry: &Value, detailed: bool) -> f64 {
    if detailed
        && entry["kind"] == "SHIFT"
        && (entry["allDay"] == true
            || (entry["startTime"].is_null() && entry["endTime"].is_null())
            || (!entry["startTime"].is_null() && !entry["endTime"].is_null()))
    {
        2.0
    } else {
        1.0
    }
}
fn select<'a>(
    count: usize,
    entry: &impl Fn(usize) -> &'a Value,
    capacity: f64,
    detailed: bool,
) -> PreviewSelection {
    let mut indices = Vec::new();
    let mut used = 0.0;
    for index in 0..count {
        let cost = row_cost(entry(index), detailed);
        if used + cost > capacity {
            break;
        }
        indices.push(index as u32);
        used += cost;
    }
    let mut overflow = count - indices.len();
    while overflow > 0 && indices.len() > 1 && used + 1.0 > capacity {
        let index = indices.pop().expect("Nonempty guarded selection");
        used -= row_cost(entry(index as usize), detailed);
        overflow += 1;
    }
    PreviewSelection {
        indices,
        overflow_count: overflow as u32,
    }
}
pub fn entry_preview(
    entries: &[Value],
    capacity: f64,
    detailed: bool,
    reserve: bool,
) -> Result<PreviewSelection, EngineError> {
    entry_preview_with(entries.len(), |i| &entries[i], capacity, detailed, reserve)
}
/// The same Source policy over a borrowed indexed view, with no row collection.
pub(crate) fn entry_preview_with<'a>(
    count: usize,
    entry: impl Fn(usize) -> &'a Value,
    capacity: f64,
    detailed: bool,
    reserve: bool,
) -> Result<PreviewSelection, EngineError> {
    if count > LIMIT || !capacity.is_finite() {
        return Err(EngineError::InvalidCalendarEntry);
    }
    let capacity = capacity.floor().max(0.0);
    let full = select(count, &entry, capacity, detailed);
    Ok(if reserve && full.overflow_count > 0 {
        select(count, &entry, (capacity - 1.0).max(0.0), detailed)
    } else {
        full
    })
}
pub fn combined_preview(
    own: &[Value],
    shared: &[Value],
    week_height: f64,
    detailed: bool,
    entry_row_height: f64,
) -> Result<CombinedPreview, EngineError> {
    if own.len().saturating_add(shared.len()) > LIMIT
        || !week_height.is_finite()
        || !entry_row_height.is_finite()
        || entry_row_height < 0.0
    {
        return Err(EngineError::InvalidCalendarEntry);
    }
    let header_height = 31.0;
    let available = (week_height - header_height - 2.0).max(0.0);
    let lines = if detailed { 2.0 } else { 1.0 };
    let capacity = ((available + 1.0) / (lines * 11.0 + 1.0)).floor().min(2.0);
    let mut work = Vec::new();
    let mut appointments = Vec::new();
    let ranked = own
        .iter()
        .enumerate()
        .take(1)
        .map(|(i, e)| (RowKind::Own, i, e))
        .chain(
            shared
                .iter()
                .enumerate()
                .take(1)
                .map(|(i, e)| (RowKind::Shared, i, &e["entry"])),
        )
        .chain(
            own.iter()
                .enumerate()
                .skip(1)
                .map(|(i, e)| (RowKind::Own, i, e)),
        )
        .chain(
            shared
                .iter()
                .enumerate()
                .skip(1)
                .map(|(i, e)| (RowKind::Shared, i, &e["entry"])),
        );
    for (kind, index, entry) in ranked {
        let appointment = match entry.get("kind").and_then(Value::as_str) {
            Some("APPOINTMENT") => true,
            Some("SHIFT") => false,
            _ if matches!(kind, RowKind::Shared) => false,
            _ => return Err(EngineError::InvalidCalendarEntry),
        };
        let item = (
            SelectedRow {
                kind,
                index: index as u32,
            },
            appointment,
        );
        if appointment {
            appointments.push(item);
        } else {
            work.push(item);
        }
    }
    work.extend(appointments);
    let gap = (available - capacity * lines * 11.0).clamp(1.0, 4.0);
    let line_height = if capacity == 0.0 {
        entry_row_height
    } else {
        ((available - (capacity - 1.0).max(0.0) * gap) / (capacity * lines))
            .floor()
            .min(entry_row_height)
    };
    let mut rows = Vec::new();
    let mut heights = Vec::new();
    let mut gaps = Vec::new();
    let mut used_lines = 0.0;
    let mut used_height = 0.0;
    let mut previous_appointment = None;
    for (item, appointment) in &work {
        let row_lines = if *appointment { 1.0 } else { lines };
        let gap_before = if let Some(previous) = previous_appointment {
            if previous && *appointment { 0.0 } else { gap }
        } else {
            0.0
        };
        let height = row_lines * line_height;
        if used_lines + row_lines > capacity * lines
            || used_height + gap_before + height > available
        {
            break;
        }
        rows.push(*item);
        heights.push(height);
        gaps.push(gap_before);
        used_lines += row_lines;
        used_height += gap_before + height;
        previous_appointment = Some(*appointment);
    }
    let hidden_rows = work[rows.len()..]
        .iter()
        .map(|(r, _)| *r)
        .collect::<Vec<_>>();
    let overflow_count = hidden_rows.len() as u32;
    Ok(CombinedPreview {
        rows,
        heights,
        gaps,
        used_height,
        hidden_rows,
        line_height,
        header_height,
        overflow_count,
    })
}
