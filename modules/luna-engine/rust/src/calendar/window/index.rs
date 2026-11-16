use super::{
    borrowed::CalendarEntrySource, model::*, projection::SortedCalendarWindow,
    view::CalendarWindowView,
};
use crate::credit::duty::duty_calendar_dates;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
fn push(
    groups: &mut Vec<(String, Vec<u32>)>,
    positions: &mut BTreeMap<String, usize>,
    key: String,
    index: u32,
) {
    let position = if let Some(position) = positions.get(&key) {
        *position
    } else {
        let position = groups.len();
        positions.insert(key.clone(), position);
        groups.push((key, Vec::new()));
        position
    };
    groups[position].1.push(index);
}
impl<S: CalendarEntrySource> SortedCalendarWindow<S> {
    pub fn index(
        self: &Arc<Self>,
        options: WindowOptions,
    ) -> Result<CalendarWindowView<S>, WindowError> {
        let mut visible = Vec::new();
        let mut dates = Vec::new();
        let mut months = Vec::new();
        let mut date_positions = BTreeMap::new();
        let mut month_positions = BTreeMap::new();
        for (index, entry) in self.entries.iter().enumerate() {
            let index = index as u32;
            let row = entry.row(&self.rows);
            let is_shift = row["kind"] == "SHIFT";
            let touched = if is_shift {
                duty_calendar_dates(row.base_value())?
            } else {
                vec![entry.date(&self.rows)?.to_owned()]
            };
            if is_shift {
                let mut seen = BTreeSet::new();
                for date in &touched {
                    let month = &date[..7];
                    if seen.insert(month) {
                        push(&mut months, &mut month_positions, month.to_owned(), index);
                    }
                }
                if !options.show_shifts {
                    continue;
                }
            } else if !options.show_appointments {
                continue;
            }
            visible.push(index);
            for date in touched {
                push(&mut dates, &mut date_positions, date, index);
            }
        }
        // Groups are stable subsequences of the same comparator order.
        Ok(CalendarWindowView {
            window: self.clone(),
            visible,
            dates,
            months,
        })
    }
}
