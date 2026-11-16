//! Pure calendar presentation on the existing bounded raw source channel.
//! It owns no source slot, builder, or additional scheduling capacity.
use super::*;
use crate::contract::utility::{UtilityGuard, UtilityKind};
use serde::Deserialize;
use std::sync::Arc;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Header {
    kind: Presentation,
    wire_schema_version: u32,
    expected_engine_version: String,
    calculation_contract_version: String,
    guard: UtilityGuard,
    command: Command,
}
#[derive(Deserialize)]
enum Presentation {
    #[serde(rename = "PRESENTATION")]
    Presentation,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Command {
    kind: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Incoming {
    calendars: Vec<Value>,
    time_zone: String,
    now: Option<f64>,
    window: Option<DayWindow>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DayWindow {
    start_date: String,
    end_date: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Preview {
    own: Vec<Value>,
    shared: Vec<Value>,
    week_height: f64,
    detailed: bool,
    entry_row_height: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MonthDisplay {
    label_mode: crate::calendar::presentation::LabelMode,
    show_shift_times: bool,
    show_shift_duration: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MonthRows {
    days: Vec<MonthDay>,
    display: MonthDisplay,
    time_zone: String,
    week_height: f64,
    entry_row_height: f64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MonthDay {
    date: String,
    own: Vec<Value>,
    shared: Vec<Value>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SharedDetail {
    calendars: Vec<Value>,
    time_zone: String,
    date: String,
    calendar_id: String,
    entry_id: String,
}
fn month(input: MonthRows) -> Result<Value, &'static str> {
    use crate::calendar::presentation::{DisplayOptions, RowKind, preview, rows};
    if input.days.len() > 42 {
        return Err("INVALID_CALENDAR_INPUT");
    }
    let options = DisplayOptions {
        show_shift_times: input.display.show_shift_times,
        show_shift_duration: input.display.show_shift_duration,
    };
    let mut days = Vec::new();
    for day in input.days {
        crate::calendar::parse_date(&day.date).map_err(|_| "INVALID_CALENDAR_INPUT")?;
        let preview = preview::combined_preview(
            &day.own,
            &day.shared,
            input.week_height,
            options.show_shift_times || options.show_shift_duration,
            input.entry_row_height,
        )
        .map_err(|_| "INVALID_CALENDAR_INPUT")?;
        let mut presentations = Vec::new();
        for selected in &preview.rows {
            let (entry, detail) = match selected.kind {
                RowKind::Own => {
                    let entry = &day.own[selected.index as usize];
                    let detail = if entry["kind"] == "APPOINTMENT" {
                        None
                    } else {
                        rows::shift_detail(entry, options, &input.time_zone)
                            .map_err(|_| "INVALID_CALENDAR_INPUT")?
                    };
                    (entry, detail)
                }
                RowKind::Shared => {
                    let row = &day.shared[selected.index as usize];
                    let entry = &row["entry"];
                    let detail = if entry["kind"] == "APPOINTMENT" {
                        None
                    } else {
                        rows::shared_shift_detail(
                            entry,
                            row["when"]
                                .as_str()
                                .ok_or("INVALID_CALENDAR_INPUT")?
                                .split('–')
                                .next()
                                .unwrap_or(""),
                            options,
                        )
                        .map_err(|_| "INVALID_CALENDAR_INPUT")?
                    };
                    (entry, detail)
                }
            };
            let label = match selected.kind {
                RowKind::Own => rows::label(entry, input.display.label_mode),
                RowKind::Shared => rows::shared_label(entry, input.display.label_mode),
            }
            .map_err(|_| "INVALID_CALENDAR_INPUT")?;
            presentations.push(json!({"kind":selected.kind,"index":selected.index,"date":day.date,"label":label,"detail":detail}));
        }
        days.push(json!({"date":day.date,"preview":preview,"presentations":presentations}));
    }
    value(&days)
}
fn value<T: serde::Serialize>(value: &T) -> Result<Value, &'static str> {
    crate::report::cache_budget::serialized_bytes(value, 33_554_432).ok_or("OUTPUT_LIMIT")?;
    serde_json::to_value(value).map_err(|_| "OUTPUT_LIMIT")
}
fn execute(kind: &str, raw: &[u8]) -> Result<Value, &'static str> {
    if kind == "CHECKS_MODELS" {
        return crate::compliance::details::models::execute(raw);
    }
    if kind == "SALARY_PAYMENT_TIMING" {
        return crate::input::salary_payment_command::execute(raw);
    }
    if matches!(kind, "SHARING_CANDIDATES" | "SHARING_PROJECT") {
        return crate::calendar::sharing::command::execute(kind, raw);
    }
    if kind == "BACKUP_BUSINESS_PREFERENCES" {
        return crate::input::backup_preferences::execute(raw);
    }
    if kind == "STORED_ROWS" {
        return crate::input::stored_rows::execute(raw);
    }
    if kind == "TARGET_SETTINGS" {
        return crate::target::repository::execute(raw);
    }
    if kind == "EXPORT_CANDIDATES" {
        return crate::report::export_candidates::execute(raw);
    }
    if kind == "PROFILE_REPOSITORY_WRITE" {
        return crate::input::profile_write::command::execute(raw);
    }
    if matches!(
        kind,
        "WIDGET_CLOCK" | "WIDGET_TIMELINE" | "WIDGET_CANDIDATES"
    ) {
        return crate::calendar::widget::command::execute(kind, raw);
    }
    let input = contract::bounded_json(raw).map_err(|_| "INVALID_CALENDAR_INPUT")?;
    match kind {
        "SHARED_ENTRY_DETAIL" => {
            let input: SharedDetail =
                serde_json::from_value(input).map_err(|_| "INVALID_CALENDAR_INPUT")?;
            crate::calendar::presentation::shared_entry::detail(
                Arc::new(input.calendars),
                &input.time_zone,
                &input.date,
                &input.calendar_id,
                &input.entry_id,
            )
            .map_err(|_| "INVALID_CALENDAR_INPUT")
        }
        "MONTH_PRESENTATION" => {
            month(serde_json::from_value(input).map_err(|_| "INVALID_CALENDAR_INPUT")?)
        }
        "INCOMING_DAYS" => {
            let input: Incoming =
                serde_json::from_value(input).map_err(|_| "INVALID_CALENDAR_INPUT")?;
            let window =
                input
                    .window
                    .as_ref()
                    .map(|w| crate::calendar::incoming::SharedDayWindow {
                        start_date: &w.start_date,
                        end_date: &w.end_date,
                    });
            let days = crate::calendar::incoming::shared_calendar_days(
                Arc::new(input.calendars),
                &input.time_zone,
                input.now,
                window.as_ref(),
            )
            .map_err(|_| "INVALID_CALENDAR_INPUT")?;
            value(&days)
        }
        "COMBINED_PREVIEW" => {
            let input: Preview =
                serde_json::from_value(input).map_err(|_| "INVALID_CALENDAR_INPUT")?;
            let preview = crate::calendar::presentation::preview::combined_preview(
                &input.own,
                &input.shared,
                input.week_height,
                input.detailed,
                input.entry_row_height,
            )
            .map_err(|_| "INVALID_CALENDAR_INPUT")?;
            value(&preview)
        }
        _ => Err("INVALID_CALENDAR_COMMAND"),
    }
}
fn failure(code: &'static str) -> EngineBuffer {
    output(&json!({"ok":false,"stage":"CALENDAR_PRESENTATION","code":code}))
}
pub(super) fn invoke(header: Value, body: &[u8]) -> EngineBuffer {
    let registry = REGISTRY.get_or_init(SnapshotRegistry::default);
    let marker = match registry.utility_owner_marker() {
        Ok(value) => value,
        Err(_) => return failure("STALE_OWNER"),
    };
    let header: Header = match serde_json::from_value(header) {
        Ok(value) => value,
        Err(_) => return failure("INVALID_CALENDAR_COMMAND"),
    };
    let Presentation::Presentation = header.kind;
    if header.wire_schema_version != contract::SCHEMA_VERSION
        || header.expected_engine_version != crate::ENGINE_VERSION
        || header.calculation_contract_version != contract::CONTRACT_VERSION
        || header.guard.snapshot().is_some()
        || header.guard.validate().is_err()
    {
        return failure("INVALID_CALENDAR_COMMAND");
    }
    let lease = match registry.lease_utility(&marker, &header.guard, UtilityKind::CalendarWindow) {
        Ok(value) => value,
        Err(_) => return failure("STALE_OWNER_OR_REVISION"),
    };
    let result = if header.command.kind == "PROFILE_ROLE_QUERY" {
        super::profile_role::execute(body, &header.guard)
    } else if matches!(
        header.command.kind.as_str(),
        "DAY_DETAILS_CANDIDATES" | "DAY_DETAILS"
    ) {
        super::day_details::execute(&header.command.kind, body, marker, &header.guard)
    } else if matches!(
        header.command.kind.as_str(),
        "CATALOG_CANDIDATES" | "HIGHLIGHTS"
    ) {
        super::highlights::execute(&header.command.kind, body, marker, &header.guard)
    } else {
        execute(&header.command.kind, body)
    };
    let value = match result {
        Ok(value) => value,
        Err(code) => return failure(code),
    };
    let reply = versioned(
        json!({"ok":true,"state":"CALENDAR_PRESENTED","guard":header.guard,"command":header.command.kind,"value":value}),
    );
    if crate::report::cache_budget::serialized_bytes(&reply, 33_554_432).is_none() {
        return failure("OUTPUT_LIMIT");
    }
    let bytes = match serde_json::to_vec(&reply) {
        Ok(value) => value,
        Err(_) => return failure("OUTPUT_LIMIT"),
    };
    let buffer = if bytes.len() > MAX_OUTPUT_BYTES {
        output_form_bytes(bytes)
    } else {
        output_bytes(bytes)
    };
    if !lease.is_current().unwrap_or(false) {
        if buffer.handle != 0 {
            luna_engine_release_buffer(buffer.handle);
        }
        return failure("STALE_OWNER_OR_REVISION");
    }
    buffer
}
