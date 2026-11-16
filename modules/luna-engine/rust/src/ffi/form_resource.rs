//! Dedicated worker-only raw form channel. No source/report preparation or
//! domain policy lives in this adapter, and no JS calculation fallback exists.
use super::*;
use crate::runtime::form_resource::{
    FormResourceError, FormResourcePool, MAX_FORM_BODY_BYTES, MAX_FORM_HEADER_BYTES,
};

static FORMS: OnceLock<FormResourcePool> = OnceLock::new();
pub(super) fn collect() -> Result<bool, FormResourceError> {
    match FORMS.get() {
        Some(pool) => pool.collect_retired(),
        None => Ok(false),
    }
}
fn failure(error: FormResourceError) -> EngineBuffer {
    output(&json!({"ok":false,"stage":"FORM_RESOURCE","code":error.code()}))
}
fn publish(bytes: Vec<u8>, current: impl FnOnce() -> bool) -> EngineBuffer {
    let buffer = output_form_bytes(bytes);
    if !current() {
        if buffer.handle != 0 {
            luna_engine_release_buffer(buffer.handle);
        }
        return failure(FormResourceError::OwnerChanged);
    }
    buffer
}
/// Worker-only private form resource operation. The header and original raw
/// SQL body are independent bounded byte ranges. Copy output, then free once.
/// # Safety
/// Both nonempty inputs remain initialized and readable until this returns.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_form_resource(
    header: *const u8,
    header_length: usize,
    body: *const u8,
    body_length: usize,
) -> EngineBuffer {
    catch_unwind(AssertUnwindSafe(|| {
        if header_length > MAX_FORM_HEADER_BYTES || body_length > MAX_FORM_BODY_BYTES {
            return output(&contract_error(ContractError::InputTooLarge));
        }
        let registry = REGISTRY.get_or_init(SnapshotRegistry::default);
        // Capture the true owner lifecycle before touching or parsing either
        // supplied byte range. Never start global report preparation here.
        let marker = match registry.utility_owner_marker() {
            Ok(marker) => marker,
            Err(_) => return failure(FormResourceError::OwnerChanged),
        };
        // SAFETY: both ranges follow the exported caller lifetime contract;
        // the shared helper separately rejects null nonempty ranges.
        let header = match unsafe { input(header, header_length) } {
            Ok(bytes) => bytes,
            Err(error) => return output(&contract_error(error)),
        };
        // SAFETY: as above, including empty-body calls.
        let body = match unsafe { input(body, body_length) } {
            Ok(bytes) => bytes,
            Err(error) => return output(&contract_error(error)),
        };
        let prepared = match FORMS
            .get_or_init(FormResourcePool::new)
            .prepare(registry, &marker, header, body)
        {
            Ok(value) => value,
            Err(error) => return failure(error),
        };
        let bytes = match prepared.complete() {
            Ok(bytes) => bytes,
            Err(error) => return failure(error),
        };
        // Prepared remains alive through allocation and this final check.
        publish(bytes, || prepared.is_current().unwrap_or(false))
    }))
    .unwrap_or_else(|_| {
        output(&json!({"ok":false,"stage":"ENGINE","code":"INTERNAL_ENGINE_ERROR"}))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_publication_releases_the_large_slot_before_returning_a_safe_failure() {
        let buffer = publish(vec![b'x'; MAX_OUTPUT_BYTES + 1], || false);
        assert!(!buffer.bytes.is_null());
        // SAFETY: this live owned buffer is read before its single release.
        let value: Value = serde_json::from_slice(unsafe {
            std::slice::from_raw_parts(buffer.bytes, buffer.length)
        })
        .unwrap();
        assert_eq!(value["code"], "FORM_OWNER_CHANGED");
        assert!(POOL.get().unwrap().lock().unwrap().form.is_none());
        if buffer.handle != 0 {
            assert!(luna_engine_release_buffer(buffer.handle));
        }
    }
}
