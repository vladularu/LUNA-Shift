use super::{CalendarLoadRange, ScopeEntries, ScopeEntry, ScopeError};
use crate::calendar::recurrence::{CollationRanks, sort_key_for_fields};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
pub(super) type EntryId = (String, String);
pub(super) fn retain(
    known: &[CalendarLoadRange],
    range: &CalendarLoadRange,
    current_year: i32,
) -> Vec<CalendarLoadRange> {
    let mut next = known
        .iter()
        .filter(|item| *item != range)
        .cloned()
        .collect::<Vec<_>>();
    next.push(range.clone());
    let protected = CalendarLoadRange {
        start_date: format!("{}-01-01", current_year - 1),
        end_date: format!("{}-12-31", current_year + 1),
    };
    while next.len() > 3 {
        let oldest = next
            .iter()
            .position(|item| !item.covers(&protected))
            .unwrap_or(0);
        next.remove(oldest);
    }
    next
}
pub(super) fn membership(
    loaded: &ScopeEntries,
    before: &ScopeEntries,
    current: &ScopeEntries,
    range: &CalendarLoadRange,
    deleted: &BTreeSet<EntryId>,
    retained: &[CalendarLoadRange],
) -> Result<Vec<Arc<ScopeEntry>>, ScopeError> {
    let baseline = before
        .entries()
        .iter()
        .map(|entry| (entry.key(), entry))
        .collect::<BTreeMap<_, _>>();
    let live = current
        .entries()
        .iter()
        .map(|entry| (entry.key(), entry))
        .collect::<BTreeMap<_, _>>();
    // Preserve JS Map insertion order, including delete-then-insert overlays.
    // Sorting a BTreeMap directly would invent tie order for platform-equal IDs.
    let mut slots = Vec::new();
    let mut index = BTreeMap::new();
    for entry in loaded.entries() {
        if let Some(old) = index.insert(entry.key(), slots.len()) {
            slots[old] = None;
        }
        slots.push(Some(entry.clone()));
    }
    for entry in current.entries() {
        if !entry.value["deletedAt"].is_null() || index.contains_key(&entry.key()) {
            continue;
        }
        let date = entry.value["date"]
            .as_str()
            .ok_or(ScopeError::InvalidIntent)?;
        if !range.contains(date) && retained.iter().any(|keep| keep.contains(date)) {
            index.insert(entry.key(), slots.len());
            slots.push(Some(entry.clone()));
        }
    }
    for (kind, id) in deleted {
        let key = (kind.as_str(), id.as_str());
        if !live.contains_key(&key)
            && let Some(old) = index.remove(&key)
        {
            slots[old] = None;
        }
    }
    for key in baseline.keys() {
        if !live.contains_key(key)
            && let Some(old) = index.remove(key)
        {
            slots[old] = None;
        }
    }
    for entry in current.entries() {
        let key = entry.key();
        if baseline
            .get(&key)
            .is_some_and(|old| Arc::ptr_eq(old, entry))
        {
            continue;
        }
        if let Some(old) = index.remove(&key) {
            slots[old] = None;
        }
        let date = entry.value["date"]
            .as_str()
            .ok_or(ScopeError::InvalidIntent)?;
        if entry.value["deletedAt"].is_null()
            && (range.contains(date)
                || retained.iter().any(|keep| keep.contains(date))
                || (date <= range.end_date.as_str()
                    && key.0 == "APPOINTMENT"
                    && !entry.value["recurrence"].is_null()))
        {
            index.insert(key, slots.len());
            slots.push(Some(entry.clone()));
        }
    }
    Ok(slots.into_iter().flatten().collect())
}
pub(super) fn upsert(
    current: &ScopeEntries,
    saved: Arc<ScopeEntry>,
    ranks: &CollationRanks,
) -> Result<ScopeEntries, ScopeError> {
    let date = saved.value["date"]
        .as_str()
        .ok_or(ScopeError::InvalidIntent)?;
    let key = sort_key_for_fields(|field| saved.get(field), date, ranks)?;
    let mut next = current
        .entries()
        .iter()
        .filter(|entry| entry.value["id"] != saved.value["id"])
        .cloned()
        .collect::<Vec<_>>();
    let mut low = 0;
    let mut high = next.len();
    while low < high {
        let middle = (low + high) / 2;
        let date = next[middle].value["date"]
            .as_str()
            .ok_or(ScopeError::InvalidIntent)?;
        if sort_key_for_fields(|field| next[middle].get(field), date, ranks)? <= key {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    next.insert(low, saved);
    Ok(ScopeEntries(Arc::from(next)))
}
