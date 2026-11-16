//! Structural preparation only; heavy financial details use the Finance queue.
use super::*;
use crate::{
    contract::financial_collation as wire,
    runtime::financial_collation::{FinancialCollationPool, FinancialPoolError},
};

static FINANCIAL_COLLATION: OnceLock<FinancialCollationPool> = OnceLock::new();
pub(crate) fn pool() -> &'static FinancialCollationPool {
    FINANCIAL_COLLATION.get_or_init(|| {
        FinancialCollationPool::new(REGISTRY.get_or_init(SnapshotRegistry::default).clone())
    })
}
pub(super) fn collect() -> Result<(), FinancialPoolError> {
    if let Some(pool) = FINANCIAL_COLLATION.get() {
        pool.collect_retired()?;
    }
    Ok(())
}
fn failure(error: FinancialPoolError) -> EngineBuffer {
    output(&json!({"ok":false,"stage":"FINANCIAL_COLLATION","code":error.code()}))
}
fn guarded_buffer(f: impl FnOnce() -> EngineBuffer) -> EngineBuffer {
    catch_unwind(AssertUnwindSafe(f)).unwrap_or_else(|_| {
        output(&json!({"ok":false,"stage":"ENGINE","code":"INTERNAL_ENGINE_ERROR"}))
    })
}
fn publish(
    bytes: Result<Vec<u8>, FinancialPoolError>,
    current: impl Fn() -> Result<bool, FinancialPoolError>,
) -> EngineBuffer {
    let bytes = match bytes {
        Ok(bytes) => bytes,
        Err(error) => return failure(error),
    };
    let buffer = output_bytes(bytes);
    // Keep the native completion/proof alive through allocation and final
    // publication, not merely through serialization. Hosts recheck their own
    // owner/SQL/draft fence after copying and before external publication.
    if !current().unwrap_or(false) {
        if buffer.handle != 0 {
            luna_engine_release_buffer(buffer.handle);
        }
        return failure(FinancialPoolError::Stale);
    }
    buffer
}
macro_rules! operation {
    ($name:ident, $method:ident, $limit:expr) => {
        /// Worker-only structural resource operation. Copy then release output.
        /// # Safety
        /// A nonempty input points to `length` readable bytes until return.
        #[unsafe(no_mangle)]
        pub unsafe extern "C" fn $name(bytes: *const u8, length: usize) -> EngineBuffer {
            guarded_buffer(|| {
                if length > $limit {
                    return output(&contract_error(ContractError::InputTooLarge));
                }
                // SAFETY: the exported ABI's lifetime contract applies.
                let bytes = match unsafe { input(bytes, length) } {
                    Ok(bytes) => bytes,
                    Err(error) => return output(&contract_error(error)),
                };
                let completion = match super::financial_collation_pool().$method(bytes) {
                    Ok(completion) => completion,
                    Err(error) => return failure(error),
                };
                publish(completion.serialize_current(), || completion.is_current())
            })
        }
    };
}
operation!(
    luna_engine_financial_collation_prepare,
    prepare,
    wire::MAX_PREPARE_BYTES
);
operation!(
    luna_engine_financial_collation_candidates,
    candidates,
    wire::MAX_CONTROL_BYTES
);

/// Worker-only original raw rank JSON; no host-decoded map is accepted.
/// # Safety
/// Both nonempty byte ranges remain readable until this synchronous return.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_financial_collation_finalize(
    header: *const u8,
    header_length: usize,
    ranks: *const u8,
    ranks_length: usize,
) -> EngineBuffer {
    guarded_buffer(|| {
        if header_length > wire::MAX_CONTROL_BYTES || ranks_length > wire::MAX_RANK_BYTES {
            return output(&contract_error(ContractError::InputTooLarge));
        }
        // SAFETY: both pointers follow the exported ABI's lifetime contract.
        let header = match unsafe { input(header, header_length) } {
            Ok(bytes) => bytes,
            Err(error) => return output(&contract_error(error)),
        };
        let ranks = match unsafe { input(ranks, ranks_length) } {
            Ok(bytes) => bytes,
            Err(error) => return output(&contract_error(error)),
        };
        let completion = match pool().finalize(header, ranks) {
            Ok(completion) => completion,
            Err(error) => return failure(error),
        };
        publish(completion.serialize_current(), || completion.is_current())
    })
}
/// Tiny control cancellation. Large detached owners are collected on workers.
/// # Safety
/// Nonempty input remains readable for the synchronous call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_financial_collation_abort(
    bytes: *const u8,
    length: usize,
) -> EngineBuffer {
    guarded_buffer(|| {
        if length > wire::MAX_CONTROL_BYTES {
            return output(&contract_error(ContractError::InputTooLarge));
        }
        // SAFETY: caller retains the bounded input through this call.
        let bytes = match unsafe { input(bytes, length) } {
            Ok(bytes) => bytes,
            Err(error) => return output(&contract_error(error)),
        };
        match pool().abort(bytes) {
            Ok(aborted) => output(
                &json!({"ok":true,"state":"FINANCIAL_COLLATION_ABORTED","aborted":aborted,"wireSchemaVersion":contract::SCHEMA_VERSION,"engineVersion":crate::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION}),
            ),
            Err(error) => failure(error),
        }
    })
}
