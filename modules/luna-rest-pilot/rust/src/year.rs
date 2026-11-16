//! Compact annual transport: immutable shared pools and explicit legal windows.
use crate::ffi::{MAX_BYTES, owned_response};
use crate::{Day, Interval, Output, Request, Shift, calculate, validate};
use serde::{Deserialize, Serialize};
use std::ffi::c_char;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::time::Instant;

const ENGINE_VERSION: &str = "luna-rest-year-v1";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PackedRequest {
    schema_version: u32,
    id: String,
    month: String,
    time_zone: String,
    coverage_start: i32,
    coverage_end: i32,
    sunday_period_days: i32,
    holiday_period_days: i32,
    required_rest_minutes: i64,
    evidence_shift_type: String,
    days: Vec<usize>,
    holidays: Vec<i32>,
    shifts: Vec<usize>,
    intervals: Vec<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Batch {
    schema_version: u32,
    request_id: String,
    days: Vec<Day>,
    shifts: Vec<Shift>,
    intervals: Vec<Interval>,
    requests: Vec<PackedRequest>,
}

fn select<T: Clone>(pool: &[T], indices: &[usize]) -> Result<Vec<T>, &'static str> {
    indices
        .iter()
        .map(|&i| pool.get(i).cloned().ok_or("INVALID_REFERENCE"))
        .collect()
}

impl Batch {
    fn expand(&self) -> Result<Vec<Request>, &'static str> {
        if self.schema_version != 2
            || self.request_id.is_empty()
            || self.request_id.len() > 80
            || self.requests.is_empty()
            || self.requests.len() > 64
            || self.days.len() > 4000
            || self.shifts.len() > 5000
            || self.intervals.len() > 5000
            || self.requests.iter().map(|r| r.days.len()).sum::<usize>() > 16_000
            || self.requests.iter().map(|r| r.shifts.len()).sum::<usize>() > 32_000
            || self
                .requests
                .iter()
                .map(|r| r.intervals.len())
                .sum::<usize>()
                > 12_000
        {
            return Err("YEAR_LIMIT");
        }
        let mut ids = std::collections::HashSet::new();
        self.requests
            .iter()
            .map(|r| {
                if r.id.len() > 80
                    || r.time_zone.len() > 100
                    || r.days.len() > 1000
                    || r.shifts.len() > 5000
                    || r.intervals.len() > 5000
                    || r.holidays.len() > 1000
                    || !ids.insert(r.id.as_str())
                {
                    return Err("REQUEST_LIMIT");
                }
                let request = Request {
                    schema_version: r.schema_version,
                    id: r.id.clone(),
                    month: r.month.clone(),
                    time_zone: r.time_zone.clone(),
                    coverage_start: r.coverage_start,
                    coverage_end: r.coverage_end,
                    sunday_period_days: r.sunday_period_days,
                    holiday_period_days: r.holiday_period_days,
                    required_rest_minutes: r.required_rest_minutes,
                    evidence_shift_type: r.evidence_shift_type.clone(),
                    days: select(&self.days, &r.days)?,
                    holidays: r.holidays.clone(),
                    shifts: select(&self.shifts, &r.shifts)?,
                    intervals: select(&self.intervals, &r.intervals)?,
                };
                validate(&request).map_err(|_| "INVALID_REQUEST")?;
                Ok(request)
            })
            .collect()
    }
}

#[derive(Serialize)]
struct ResultItem {
    id: String,
    result: Output,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Reply {
    schema_version: u32,
    engine_version: &'static str,
    request_id: String,
    results: Vec<ResultItem>,
    parse_ms: f64,
    validation_ms: f64,
    kernel_ms: f64,
}

fn evaluate(bytes: &[u8]) -> Result<String, &'static str> {
    let started = Instant::now();
    let batch: Batch = serde_json::from_slice(bytes).map_err(|_| "INVALID_JSON")?;
    let parse_ms = started.elapsed().as_secs_f64() * 1000.0;
    let started = Instant::now();
    let requests = batch.expand()?;
    let validation_ms = started.elapsed().as_secs_f64() * 1000.0;
    let started = Instant::now();
    let results = requests
        .iter()
        .map(|r| ResultItem {
            id: r.id.clone(),
            result: calculate(r),
        })
        .collect();
    let reply = Reply {
        schema_version: 2,
        engine_version: ENGINE_VERSION,
        request_id: batch.request_id,
        results,
        parse_ms,
        validation_ms,
        kernel_ms: started.elapsed().as_secs_f64() * 1000.0,
    };
    let json = serde_json::to_string(&reply).map_err(|_| "OUTPUT_ENCODING")?;
    if json.len() > MAX_BYTES {
        return Err("OUTPUT_LIMIT");
    }
    Ok(json)
}

/// # Safety
/// Non-null input points to `length` readable bytes until this call returns.
/// Release the owned response once with luna_rest_free, as for the legacy ABI.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_rest_year_run(input: *const u8, length: usize) -> *mut c_char {
    let json = if input.is_null() || length == 0 || length > MAX_BYTES {
        "{\"error\":\"INPUT_LIMIT\"}".into()
    } else {
        // SAFETY: bounded input; the Swift caller holds its contiguous bytes alive.
        let bytes = unsafe { std::slice::from_raw_parts(input, length) };
        match catch_unwind(AssertUnwindSafe(|| evaluate(bytes))) {
            Ok(Ok(reply)) => reply,
            Ok(Err(code)) => serde_json::json!({"error":code}).to_string(),
            Err(_) => "{\"error\":\"KERNEL_PANIC\"}".into(),
        }
    };
    owned_response(json)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_pool_references() {
        assert!(select(&[1, 2], &[0, 2]).is_err());
        assert_eq!(select(&[1, 2], &[1, 0, 1]), Ok(vec![2, 1, 2]));
    }
    #[test]
    fn rejects_invalid_envelopes() {
        assert!(evaluate(b"{}").is_err());
        assert!(evaluate(b"\xff").is_err());
        assert_eq!(evaluate(br#"{"schemaVersion":2,"requestId":"x","days":[],"shifts":[],"intervals":[],"requests":[]}"#), Err("YEAR_LIMIT"));
    }
}
