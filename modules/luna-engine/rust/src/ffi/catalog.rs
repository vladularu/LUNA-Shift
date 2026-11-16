//! Tiny metadata and original rank bytes stay separate. Full catalog admission
//! and selection are native builder operations, never host-created Ready flags.
use super::assembly::{builder_command, failure, pool};
use super::*;
use crate::runtime::assembly::BuilderId;
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PageFrame {
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
/// Worker-only bounded metadata page over one native prepared catalog.
/// # Safety
/// Nonempty bytes point to `length` readable initialized bytes until return.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_snapshot_catalog_candidates(
    bytes: *const u8,
    length: usize,
) -> EngineBuffer {
    guarded(|| {
        if length > 1024 {
            return contract_error(ContractError::InputTooLarge);
        }
        let frame: PageFrame = match unsafe { input(bytes, length) }
            .and_then(contract::bounded_json)
            .and_then(|value| {
                serde_json::from_value(value).map_err(|_| ContractError::MalformedEnvelope)
            }) {
            Ok(frame) => frame,
            Err(error) => return contract_error(error),
        };
        let Some(id) = BuilderId::from_wire(frame.builder_id) else {
            return contract_error(ContractError::MalformedEnvelope);
        };
        match pool().catalog_candidates(id, frame.after, frame.limit) {
            Ok(value) => value,
            Err(error) => failure(error),
        }
    })
}
/// Worker-only native selection and original locale-rank binding.
/// # Safety
/// Both nonempty input ranges remain readable until this synchronous call returns.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_snapshot_catalog_finalize(
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
            Ok(id) => id,
            Err(error) => return contract_error(error),
        };
        let ranks = match unsafe { input(data, data_length) } {
            Ok(ranks) => ranks,
            Err(error) => return contract_error(error),
        };
        match pool().catalog_finalize_frame(id, ranks, header_length) {
            Ok(value) => value,
            Err(error) => failure(error),
        }
    })
}
