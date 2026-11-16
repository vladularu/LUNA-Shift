use super::*;
use crate::{
    contract::{SourceKind, utility::UtilityGuard},
    input::profile_editor::EditorSection,
    runtime::write_resource::WriteContextStamp,
};
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Request {
    pub wire_schema_version: u32,
    pub expected_engine_version: String,
    pub calculation_contract_version: String,
    pub guard: UtilityGuard,
    pub command: Command,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Group {
    pub kind: SourceKind,
    pub source: Value,
}
#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(super) enum Command {
    BeginDayDetails {
        stamp: WriteContextStamp,
        observed_epoch_milliseconds: i64,
        date: String,
    },
    DayDetailsSource {
        builder_id: u64,
        group: Group,
    },
    DayDetailsCatalog {
        builder_id: u64,
        group: Value,
    },
    PrepareDayDetails {
        builder_id: u64,
    },
    DayDetailsCandidates {
        builder_id: u64,
        family: super::day_details::Family,
        offset: u32,
    },
    DayDetailsCalendarRanks {
        builder_id: u64,
    },
    OpenDayDetails {
        builder_id: u64,
        observed_epoch_milliseconds: i64,
    },
    DayDetailsRows {
        resource_id: u64,
        resource_revision: u64,
        observed_epoch_milliseconds: i64,
        offset: u32,
        limit: u32,
    },
    BeginDayEditor {
        stamp: WriteContextStamp,
        observed_epoch_milliseconds: i64,
        request: crate::runtime::day_editor_source::DayEditorOpenRequest,
        appearance: Value,
    },
    DaySource {
        builder_id: u64,
        group: super::day::Group,
    },
    OpenDayEditor {
        builder_id: u64,
    },
    DayEvent {
        resource_id: u64,
        resource_revision: u64,
        observed_epoch_milliseconds: i64,
        event: super::day::Event,
    },
    BeginPayroll {
        stamp: WriteContextStamp,
        observed_epoch_milliseconds: i64,
        locator: crate::contract::SnapshotIdentity,
        month: String,
        mode: crate::runtime::payroll_form::source::PayrollSourceMode,
    },
    PayrollEvent {
        resource_id: u64,
        resource_revision: u64,
        observed_epoch_milliseconds: i64,
        event: super::payroll::Event,
    },
    ProfileEvent {
        resource_id: u64,
        resource_revision: u64,
        observed_epoch_milliseconds: i64,
        event: super::profile::Event,
    },
    WriteContext {
        resource_id: u64,
        resource_revision: u64,
        write_id: u64,
        stamp: WriteContextStamp,
        observed_epoch_milliseconds: i64,
        #[serde(default, deserialize_with = "optional_allocated_id")]
        allocated_id: Option<String>,
    },
    TakeWrite {
        resource_id: u64,
        resource_revision: u64,
        write_id: u64,
    },
    AckWrite {
        resource_id: u64,
        resource_revision: u64,
        write_id: u64,
        stamp: WriteContextStamp,
        observed_epoch_milliseconds: i64,
    },
    AbortWrite {
        resource_id: u64,
        resource_revision: u64,
        write_id: u64,
        failure: super::profile::IoFailure,
        observed_epoch_milliseconds: i64,
    },

    BeginProfile {
        stamp: WriteContextStamp,
        observed_epoch_milliseconds: i64,
        section: EditorSection,
        from_more: bool,
    },
    Source {
        builder_id: u64,
        group: Group,
    },
    OpenProfile {
        builder_id: u64,
    },
    CloseBuilder {
        builder_id: u64,
    },
    CloseResource {
        resource_id: u64,
    },
}
pub(super) fn parse(bytes: &[u8]) -> Result<Request, FormResourceError> {
    let raw = crate::contract::bounded_json(bytes).map_err(|_| FormResourceError::InvalidHeader)?;
    let r: Request = serde_json::from_value(raw).map_err(|_| FormResourceError::InvalidHeader)?;
    if r.wire_schema_version != crate::contract::SCHEMA_VERSION {
        return Err(FormResourceError::UnsupportedSchema);
    }
    if r.expected_engine_version != crate::ENGINE_VERSION {
        return Err(FormResourceError::UnsupportedEngine);
    }
    if r.calculation_contract_version != crate::contract::CONTRACT_VERSION {
        return Err(FormResourceError::UnsupportedContract);
    }
    r.guard
        .validate()
        .map_err(|_| FormResourceError::InvalidHeader)?;
    if r.guard.snapshot().is_some() {
        return Err(FormResourceError::InvalidHeader);
    }
    Ok(r)
}
fn optional_allocated_id<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    String::deserialize(deserializer).map(Some)
}
