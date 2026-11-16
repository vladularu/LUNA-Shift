use super::*;
macro_rules! operation {
    ($name:ident,$method:ident,$maximum:expr) => {
        /// Bounded worker-only prepared calendar operation.
        /// # Safety
        /// Nonempty caller bytes remain readable until this synchronous return.
        #[unsafe(no_mangle)]
        pub unsafe extern "C" fn $name(bytes: *const u8, length: usize) -> EngineBuffer {
            guarded_buffer(|| {
                if length > $maximum {
                    return output(&contract_error(ContractError::InputTooLarge));
                }
                let bytes = match unsafe { input(bytes, length) } {
                    Ok(v) => v,
                    Err(e) => return output(&contract_error(e)),
                };
                let completion = match window_pool().$method(bytes) {
                    Ok(c) => c,
                    Err(e) => return window_failure(e),
                };
                publication::publish(
                    completion.serialize_current(),
                    || completion.is_current(),
                    window_failure,
                    WindowPoolError::Stale,
                )
            })
        }
    };
}
operation!(luna_engine_calendar_window_prepare, prepare, 8192);
operation!(luna_engine_calendar_window_candidates, candidates, 1024);
operation!(luna_engine_calendar_window_read, read, 1024);
/// Original raw rank JSON on a worker; never a host-decoded map.
/// # Safety
/// Both nonempty UTF8 ranges remain readable until this synchronous return.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_calendar_window_finalize(
    header: *const u8,
    header_length: usize,
    ranks: *const u8,
    ranks_length: usize,
) -> EngineBuffer {
    guarded_buffer(|| {
        if header_length > 1024 || ranks_length > contract::MAX_INPUT_BYTES as usize {
            return output(&contract_error(ContractError::InputTooLarge));
        }
        let header = match unsafe { input(header, header_length) } {
            Ok(v) => v,
            Err(e) => return output(&contract_error(e)),
        };
        let ranks = match unsafe { input(ranks, ranks_length) } {
            Ok(v) => v,
            Err(e) => return output(&contract_error(e)),
        };
        let completion = match window_pool().finalize(header, ranks) {
            Ok(c) => c,
            Err(e) => return window_failure(e),
        };
        publication::publish(
            completion.serialize_current(),
            || completion.is_current(),
            window_failure,
            WindowPoolError::Stale,
        )
    })
}
/// Tiny control cancellation; resource owners are destroyed by worker GC.
/// # Safety
/// Nonempty caller bytes remain readable until this synchronous return.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_calendar_window_abort(
    bytes: *const u8,
    length: usize,
) -> EngineBuffer {
    guarded_buffer(|| {
        if length > 1024 {
            return output(&contract_error(ContractError::InputTooLarge));
        }
        let bytes = match unsafe { input(bytes, length) } {
            Ok(v) => v,
            Err(e) => return output(&contract_error(e)),
        };
        match window_pool().abort(bytes) {
            Ok(aborted) => output(&versioned(
                json!({"ok":true,"state":"CALENDAR_WINDOW_ABORTED","aborted":aborted}),
            )),
            Err(e) => window_failure(e),
        }
    })
}
