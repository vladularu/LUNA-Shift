use super::*;
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BuilderFrame {
    builder_id: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceFrame {
    builder_id: u64,
    group: Value,
}
fn builder(bytes: &[u8]) -> Result<CalendarBuilderId, ContractError> {
    if bytes.len() > 1024 {
        return Err(ContractError::InputTooLarge);
    }
    let frame: BuilderFrame = serde_json::from_value(contract::bounded_json(bytes)?)
        .map_err(|_| ContractError::MalformedEnvelope)?;
    CalendarBuilderId::from_wire(frame.builder_id).ok_or(ContractError::MalformedEnvelope)
}
/// Worker-only bounded header preparation.
/// # Safety
/// Nonempty caller bytes remain readable until this synchronous return.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_calendar_begin(
    bytes: *const u8,
    length: usize,
) -> EngineBuffer {
    guarded_buffer(|| {
        if length > 8192 {
            return output(&contract_error(ContractError::InputTooLarge));
        }
        let header = match unsafe { input(bytes, length) } {
            Ok(bytes) => bytes,
            Err(e) => return output(&contract_error(e)),
        };
        let id = match source_pool().begin(header) {
            Ok(id) => id,
            Err(e) => return source_failure(e),
        };
        let bytes = serde_json::to_vec(&versioned(
            json!({"ok":true,"state":"CALENDAR_BUILDING","builderId":id.value()}),
        ))
        .map_err(|_| CalendarAssemblyError::OutputLimit);
        publication::publish(
            bytes,
            || source_pool().builder_is_current(id),
            source_failure,
            CalendarAssemblyError::Registry(RegistryError::StaleSnapshot),
        )
    })
}
/// Worker-only original source input. No raw value is escaped into the header.
/// # Safety
/// Both nonempty UTF8 ranges remain readable until this synchronous return.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_calendar_source(
    header: *const u8,
    header_length: usize,
    body: *const u8,
    body_length: usize,
) -> EngineBuffer {
    guarded_buffer(|| {
        if header_length > 8192 || body_length > contract::MAX_INPUT_BYTES as usize {
            return output(&contract_error(ContractError::InputTooLarge));
        }
        let header = match unsafe { input(header, header_length) } {
            Ok(v) => v,
            Err(e) => return output(&contract_error(e)),
        };
        let body = match unsafe { input(body, body_length) } {
            Ok(v) => v,
            Err(e) => return output(&contract_error(e)),
        };
        let frame = match contract::bounded_json(header) {
            Ok(v) => v,
            Err(e) => return output(&contract_error(e)),
        };
        if frame.get("kind").and_then(Value::as_str) == Some("PRESENTATION") {
            return super::presentation::invoke(frame, body);
        }
        let frame: SourceFrame = match serde_json::from_value(frame) {
            Ok(value) => value,
            Err(_) => return output(&contract_error(ContractError::MalformedEnvelope)),
        };
        let Some(id) = CalendarBuilderId::from_wire(frame.builder_id) else {
            return output(&contract_error(ContractError::MalformedEnvelope));
        };
        let group = match serde_json::to_vec(&frame.group) {
            Ok(v) => v,
            Err(_) => return output(&contract_error(ContractError::MalformedEnvelope)),
        };
        if let Err(error) = source_pool().source_frame(id, &group, body, header_length) {
            return source_failure(error);
        }
        let bytes = serde_json::to_vec(&versioned(
            json!({"ok":true,"state":"CALENDAR_SOURCE_ADDED","builderId":id.value()}),
        ))
        .map_err(|_| CalendarAssemblyError::OutputLimit);
        publication::publish(
            bytes,
            || source_pool().builder_is_current(id),
            source_failure,
            CalendarAssemblyError::Registry(RegistryError::StaleSnapshot),
        )
    })
}
/// Worker-only native source registration.
/// # Safety
/// Nonempty caller bytes remain readable until this synchronous return.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_calendar_seal(
    bytes: *const u8,
    length: usize,
) -> EngineBuffer {
    guarded_buffer(|| {
        if length > 1024 {
            return output(&contract_error(ContractError::InputTooLarge));
        }
        let id = match unsafe { input(bytes, length) }.and_then(builder) {
            Ok(id) => id,
            Err(e) => return output(&contract_error(e)),
        };
        let completion = match source_pool().seal(id) {
            Ok(c) => c,
            Err(e) => return source_failure(e),
        };
        publication::publish(
            completion.serialize_current(),
            || completion.is_current(),
            source_failure,
            CalendarAssemblyError::Registry(RegistryError::StaleSnapshot),
        )
    })
}
/// Tiny control cancellation. Large detached owners wait for worker collection.
/// # Safety
/// Nonempty caller bytes remain readable until this synchronous return.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_calendar_abort(
    bytes: *const u8,
    length: usize,
) -> EngineBuffer {
    guarded_buffer(|| {
        if length > 1024 {
            return output(&contract_error(ContractError::InputTooLarge));
        }
        let id = match unsafe { input(bytes, length) }.and_then(builder) {
            Ok(id) => id,
            Err(e) => return output(&contract_error(e)),
        };
        match source_pool().abort(id) {
            Ok(aborted) => output(&versioned(
                json!({"ok":true,"state":"CALENDAR_ABORTED","aborted":aborted}),
            )),
            Err(e) => source_failure(e),
        }
    })
}
