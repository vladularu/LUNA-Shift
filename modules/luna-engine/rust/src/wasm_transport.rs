//! String-only browser-worker transport over the same native C operations.
//! This module contains no alternative calculation, source normalization or
//! result arithmetic. The adapter must replace its worker after a wasm trap.
use crate::ffi::{self, EngineBuffer};

fn take(buffer: EngineBuffer) -> String {
    take_bounded(buffer, 4 * 1024 * 1024)
}
fn take_bounded(buffer: EngineBuffer, maximum: usize) -> String {
    let text = if buffer.bytes.is_null() || buffer.length > maximum {
        "{\"ok\":false,\"code\":\"INVALID_NATIVE_REPLY\"}".to_owned()
    } else {
        // SAFETY: only the matching C functions create this live descriptor;
        // its bytes are copied before its owned handle is released below.
        let bytes = unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) };
        std::str::from_utf8(bytes)
            .map(str::to_owned)
            .unwrap_or_else(|_| "{\"ok\":false,\"code\":\"INVALID_NATIVE_REPLY\"}".to_owned())
    };
    if buffer.handle != 0 {
        ffi::luna_engine_release_buffer(buffer.handle);
    }
    text
}

#[cfg_attr(all(target_family="wasm",target_os="unknown"),wasm_bindgen::prelude::wasm_bindgen(js_name=engineFormResource))]
pub fn engine_form_resource(header: &str, body: &str) -> String {
    // SAFETY: both borrowed strings remain readable through the native call.
    let buffer = unsafe {
        ffi::luna_engine_form_resource(header.as_ptr(), header.len(), body.as_ptr(), body.len())
    };
    take_bounded(buffer, crate::runtime::form_resource::MAX_FORM_REPLY_BYTES)
}

#[cfg_attr(all(target_family="wasm",target_os="unknown"),wasm_bindgen::prelude::wasm_bindgen(js_name=engineInvoke))]
pub fn engine_invoke(operation: &str, payload: &str) -> String {
    let bytes = payload.as_bytes();
    let buffer = match operation {
        "info" if bytes.is_empty() => ffi::luna_engine_info(),
        "reset" if bytes.is_empty() => ffi::luna_engine_reset(),
        "collectRetired" if bytes.is_empty() => ffi::luna_engine_collect_retired(),
        "runFinance" if bytes.is_empty() => ffi::luna_engine_run_next(0),
        "runChecks" if bytes.is_empty() => ffi::luna_engine_run_next(1),
        // SAFETY: the borrowed UTF-8 string is alive and readable for each
        // synchronous C operation. No caller pointer or ready result enters.
        "bindOwner" => unsafe { ffi::luna_engine_bind_owner(bytes.as_ptr(), bytes.len()) },
        "advanceRevision" => unsafe {
            ffi::luna_engine_advance_revision(bytes.as_ptr(), bytes.len())
        },
        "execute" => unsafe { ffi::luna_engine_execute(bytes.as_ptr(), bytes.len()) },
        "utility" => unsafe { ffi::luna_engine_utility(bytes.as_ptr(), bytes.len()) },
        "snapshotBegin" => unsafe { ffi::luna_engine_snapshot_begin(bytes.as_ptr(), bytes.len()) },
        "calendarBegin" => unsafe { ffi::luna_engine_calendar_begin(bytes.as_ptr(), bytes.len()) },
        "calendarSeal" => unsafe { ffi::luna_engine_calendar_seal(bytes.as_ptr(), bytes.len()) },
        "calendarAbort" => unsafe { ffi::luna_engine_calendar_abort(bytes.as_ptr(), bytes.len()) },
        "calendarWindowPrepare" => unsafe {
            ffi::luna_engine_calendar_window_prepare(bytes.as_ptr(), bytes.len())
        },
        "calendarWindowCandidates" => unsafe {
            ffi::luna_engine_calendar_window_candidates(bytes.as_ptr(), bytes.len())
        },
        "calendarWindowRead" => unsafe {
            ffi::luna_engine_calendar_window_read(bytes.as_ptr(), bytes.len())
        },
        "calendarWindowAbort" => unsafe {
            ffi::luna_engine_calendar_window_abort(bytes.as_ptr(), bytes.len())
        },
        "snapshotSeal" => unsafe { ffi::luna_engine_snapshot_seal(bytes.as_ptr(), bytes.len()) },
        "snapshotAbort" => unsafe { ffi::luna_engine_snapshot_abort(bytes.as_ptr(), bytes.len()) },
        "snapshotCalendarCandidates" => unsafe {
            ffi::luna_engine_snapshot_calendar_candidates(bytes.as_ptr(), bytes.len())
        },
        "snapshotCatalogCandidates" => unsafe {
            ffi::luna_engine_snapshot_catalog_candidates(bytes.as_ptr(), bytes.len())
        },
        "snapshotProfileClock" => unsafe {
            ffi::luna_engine_snapshot_profile_clock(bytes.as_ptr(), bytes.len())
        },
        "financialCollationPrepare" => unsafe {
            ffi::luna_engine_financial_collation_prepare(bytes.as_ptr(), bytes.len())
        },
        "financialCollationCandidates" => unsafe {
            ffi::luna_engine_financial_collation_candidates(bytes.as_ptr(), bytes.len())
        },
        "financialCollationAbort" => unsafe {
            ffi::luna_engine_financial_collation_abort(bytes.as_ptr(), bytes.len())
        },
        "admitFinance" => unsafe { ffi::luna_engine_admit(bytes.as_ptr(), bytes.len(), 0) },
        "admitChecks" => unsafe { ffi::luna_engine_admit(bytes.as_ptr(), bytes.len(), 1) },
        "cancelJob" => unsafe { ffi::luna_engine_cancel_job(bytes.as_ptr(), bytes.len()) },
        "snapshotDigests" => unsafe {
            ffi::luna_engine_snapshot_digests(bytes.as_ptr(), bytes.len())
        },
        "calendarCandidates" => unsafe {
            ffi::luna_engine_calendar_candidates(bytes.as_ptr(), bytes.len())
        },
        _ => return "{\"ok\":false,\"code\":\"INVALID_OPERATION\"}".to_owned(),
    };
    if matches!(operation, "runFinance" | "runChecks") {
        take_bounded(buffer, 32 * 1024 * 1024)
    } else {
        take(buffer)
    }
}

