//! Direct day projection over the app's ordinary loaded records and existing Raw5 input.
use super::*;
use crate::{
    calendar::{incoming, recurrence::CollationRanks, window::WindowSpec},
    contract::utility::UtilityGuard,
    runtime::{calendar_only::CalendarRows, utility_lease::UtilityOwnerMarker},
};
use serde::Deserialize;
use std::{collections::BTreeMap, sync::Arc};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    context: Value,
    date: String,
    records: Value,
    calendars: Vec<Value>,
    platform_collation_ranks: Value,
}
pub(super) fn execute(
    kind: &str,
    raw: &[u8],
    owner: UtilityOwnerMarker,
    guard: &UtilityGuard,
) -> Result<Value, &'static str> {
    let input: Input =
        serde_json::from_value(contract::bounded_json(raw).map_err(|_| "INVALID_CALENDAR_INPUT")?)
            .map_err(|_| "INVALID_CALENDAR_INPUT")?;
    if input.records["kind"] != "RECORDED_ENTRIES" {
        return Err("INVALID_CALENDAR_INPUT");
    }
    let index = CalendarRows::recorded(&input.records).map_err(|_| "INVALID_CALENDAR_INPUT")?;
    let raw_context = serde_json::to_vec(&input.context).map_err(|_| "INVALID_CALENDAR_INPUT")?;
    let prepared = super::highlights::prepare(&raw_context, owner, guard)?;
    let catalog_ranks =
        serde_json::to_vec(&prepared.ranks).map_err(|_| "INVALID_CALENDAR_INPUT")?;
    let context = prepared
        .assembly
        .finish(&catalog_ranks)
        .map_err(|_| "INVALID_CALENDAR_INPUT")?;
    let window = index
        .prepare(&WindowSpec::Day {
            date: input.date.clone(),
        })
        .map_err(|_| "INVALID_CALENDAR_INPUT")?;
    let mut candidates = window.candidates().clone();
    candidates.extend(
        context
            .additional_calendar_candidates(index.entry_source(), &input.date, prepared.epoch)
            .map_err(|_| "INVALID_CALENDAR_INPUT")?,
    );
    if kind == "DAY_DETAILS_CANDIDATES" {
        return serde_json::to_value(candidates).map_err(|_| "OUTPUT_LIMIT");
    }
    let ranks: CollationRanks =
        serde_json::from_value::<BTreeMap<String, u32>>(input.platform_collation_ranks)
            .map_err(|_| "INVALID_CALENDAR_INPUT")?
            .into();
    if candidates.iter().any(|s| ranks.rank(s).is_err()) {
        return Err("INVALID_CALENDAR_INPUT");
    }
    let window = window
        .finalize(&ranks)
        .map_err(|_| "INVALID_CALENDAR_INPUT")?;
    let view = context
        .prepare_window(&input.date, window, &ranks, prepared.epoch)
        .map_err(|_| "INVALID_CALENDAR_INPUT")?
        .ok_or("CALENDAR_PROFILE_UNAVAILABLE")?;
    let mut rows = Vec::new();
    for offset in (0..view
        .entry_count_at(prepared.epoch)
        .map_err(|_| "INVALID_CALENDAR_INPUT")?)
        .step_by(128)
    {
        rows.extend(
            view.rows_at(offset, 128, prepared.epoch)
                .map_err(|_| "INVALID_CALENDAR_INPUT")?,
        );
    }
    let zone = context
        .time_zone()
        .map_err(|_| "INVALID_CALENDAR_INPUT")?
        .ok_or("CALENDAR_PROFILE_UNAVAILABLE")?;
    let shared = incoming::shared_calendar_days(Arc::new(input.calendars), zone, None, None)
        .map_err(|_| "INVALID_CALENDAR_INPUT")?;
    let shared=shared.rows_for_date(&input.date).map(|r| {
        let r=r.map_err(|_|"INVALID_CALENDAR_INPUT")?;
        Ok(json!({"calendarId":r.calendar_id,"calendarName":r.calendar_name,"id":r.entry["id"],"title":r.entry["title"],"when":r.when,"color":r.entry["color"]}))
    }).collect::<Result<Vec<_>,&'static str>>()?;
    Ok(
        json!({"view":view.metadata_at(prepared.epoch).map_err(|_|"INVALID_CALENDAR_INPUT")?,"rows":rows,"shared":shared,"observedEpochMilliseconds":prepared.epoch,"validUntilEpochMilliseconds":context.valid_until_epoch_milliseconds().map_err(|_|"INVALID_CALENDAR_INPUT")?}),
    )
}
