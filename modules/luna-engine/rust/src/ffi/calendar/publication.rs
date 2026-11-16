use super::*;
pub(super) fn publish<E>(
    bytes: Result<Vec<u8>, E>,
    current: impl Fn() -> Result<bool, E>,
    failure: fn(E) -> EngineBuffer,
    stale: E,
) -> EngineBuffer {
    publish_observed(bytes, current, failure, stale, |_| {})
}
fn publish_observed<E>(
    bytes: Result<Vec<u8>, E>,
    current: impl Fn() -> Result<bool, E>,
    failure: fn(E) -> EngineBuffer,
    stale: E,
    after_allocation: impl FnOnce(&EngineBuffer),
) -> EngineBuffer {
    let bytes = match bytes {
        Ok(bytes) => bytes,
        Err(e) => return failure(e),
    };
    let buffer = output_bytes(bytes);
    after_allocation(&buffer);
    let error = match current() {
        Ok(true) => return buffer,
        Ok(false) => stale,
        Err(error) => error,
    };
    if buffer.handle != 0 {
        luna_engine_release_buffer(buffer.handle);
    }
    failure(error)
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{contract::OwnerIdentity, runtime::calendar_only::assembly::CalendarAssemblyPool};
    use std::cell::Cell;
    #[test]
    fn source_proof_lives_through_allocation_and_reset_releases_old_buffer_before_return() {
        let registry = SnapshotRegistry::default();
        registry
            .reset_for_owner(&OwnerIdentity::new("publication-calendar", 1).unwrap())
            .unwrap();
        let pool = CalendarAssemblyPool::new(registry.clone());
        let header=serde_json::to_vec(&json!({"wireSchemaVersion":1,"expectedEngineVersion":crate::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"ownerScope":"publication-calendar","ownerEpoch":1,"sourceRevision":1,"intent":{"kind":"ROWS"}})).unwrap();
        let id = pool.begin(&header).unwrap();
        let group =
            serde_json::to_vec(&json!({"kind":"CALENDAR_ENTRIES","source":{"state":"LOADING"}}))
                .unwrap();
        pool.source(id, &group, b"").unwrap();
        let completion = pool.seal(id).unwrap();
        let old = Cell::new(0);
        let result = publish_observed(
            completion.serialize_current(),
            || completion.is_current(),
            source_failure,
            CalendarAssemblyError::Registry(RegistryError::StaleSnapshot),
            |buffer| {
                old.set(buffer.handle);
                registry
                    .reset_for_owner(&OwnerIdentity::new("publication-calendar", 1).unwrap())
                    .unwrap();
            },
        );
        assert!(old.get() > 0);
        assert!(!luna_engine_release_buffer(old.get()));
        let value: Value = serde_json::from_slice(unsafe {
            std::slice::from_raw_parts(result.bytes, result.length)
        })
        .unwrap();
        assert_eq!(value["ok"], false);
        assert_eq!(value["code"], "STALE_SNAPSHOT");
        if result.handle != 0 {
            luna_engine_release_buffer(result.handle);
        }
    }
}
