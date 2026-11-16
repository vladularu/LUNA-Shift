//! Tiny original instant metadata; profile selection and clock facts remain in
//! the private native builder and are never accepted as host Ready data.
use super::assembly::{failure, pool};
use super::*;
use crate::runtime::assembly::BuilderId;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Frame {
    builder_id: u64,
    epoch_milliseconds: i64,
}

/// Worker-only pre-seal clock over this builder's immutable raw sources.
/// # Safety
/// Nonempty bytes point to `length` initialized readable bytes until return.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_snapshot_profile_clock(
    bytes: *const u8,
    length: usize,
) -> EngineBuffer {
    guarded(|| {
        if length > 1024 {
            return contract_error(ContractError::InputTooLarge);
        }
        let frame: Frame = match unsafe { input(bytes, length) }
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
        match pool().profile_clock(id, frame.epoch_milliseconds) {
            Ok(value) => value,
            Err(error) => failure(error),
        }
    })
}
