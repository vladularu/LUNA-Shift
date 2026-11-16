//! Retained M3 Raw3 query on the existing owner-only calendar raw channel.
use super::*;
use crate::{
    contract::{SourceKind, assembly::SnapshotAssembly, utility::UtilityGuard},
    runtime::ProfileClockEnvironment,
};
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    source_clock_key: String,
    source_epoch_milliseconds: i64,
    render_epoch_milliseconds: f64,
    date: Option<String>,
    sources: Vec<super::highlights::Group>,
}
pub(super) fn execute(raw: &[u8], guard: &UtilityGuard) -> Result<Value, &'static str> {
    let input: Input = serde_json::from_value(
        contract::bounded_json(raw).map_err(|_| "INVALID_PROFILE_ROLE_INPUT")?,
    )
    .map_err(|_| "INVALID_PROFILE_ROLE_INPUT")?;
    if input.sources.len() != 3 {
        return Err("INVALID_PROFILE_ROLE_INPUT");
    }
    for group in &input.sources {
        if !matches!(
            group.kind.as_str(),
            "WORK_PROFILE" | "REMUNERATION_PROFILES" | "WORK_PATTERN_SETTINGS"
        ) {
            return Err("INVALID_PROFILE_ROLE_INPUT");
        }
    }
    let header = serde_json::to_vec(&json!({"ownerScope":guard.owner_scope(),"ownerEpoch":guard.owner_epoch(),"snapshotId":"provided-role-query","snapshotRevision":guard.draft_revision(),"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}})).map_err(|_| "INVALID_PROFILE_ROLE_INPUT")?;
    // Local source decoding only. Never registers/replaces an R0 snapshot.
    let mut source = SnapshotAssembly::begin(&header).map_err(|_| "INVALID_PROFILE_ROLE_INPUT")?;
    for group in input.sources {
        super::highlights::supply(&mut source, group, false, guard.draft_revision())
            .map_err(|_| "INVALID_PROFILE_ROLE_INPUT")?;
    }
    let env = ProfileClockEnvironment::from_states(
        guard.owner_scope(),
        source.source_state(SourceKind::WorkProfile),
        source.source_state(SourceKind::RemunerationProfiles),
        input.source_epoch_milliseconds,
    )
    .map_err(|_| "PROFILE_ROLE_SOURCE_UNAVAILABLE")?;
    if env.source_clock_key() != input.source_clock_key {
        return Err("PROFILE_ROLE_SOURCE_MISMATCH");
    }
    let provider = env
        .editor_profile(source.source_state(SourceKind::WorkPatternSettings))
        .map_err(|_| "PROFILE_ROLE_SOURCE_UNAVAILABLE")?;
    crate::input::template_editor::tariff_query(
        provider.as_deref().unwrap_or(&Value::Null),
        input.date.as_deref(),
        input.render_epoch_milliseconds,
    )
    .map_err(|_| "INVALID_PROFILE_ROLE_INPUT")
}