#[cfg_attr(all(target_family="wasm",target_os="unknown"),wasm_bindgen::prelude::wasm_bindgen(js_name=engineInvokeSource))]
pub fn engine_invoke_source(header: &str, source: &str) -> String {
    // SAFETY: the two borrowed strings outlive this synchronous native call.
    take(unsafe {
        ffi::luna_engine_snapshot_source(
            header.as_ptr(),
            header.len(),
            source.as_ptr(),
            source.len(),
        )
    })
}

#[cfg_attr(all(target_family="wasm",target_os="unknown"),wasm_bindgen::prelude::wasm_bindgen(js_name=engineInvokeCalendarSource))]
pub fn engine_invoke_calendar_source(header: &str, source: &str) -> String {
    // SAFETY: both original strings remain readable through the C call.
    take_bounded(
        unsafe {
            ffi::luna_engine_calendar_source(
                header.as_ptr(),
                header.len(),
                source.as_ptr(),
                source.len(),
            )
        },
        32 * 1024 * 1024,
    )
}
#[cfg_attr(all(target_family="wasm",target_os="unknown"),wasm_bindgen::prelude::wasm_bindgen(js_name=engineInvokeCalendarWindowFinalize))]
pub fn engine_invoke_calendar_window_finalize(header: &str, ranks: &str) -> String {
    // SAFETY: both original strings remain readable through the C call.
    take(unsafe {
        ffi::luna_engine_calendar_window_finalize(
            header.as_ptr(),
            header.len(),
            ranks.as_ptr(),
            ranks.len(),
        )
    })
}

#[cfg_attr(all(target_family="wasm",target_os="unknown"),wasm_bindgen::prelude::wasm_bindgen(js_name=engineInvokeCalendarRanks))]
pub fn engine_invoke_calendar_ranks(header: &str, ranks: &str) -> String {
    // SAFETY: the original strings remain readable for the complete call.
    take(unsafe {
        ffi::luna_engine_snapshot_calendar_ranks(
            header.as_ptr(),
            header.len(),
            ranks.as_ptr(),
            ranks.len(),
        )
    })
}

#[cfg_attr(all(target_family="wasm",target_os="unknown"),wasm_bindgen::prelude::wasm_bindgen(js_name=engineInvokeCatalogFinalize))]
pub fn engine_invoke_catalog_finalize(header: &str, ranks: &str) -> String {
    // SAFETY: both borrowed original strings outlive the synchronous C call.
    take(unsafe {
        ffi::luna_engine_snapshot_catalog_finalize(
            header.as_ptr(),
            header.len(),
            ranks.as_ptr(),
            ranks.len(),
        )
    })
}

#[cfg_attr(all(target_family="wasm",target_os="unknown"),wasm_bindgen::prelude::wasm_bindgen(js_name=engineInvokeFinancialCollationFinalize))]
pub fn engine_invoke_financial_collation_finalize(header: &str, ranks: &str) -> String {
    // SAFETY: both original strings remain readable through the native call.
    take(unsafe {
        ffi::luna_engine_financial_collation_finalize(
            header.as_ptr(),
            header.len(),
            ranks.as_ptr(),
            ranks.len(),
        )
    })
}
