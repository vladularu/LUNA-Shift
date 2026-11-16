//! Independent calendar sources and prepared-window C transport.
use super::*;
mod day_details;
mod highlights;
mod presentation;
mod profile_role;
mod publication;
mod source;
mod window;
use crate::runtime::{
    calendar_only::assembly::{CalendarAssemblyError, CalendarAssemblyPool, CalendarBuilderId},
    calendar_window::{CalendarWindowPool, WindowPoolError},
};
pub use source::{
    luna_engine_calendar_abort, luna_engine_calendar_begin, luna_engine_calendar_seal,
    luna_engine_calendar_source,
};
pub use window::{
    luna_engine_calendar_window_abort, luna_engine_calendar_window_candidates,
    luna_engine_calendar_window_finalize, luna_engine_calendar_window_prepare,
    luna_engine_calendar_window_read,
};
static SOURCE_POOL: OnceLock<CalendarAssemblyPool> = OnceLock::new();
static WINDOW_POOL: OnceLock<CalendarWindowPool> = OnceLock::new();
fn source_pool() -> &'static CalendarAssemblyPool {
    SOURCE_POOL.get_or_init(|| {
        CalendarAssemblyPool::new(REGISTRY.get_or_init(SnapshotRegistry::default).clone())
    })
}
fn window_pool() -> &'static CalendarWindowPool {
    WINDOW_POOL.get_or_init(|| {
        CalendarWindowPool::new(REGISTRY.get_or_init(SnapshotRegistry::default).clone())
    })
}
fn versioned(mut value: Value) -> Value {
    value["wireSchemaVersion"] = json!(contract::SCHEMA_VERSION);
    value["engineVersion"] = json!(crate::ENGINE_VERSION);
    value["calculationContractVersion"] = json!(contract::CONTRACT_VERSION);
    value
}
fn source_error(error: CalendarAssemblyError) -> Value {
    match error {
        CalendarAssemblyError::Contract(e) => contract_error(e),
        CalendarAssemblyError::Registry(e) => registry_error(e),
        CalendarAssemblyError::Busy => simple_source_error("BUSY"),
        CalendarAssemblyError::UnknownBuilder => simple_source_error("UNKNOWN_BUILDER"),
        CalendarAssemblyError::Capacity => simple_source_error("CAPACITY"),
        CalendarAssemblyError::SequenceExhausted => simple_source_error("SEQUENCE_EXHAUSTED"),
        CalendarAssemblyError::Poisoned => simple_source_error("POISONED"),
        CalendarAssemblyError::OutputLimit => simple_source_error("OUTPUT_LIMIT"),
    }
}
fn simple_source_error(code: &'static str) -> Value {
    json!({"ok":false,"stage":"CALENDAR_ASSEMBLY","code":code})
}
fn source_failure(error: CalendarAssemblyError) -> EngineBuffer {
    output(&source_error(error))
}
fn window_failure(error: WindowPoolError) -> EngineBuffer {
    output(&json!({"ok":false,"stage":"CALENDAR_WINDOW","code":error.code()}))
}
fn guarded_buffer(f: impl FnOnce() -> EngineBuffer) -> EngineBuffer {
    catch_unwind(AssertUnwindSafe(f)).unwrap_or_else(|_| {
        output(&json!({"ok":false,"stage":"ENGINE","code":"INTERNAL_ENGINE_ERROR"}))
    })
}
pub(super) fn collect() -> Result<Option<Value>, Value> {
    if SOURCE_POOL.get().is_none() && WINDOW_POOL.get().is_none() {
        return Ok(None);
    }
    let builders = SOURCE_POOL
        .get()
        .map_or(Ok(0), CalendarAssemblyPool::collect_retired)
        .map_err(source_error)?;
    let windows = WINDOW_POOL
        .get()
        .map(CalendarWindowPool::collect_retired)
        .transpose()
        .map_err(|e| json!({"ok":false,"stage":"CALENDAR_WINDOW","code":e.code()}))?;
    Ok(Some(
        json!({"buildersCollected":builders,"windowResources":windows}),
    ))
}
