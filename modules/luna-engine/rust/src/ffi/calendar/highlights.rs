use super::*;
use crate::contract::{SourceKind, assembly::SnapshotAssembly, utility::UtilityGuard};
use crate::runtime::{
    day_details_source::NativeDayDetailsReadAssembly, utility_lease::UtilityOwnerMarker,
    write_resource::WriteContextStamp,
};
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    observed_epoch_milliseconds: i64,
    stamp: Value,
    selected_package_ids: Value,
    sources: Vec<Group>,
    catalogs: Vec<Group>,
    start_date: String,
    end_date: String,
    #[serde(default)]
    platform_collation_ranks: Value,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Group {
    pub(super) kind: String,
    state: String,
    presence: String,
    value: Option<Value>,
}
pub(super) struct PreparedRead {
    pub(super) assembly: NativeDayDetailsReadAssembly,
    pub(super) epoch: i64,
    pub(super) ranks: Value,
    start_date: String,
    end_date: String,
}
pub(super) fn supply(
    assembly: &mut SnapshotAssembly,
    group: Group,
    catalog: bool,
    revision: u64,
) -> Result<(), &'static str> {
    let state = match (group.state.as_str(), group.presence.as_str(), &group.value) {
        ("NOT_REQUESTED", _, None) => json!({"state":"NOT_REQUESTED"}),
        ("LOADING", _, None) => json!({"state":"LOADING"}),
        ("FAILED", _, None) => json!({"state":"FAILED","code":"READ_FAILED"}),
        ("READY", "NULL", None) => {
            json!({"state":"READY","revision":revision,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"NULL"}}})
        }
        ("READY", "VALUE", Some(_)) => {
            json!({"state":"READY","revision":revision,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}})
        }
        _ => return Err("INVALID_CALENDAR_INPUT"),
    };
    let header = serde_json::to_vec(&json!({"kind":group.kind,"source":state}))
        .map_err(|_| "INVALID_CALENDAR_INPUT")?;
    let raw = group
        .value
        .map(|v| serde_json::to_vec(&v))
        .transpose()
        .map_err(|_| "INVALID_CALENDAR_INPUT")?
        .unwrap_or_default();
    if catalog {
        assembly.catalog(&header, &raw)
    } else {
        assembly.source(&header, &raw)
    }
    .map_err(|_| "INVALID_CALENDAR_INPUT")
}
pub(super) fn prepare(
    raw: &[u8],
    owner: UtilityOwnerMarker,
    guard: &UtilityGuard,
) -> Result<PreparedRead, &'static str> {
    let input: Input =
        serde_json::from_value(contract::bounded_json(raw).map_err(|_| "INVALID_CALENDAR_INPUT")?)
            .map_err(|_| "INVALID_CALENDAR_INPUT")?;
    if input.sources.len() != 5 || input.catalogs.len() != 3 {
        return Err("INVALID_CALENDAR_INPUT");
    }
    for group in &input.sources {
        let source: SourceKind =
            serde_json::from_value(json!(group.kind)).map_err(|_| "INVALID_CALENDAR_INPUT")?;
        if !matches!(
            source,
            SourceKind::WorkProfile
                | SourceKind::RemunerationProfiles
                | SourceKind::WorkingTimeTarget
                | SourceKind::WorkPatternSettings
                | SourceKind::YouthPreference
        ) {
            return Err("INVALID_CALENDAR_INPUT");
        }
    }
    let header = serde_json::to_vec(&json!({"ownerScope":guard.owner_scope(),"ownerEpoch":guard.owner_epoch(),"snapshotId":"calendar-presentation","snapshotRevision":guard.draft_revision(),"selectedPackageIds":input.selected_package_ids,"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}})).map_err(|_| "INVALID_CALENDAR_INPUT")?;
    let mut assembly = SnapshotAssembly::begin(&header).map_err(|_| "INVALID_CALENDAR_INPUT")?;
    for group in input.sources {
        supply(&mut assembly, group, false, guard.draft_revision())?;
    }
    for group in input.catalogs {
        supply(&mut assembly, group, true, guard.draft_revision())?;
    }
    let stamp = WriteContextStamp::from_raw(&input.stamp).map_err(|_| "INVALID_CALENDAR_INPUT")?;
    let mut assembly = NativeDayDetailsReadAssembly::new(
        owner,
        stamp,
        assembly,
        input.observed_epoch_milliseconds,
    )
    .map_err(|_| "INVALID_CALENDAR_INPUT")?;
    assembly.prepare().map_err(|_| "INVALID_CALENDAR_INPUT")?;
    Ok(PreparedRead {
        assembly,
        epoch: input.observed_epoch_milliseconds,
        ranks: input.platform_collation_ranks,
        start_date: input.start_date,
        end_date: input.end_date,
    })
}
pub(super) fn execute(
    kind: &str,
    raw: &[u8],
    owner: UtilityOwnerMarker,
    guard: &UtilityGuard,
) -> Result<Value, &'static str> {
    let prepared = prepare(raw, owner, guard)?;
    if kind == "CATALOG_CANDIDATES" {
        return serde_json::to_value(
            prepared
                .assembly
                .catalog_candidates()
                .map_err(|_| "INVALID_CALENDAR_INPUT")?,
        )
        .map_err(|_| "OUTPUT_LIMIT");
    }
    let ranks = serde_json::to_vec(&prepared.ranks).map_err(|_| "INVALID_CALENDAR_INPUT")?;
    let context = prepared
        .assembly
        .finish(&ranks)
        .map_err(|_| "INVALID_CALENDAR_INPUT")?;
    context
        .calendar_highlights(&prepared.start_date, &prepared.end_date, prepared.epoch)
        .map_err(|_| "INVALID_CALENDAR_INPUT")
}
