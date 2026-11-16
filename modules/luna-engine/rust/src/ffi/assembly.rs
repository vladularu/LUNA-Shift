//! Raw source transport. Only tiny metadata is reconstructed; source JSON is
//! borrowed unchanged and parsed on the native preparation worker.
use super::*;
use crate::runtime::assembly::{AssemblyError, BuilderId, SnapshotAssemblyPool, SourceTarget};
use serde::Deserialize;

static ASSEMBLIES: OnceLock<SnapshotAssemblyPool> = OnceLock::new();
const MAX_HEADER_BYTES: usize = 128 * 1024;
pub(super) fn pool() -> &'static SnapshotAssemblyPool {
    ASSEMBLIES.get_or_init(|| {
        SnapshotAssemblyPool::new(REGISTRY.get_or_init(SnapshotRegistry::default).clone())
    })
}
pub(super) fn collect() -> Result<u32, AssemblyError> {
    ASSEMBLIES
        .get()
        .map_or(Ok(0), SnapshotAssemblyPool::collect_retired)
}
pub(super) fn failure(error: AssemblyError) -> Value {
    match error {
        AssemblyError::Contract(error) => contract_error(error),
        AssemblyError::Registry(error) => registry_error(error),
        AssemblyError::Busy => json!({"ok":false,"stage":"ASSEMBLY","code":"BUSY"}),
        AssemblyError::UnknownBuilder => {
            json!({"ok":false,"stage":"ASSEMBLY","code":"UNKNOWN_BUILDER"})
        }
        AssemblyError::Capacity => json!({"ok":false,"stage":"ASSEMBLY","code":"CAPACITY"}),
        AssemblyError::SequenceExhausted => {
            json!({"ok":false,"stage":"ASSEMBLY","code":"SEQUENCE_EXHAUSTED"})
        }
        AssemblyError::Poisoned => json!({"ok":false,"stage":"ASSEMBLY","code":"POISONED"}),
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceFrame {
    builder_id: u64,
    target: SourceTarget,
    group: Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BuilderFrame {
    builder_id: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CalendarPageFrame {
    builder_id: u64,
    #[serde(deserialize_with = "required_cursor")]
    after: Option<u32>,
    limit: u16,
}
fn required_cursor<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<u32>, D::Error> {
    Option::<u32>::deserialize(deserializer)
}
pub(super) fn builder_command(bytes: &[u8]) -> Result<BuilderId, ContractError> {
    if bytes.len() > 1024 {
        return Err(ContractError::InputTooLarge);
    }
    let command: BuilderFrame = serde_json::from_value(contract::bounded_json(bytes)?)
        .map_err(|_| ContractError::MalformedEnvelope)?;
    BuilderId::from_wire(command.builder_id).ok_or(ContractError::MalformedEnvelope)
}
/// Worker-only. Input remains readable for the synchronous call.
/// # Safety
/// See `ffi::input`; header length is checked before dereferencing.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_snapshot_begin(
    bytes: *const u8,
    length: usize,
) -> EngineBuffer {
    guarded(|| {
        if length > MAX_HEADER_BYTES {
            return contract_error(ContractError::InputTooLarge);
        }
        let header = match unsafe { input(bytes, length) } {
            Ok(v) => v,
            Err(e) => return contract_error(e),
        };
        match pool().begin(header) {
            Ok(id) => json!({"ok":true,"state":"BUILDING","builderId":id.value()}),
            Err(error) => failure(error),
        }
    })
}
/// Worker-only. No source data is escaped into another JSON string document.
/// # Safety
/// Both nonempty ranges must be readable until this synchronous call returns.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_snapshot_source(
    header: *const u8,
    header_length: usize,
    data: *const u8,
    data_length: usize,
) -> EngineBuffer {
    guarded(|| {
        if header_length > MAX_HEADER_BYTES || data_length > contract::MAX_INPUT_BYTES as usize {
            return contract_error(ContractError::InputTooLarge);
        }
        let header = match unsafe { input(header, header_length) } {
            Ok(v) => v,
            Err(e) => return contract_error(e),
        };
        let body = match unsafe { input(data, data_length) } {
            Ok(v) => v,
            Err(e) => return contract_error(e),
        };
        let frame: SourceFrame = match contract::bounded_json(header)
            .and_then(|v| serde_json::from_value(v).map_err(|_| ContractError::MalformedEnvelope))
        {
            Ok(v) => v,
            Err(e) => return contract_error(e),
        };
        let Some(id) = BuilderId::from_wire(frame.builder_id) else {
            return contract_error(ContractError::MalformedEnvelope);
        };
        let group = match serde_json::to_vec(&frame.group) {
            Ok(v) => v,
            Err(_) => return contract_error(ContractError::MalformedEnvelope),
        };
        match pool().source_frame(id, frame.target, &group, body, header_length) {
            Ok(()) => json!({"ok":true,"state":"SOURCE_ADDED","builderId":id.value()}),
            Err(error) => failure(error),
        }
    })
}
/// Worker-only validation/hash/registration.
/// # Safety
/// Nonempty bytes must be readable for the synchronous call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_snapshot_seal(
    bytes: *const u8,
    length: usize,
) -> EngineBuffer {
    guarded(|| {
        if length > 1024 {
            return contract_error(ContractError::InputTooLarge);
        }
        let id = match unsafe { input(bytes, length) }.and_then(builder_command) {
            Ok(v) => v,
            Err(e) => return contract_error(e),
        };
        match pool().seal(id) {
            Ok(snapshot) => json!({"ok":true,"state":"REGISTERED","identity":snapshot.identity()}),
            Err(error) => failure(error),
        }
    })
}
/// Tiny cancellation only; detached source owners are dropped by collect_retired.
/// # Safety
/// Nonempty bytes must be readable for the synchronous call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_snapshot_abort(
    bytes: *const u8,
    length: usize,
) -> EngineBuffer {
    guarded(|| {
        if length > 1024 {
            return contract_error(ContractError::InputTooLarge);
        }
        let id = match unsafe { input(bytes, length) }.and_then(builder_command) {
            Ok(v) => v,
            Err(e) => return contract_error(e),
        };
        match pool().abort(id) {
            Ok(aborted) => json!({"ok":true,"state":"ABORTED","aborted":aborted}),
            Err(error) => failure(error),
        }
    })
}
/// Worker-only, small cursor request over one retained native candidate index.
/// # Safety
/// The bounded input must remain readable for this synchronous call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_snapshot_calendar_candidates(
    bytes: *const u8,
    length: usize,
) -> EngineBuffer {
    guarded(|| {
        if length > 1024 {
            return contract_error(ContractError::InputTooLarge);
        }
        let frame: CalendarPageFrame = match unsafe { input(bytes, length) }
            .and_then(contract::bounded_json)
            .and_then(|value| {
                serde_json::from_value(value).map_err(|_| ContractError::MalformedEnvelope)
            }) {
            Ok(value) => value,
            Err(error) => return contract_error(error),
        };
        let Some(id) = BuilderId::from_wire(frame.builder_id) else {
            return contract_error(ContractError::MalformedEnvelope);
        };
        match pool().calendar_candidates(id, frame.after, frame.limit) {
            Ok(page) => json!({"ok":true,"state":"CALENDAR_CANDIDATES","page":page}),
            Err(error) => failure(error),
        }
    })
}
/// Worker-only platform-rank insertion. The large original rank JSON is a
/// separate input range, never parsed/re-encoded by the host UI adapter.
/// # Safety
/// Both nonempty byte ranges must remain readable until this call returns.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_snapshot_calendar_ranks(
    header: *const u8,
    header_length: usize,
    data: *const u8,
    data_length: usize,
) -> EngineBuffer {
    guarded(|| {
        if header_length > 1024 || data_length > contract::MAX_INPUT_BYTES as usize {
            return contract_error(ContractError::InputTooLarge);
        }
        let id = match unsafe { input(header, header_length) }.and_then(builder_command) {
            Ok(value) => value,
            Err(error) => return contract_error(error),
        };
        let ranks = match unsafe { input(data, data_length) } {
            Ok(value) => value,
            Err(error) => return contract_error(error),
        };
        match pool().calendar_ranks_frame(id, ranks, header_length) {
            Ok(()) => json!({"ok":true,"state":"CALENDAR_RANKS_BOUND"}),
            Err(error) => failure(error),
        }
    })
}
