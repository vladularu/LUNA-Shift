use crate::{Output, Request, calculate, validate};
use serde::{Deserialize, Serialize};
use std::ffi::{CString, c_char};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::time::Instant;

pub(crate) const MAX_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const ENGINE_VERSION: &str = "luna-rest-native-v1";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Batch {
    schema_version: u32,
    request_id: String,
    requests: Vec<Request>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Reply {
    schema_version: u32,
    engine_version: &'static str,
    request_id: String,
    results: Vec<Output>,
    parse_ms: f64,
    validation_ms: f64,
    kernel_ms: f64,
}

fn evaluate(bytes: &[u8]) -> Result<Reply, &'static str> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("INPUT_LIMIT");
    }
    let started = Instant::now();
    let batch: Batch = serde_json::from_slice(bytes).map_err(|_| "INVALID_JSON")?;
    let parse_ms = started.elapsed().as_secs_f64() * 1000.0;
    let started = Instant::now();
    if batch.schema_version != 1
        || batch.request_id.is_empty()
        || batch.request_id.len() > 80
        || batch.requests.is_empty()
        || batch.requests.len() > 12
        || batch
            .requests
            .iter()
            .map(|r| r.intervals.len())
            .sum::<usize>()
            > 12_000
    {
        return Err("INVALID_BATCH");
    }
    for request in &batch.requests {
        if request.days.len() > 1000
            || request.shifts.len() > 5000
            || request.intervals.len() > 5000
            || request.holidays.len() > 1000
            || request.id.len() > 80
            || request.time_zone.len() > 100
        {
            return Err("REQUEST_LIMIT");
        }
        validate(request).map_err(|_| "INVALID_REQUEST")?;
    }
    let validation_ms = started.elapsed().as_secs_f64() * 1000.0;
    let started = Instant::now();
    let results = batch.requests.iter().map(calculate).collect();
    Ok(Reply {
        schema_version: 1,
        engine_version: ENGINE_VERSION,
        request_id: batch.request_id,
        results,
        parse_ms,
        validation_ms,
        kernel_ms: started.elapsed().as_secs_f64() * 1000.0,
    })
}

fn response(bytes: &[u8]) -> String {
    match catch_unwind(AssertUnwindSafe(|| evaluate(bytes))) {
        Ok(Ok(reply)) => match serde_json::to_string(&reply) {
            Ok(json) if json.len() <= MAX_BYTES => json,
            _ => "{\"error\":\"OUTPUT_LIMIT\"}".into(),
        },
        Ok(Err(code)) => serde_json::json!({"error": code}).to_string(),
        Err(_) => "{\"error\":\"KERNEL_PANIC\"}".into(),
    }
}

/// Returns an owned UTF-8 JSON C string; release exactly once with luna_rest_free.
/// # Safety
/// A non-null input must point to `length` readable bytes for the call's duration.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_rest_run(input: *const u8, length: usize) -> *mut c_char {
    let json = if input.is_null() || length == 0 || length > MAX_BYTES {
        "{\"error\":\"INPUT_LIMIT\"}".into()
    } else {
        // SAFETY: checked bounds; Swift keeps its contiguous byte buffer alive.
        response(unsafe { std::slice::from_raw_parts(input, length) })
    };
    owned_response(json)
}

pub(crate) fn owned_response(json: String) -> *mut c_char {
    match CString::new(json) {
        Ok(value) => value.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

/// # Safety
/// `value` is null or a still-owned pointer returned by luna_rest_run; free once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_rest_free(value: *mut c_char) {
    if !value.is_null() {
        // SAFETY: ownership is transferred back exactly once by the Swift defer.
        drop(unsafe { CString::from_raw(value) });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CStr;

    #[test]
    fn rejects_malformed_inputs_without_unwinding() {
        for bytes in [&b""[..], &b"\xff"[..], &b"{}"[..]] {
            assert!(response(bytes).contains("error"));
        }
        let bytes = serde_json::to_vec(&serde_json::json!({
            "schemaVersion": 999, "requestId": "test", "requests": []
        }))
        .expect("test JSON");
        assert!(response(&bytes).contains("INVALID_BATCH"));
    }

    #[test]
    fn ffi_null_and_limit_are_checked_before_reading() {
        // SAFETY: null/oversized inputs are rejected before dereferencing.
        unsafe {
            for (input, length) in [(std::ptr::null(), 0), (b"x".as_ptr(), MAX_BYTES + 1)] {
                let reply = luna_rest_run(input, length);
                assert_eq!(
                    CStr::from_ptr(reply).to_bytes(),
                    b"{\"error\":\"INPUT_LIMIT\"}"
                );
                luna_rest_free(reply);
            }
            luna_rest_free(std::ptr::null_mut());
        }
    }
}
