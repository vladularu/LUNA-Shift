use super::*;
use crate::{
    contract::utility::{MAX_UTILITY_INPUT_BYTES, parse_utility_request},
    runtime::utility::{self, UtilityExecutionError},
};
fn fence(error: crate::runtime::utility_lease::UtilityFenceError) -> EngineBuffer {
    output(&json!({"ok":false,"stage":"UTILITY_FENCE","code":error}))
}
fn invoke(bytes: *const u8, length: usize) -> EngineBuffer {
    // Reject before touching the caller pointer, JSON, or lifecycle state.
    if length > MAX_UTILITY_INPUT_BYTES {
        return output(&contract_error(ContractError::InputTooLarge));
    }
    let registry = REGISTRY.get_or_init(SnapshotRegistry::default);
    // Capture arrival's owner lifecycle before any raw form parsing.
    let marker = match registry.utility_owner_marker() {
        Ok(marker) => marker,
        Err(error) => return fence(error),
    };
    // SAFETY: this private function is reached only under the exported ABI's
    // caller lifetime contract; the common helper also checks null and length.
    let request = match unsafe { input(bytes, length) }.and_then(parse_utility_request) {
        Ok(request) => request,
        Err(error) => return output(&contract_error(error)),
    };
    let completion = match utility::prepare(registry, &marker, &request) {
        Ok(completion) => completion,
        Err(error) => return fence(error),
    };
    let bytes = match completion.serialize_current() {
        Ok(bytes) => bytes,
        Err(UtilityExecutionError::Fence(error)) => return fence(error),
        Err(UtilityExecutionError::OutputLimit) => {
            return output(&json!({"ok":false,"stage":"UTILITY","code":"OUTPUT_LIMIT"}));
        }
    };
    let buffer = output_bytes(bytes);
    // A reset during serialization/pool allocation must not publish old bytes.
    // Host owner/draft fences still apply before any later external write.
    if !completion.is_current().unwrap_or(false) {
        if buffer.handle != 0 {
            luna_engine_release_buffer(buffer.handle);
        }
        return fence(crate::runtime::utility_lease::UtilityFenceError::Stale);
    }
    buffer
}
/// Worker-only, bounded utility execution on a separate platform utility queue.
/// Does not admit CALCULATE or replace the financial/check scheduling lanes.
/// # Safety
/// Nonempty input points to `length` initialized bytes retained until return.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_utility(bytes: *const u8, length: usize) -> EngineBuffer {
    catch_unwind(AssertUnwindSafe(|| invoke(bytes, length))).unwrap_or_else(|_| {
        output(&json!({"ok":false,"stage":"ENGINE","code":"INTERNAL_ENGINE_ERROR"}))
    })
}
