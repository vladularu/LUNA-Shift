//! Versioned C transport. The bridge copies returned bytes before releasing the
//! opaque handle. Raw pointers and ready-made calculation values never reach JS.
mod assembly;
mod calendar;
pub use calendar::{
    luna_engine_calendar_abort, luna_engine_calendar_begin, luna_engine_calendar_seal,
    luna_engine_calendar_source, luna_engine_calendar_window_abort,
    luna_engine_calendar_window_candidates, luna_engine_calendar_window_finalize,
    luna_engine_calendar_window_prepare, luna_engine_calendar_window_read,
};
mod catalog;
mod financial_collation;
mod form_resource;
pub use form_resource::luna_engine_form_resource;
mod job_publication;
pub use catalog::{luna_engine_snapshot_catalog_candidates, luna_engine_snapshot_catalog_finalize};
pub(crate) use financial_collation::pool as financial_collation_pool;
pub use financial_collation::{
    luna_engine_financial_collation_abort, luna_engine_financial_collation_candidates,
    luna_engine_financial_collation_finalize, luna_engine_financial_collation_prepare,
};
mod profile_clock;
pub use profile_clock::luna_engine_snapshot_profile_clock;
mod utility;
use crate::{
    contract::{self, ContractError, ValidatedRequest},
    runtime::{
        JobLane, RegistryError, SnapshotRegistry,
        jobs::{JobError, JobId, JobScheduler, MAX_PENDING_JOBS},
    },
};
pub use assembly::{
    luna_engine_snapshot_abort, luna_engine_snapshot_begin,
    luna_engine_snapshot_calendar_candidates, luna_engine_snapshot_calendar_ranks,
    luna_engine_snapshot_seal, luna_engine_snapshot_source,
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    io::{self, Write},
    panic::{AssertUnwindSafe, catch_unwind},
    sync::{Mutex, OnceLock},
};
pub use utility::luna_engine_utility;
pub const ABI_VERSION: u32 = 1;
const MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_BUFFERS: usize = 8;
const MAX_BUFFER_BYTES: usize = 16 * 1024 * 1024;
static UNAVAILABLE: &[u8] =
    b"{\"ok\":false,\"stage\":\"TRANSPORT\",\"code\":\"OUTPUT_BUFFER_UNAVAILABLE\"}";
static POOL: OnceLock<Mutex<BufferPool>> = OnceLock::new();
static REGISTRY: OnceLock<SnapshotRegistry> = OnceLock::new();
static JOBS: OnceLock<JobScheduler> = OnceLock::new();
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct EngineBuffer {
    pub bytes: *const u8,
    pub length: usize,
    pub handle: u64,
}
fn unavailable() -> EngineBuffer {
    EngineBuffer {
        bytes: UNAVAILABLE.as_ptr(),
        length: UNAVAILABLE.len(),
        handle: 0,
    }
}
struct BufferPool {
    next: u64,
    bytes: usize,
    buffers: BTreeMap<u64, Box<[u8]>>,
    // One separate bounded large form frame. Ordinary replies retain their
    // original 4MiB/8-buffer/16MiB limits and share this same handle sequence.
    form: Option<(u64, Box<[u8]>)>,
}
impl Default for BufferPool {
    fn default() -> Self {
        Self {
            next: 1,
            bytes: 0,
            buffers: BTreeMap::new(),
            form: None,
        }
    }
}
impl BufferPool {
    fn insert_form(&mut self, bytes: Vec<u8>) -> EngineBuffer {
        if bytes.len() > crate::runtime::form_resource::MAX_FORM_REPLY_BYTES || self.form.is_some()
        {
            return unavailable();
        }
        let Some(next) = self.next.checked_add(1) else {
            return unavailable();
        };
        let handle = self.next;
        self.next = next;
        let bytes = bytes.into_boxed_slice();
        let buffer = EngineBuffer {
            bytes: bytes.as_ptr(),
            length: bytes.len(),
            handle,
        };
        self.form = Some((handle, bytes));
        buffer
    }
    fn insert(&mut self, bytes: Vec<u8>) -> EngineBuffer {
        if bytes.len() > MAX_OUTPUT_BYTES
            || self.buffers.len() >= MAX_BUFFERS
            || self.bytes.saturating_add(bytes.len()) > MAX_BUFFER_BYTES
        {
            return unavailable();
        }
        let Some(next) = self.next.checked_add(1) else {
            return unavailable();
        };
        let handle = self.next;
        self.next = next;
        let bytes = bytes.into_boxed_slice();
        let result = EngineBuffer {
            bytes: bytes.as_ptr(),
            length: bytes.len(),
            handle,
        };
        self.bytes += bytes.len();
        self.buffers.insert(handle, bytes);
        result
    }
    fn release(&mut self, handle: u64) -> bool {
        if self
            .form
            .as_ref()
            .is_some_and(|(current, _)| *current == handle)
        {
            self.form.take();
            return true;
        }
        if let Some(bytes) = self.buffers.remove(&handle) {
            self.bytes -= bytes.len();
            true
        } else {
            false
        }
    }
}
struct LimitedBytes(Vec<u8>);
impl Write for LimitedBytes {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.0.len().saturating_add(bytes.len()) > MAX_OUTPUT_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::FileTooLarge,
                "Engine output limit exceeded",
            ));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn output(value: &Value) -> EngineBuffer {
    let mut bytes = LimitedBytes(Vec::with_capacity(1024));
    if serde_json::to_writer(&mut bytes, value).is_err() {
        return unavailable();
    }
    output_bytes(bytes.0)
}
fn output_bytes(bytes: Vec<u8>) -> EngineBuffer {
    match POOL
        .get_or_init(|| Mutex::new(BufferPool::default()))
        .lock()
    {
        Ok(mut pool) => pool.insert(bytes),
        Err(_) => unavailable(),
    }
}
fn output_form_bytes(bytes: Vec<u8>) -> EngineBuffer {
    match POOL
        .get_or_init(|| Mutex::new(BufferPool::default()))
        .lock()
    {
        Ok(mut pool) => pool.insert_form(bytes),
        Err(_) => unavailable(),
    }
}
fn contract_error(error: ContractError) -> Value {
    json!({"ok":false,"stage":"CONTRACT","code":error})
}
fn registry_error(error: RegistryError) -> Value {
    json!({"ok":false,"stage":"REGISTRY","code":error})
}
fn jobs() -> &'static JobScheduler {
    JOBS.get_or_init(|| JobScheduler::new(REGISTRY.get_or_init(SnapshotRegistry::default).clone()))
}
fn lane(value: u8) -> Result<JobLane, RegistryError> {
    match value {
        0 => Ok(JobLane::Finance),
        1 => Ok(JobLane::Checks),
        _ => Err(RegistryError::InvalidLane),
    }
}
fn job_error(error: JobError) -> Value {
    match error {
        JobError::Registry(error) => registry_error(error),
        JobError::Capacity => json!({"ok":false,"stage":"SCHEDULER","code":"CAPACITY"}),
        JobError::Poisoned => json!({"ok":false,"stage":"SCHEDULER","code":"POISONED"}),
        JobError::SequenceExhausted => {
            json!({"ok":false,"stage":"SCHEDULER","code":"SEQUENCE_EXHAUSTED"})
        }
    }
}
fn guarded(operation: impl FnOnce() -> Value) -> EngineBuffer {
    match catch_unwind(AssertUnwindSafe(operation)) {
        Ok(value) => output(&value),
        Err(_) => output(&json!({"ok":false,"stage":"ENGINE","code":"INTERNAL_ENGINE_ERROR"})),
    }
}
/// # Safety
/// A nonempty input must point to at least `length` initialized bytes for this
/// synchronous call. The bridge retains its Data/byte buffer until return.
unsafe fn input<'a>(bytes: *const u8, length: usize) -> Result<&'a [u8], ContractError> {
    if length > contract::MAX_INPUT_BYTES as usize {
        return Err(ContractError::InputTooLarge);
    }
    if length == 0 {
        return Ok(&[]);
    }
    if bytes.is_null() {
        return Err(ContractError::InvalidJson);
    }
    // SAFETY: the caller's C contract guarantees the buffer's valid lifetime.
    Ok(unsafe { std::slice::from_raw_parts(bytes, length) })
}
#[unsafe(no_mangle)]
pub extern "C" fn luna_engine_info() -> EngineBuffer {
    guarded(
        || json!({"ok":true,"abiVersion":ABI_VERSION,"wireSchemaVersion":contract::SCHEMA_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"engineVersion":crate::ENGINE_VERSION,"engineBuildDigest":crate::ENGINE_BUILD_DIGEST,"timeZoneDbVersion":crate::time_zone::tzdb_version(),"viewSchemaVersion":1,"profileClockSchemaVersion":1,"sourceKinds":contract::ALL_SOURCE_KINDS,"limits":{"inputBytes":contract::MAX_INPUT_BYTES,"outputBytes":MAX_OUTPUT_BYTES,"stringBytes":contract::MAX_STRING_BYTES,"pendingJobs":MAX_PENDING_JOBS,"workerLanes":2,"sourceBuilders":1,"rawSourceOperations":1,"sourceHeaderBytes":131072,"utilityInputBytes":contract::utility::MAX_UTILITY_INPUT_BYTES,"utilityOutputBytes":contract::utility::MAX_UTILITY_OUTPUT_BYTES},"capabilities":{"snapshotDigests":true,"snapshotRegistration":true,"snapshotAssembly":true,"catalogPreflight":true,"profileClock":true,"financialCollation":true,"calendarSourceAssembly":true,"calendarWindowResources":true,"calendarIndexPages":true,"calendarEntryPresentation":true,"calendarCandidates":true,"revisionFence":true,"deferredDisposal":true,"jobScheduling":true,"domainReports":true,"utilities":true,"viewOverlays":true,"fullCalculation":false}}),
    )
}
/// Tiny arrival-time reservation, before dispatching work. Lane 0=finance,
/// 1=checks. No source preparation or calculation occurs in this operation.
/// # Safety
/// Input bytes must stay readable for the complete synchronous call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_admit(
    bytes: *const u8,
    length: usize,
    worker_lane: u8,
) -> EngineBuffer {
    guarded(|| {
        if length > contract::MAX_INPUT_BYTES as usize || (bytes.is_null() && length > 8192) {
            return contract_error(ContractError::InputTooLarge);
        }
        let lane = match lane(worker_lane) {
            Ok(lane) => lane,
            Err(e) => return registry_error(e),
        };
        let request = match unsafe { input(bytes, length) }.and_then(contract::parse_request) {
            Ok(ValidatedRequest::Calculate(request)) => *request,
            // Only a validated explicit large request earns the larger budget.
            _ if length > 8192 => return contract_error(ContractError::InputTooLarge),
            Ok(_) => return contract_error(ContractError::MalformedEnvelope),
            Err(e) => return contract_error(e),
        };
        if length > 8192
            && match lane {
                JobLane::Finance => request.export_report().is_none(),
                JobLane::Checks => request.checks_details().is_none(),
            }
        {
            return contract_error(ContractError::InputTooLarge);
        }
        if request.financial_details().is_some() {
            if lane != JobLane::Finance {
                return contract_error(ContractError::MalformedEnvelope);
            }
            return match jobs().admit_financial_details(request, financial_collation_pool()) {
                Ok(id) => json!({"ok":true,"state":"QUEUED","jobId":id.value()}),
                Err(crate::runtime::jobs::FinancialDetailsAdmissionError::Job(error)) => {
                    job_error(error)
                }
                Err(crate::runtime::jobs::FinancialDetailsAdmissionError::Pool(error)) => {
                    json!({"ok":false,"stage":"FINANCIAL_COLLATION","code":error.code()})
                }
            };
        }
        match jobs().admit(request, lane) {
            Ok(id) => json!({"ok":true,"state":"QUEUED","jobId":id.value()}),
            Err(e) => job_error(e),
        }
    })
}
/// Worker-only domain execution. Calculation and serialization data preparation
/// hold no registry/queue lock; the final permit separately fences publication.
#[unsafe(no_mangle)]
pub extern "C" fn luna_engine_run_next(worker_lane: u8) -> EngineBuffer {
    catch_unwind(AssertUnwindSafe(|| job_publication::run(worker_lane))).unwrap_or_else(|_| {
        output(&json!({"ok":false,"stage":"ENGINE","code":"INTERNAL_ENGINE_ERROR"}))
    })
}
/// Small cancellation fence. Queued inputs have no retained source owner.
/// # Safety
/// Input bytes must stay readable for the complete synchronous call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_cancel_job(bytes: *const u8, length: usize) -> EngineBuffer {
    guarded(|| {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Cancel {
            job_id: u64,
        }
        if length > 1024 {
            return contract_error(ContractError::InputTooLarge);
        }
        let raw = match unsafe { input(bytes, length) }.and_then(contract::bounded_json) {
            Ok(raw) => raw,
            Err(e) => return contract_error(e),
        };
        let id = match serde_json::from_value::<Cancel>(raw)
            .ok()
            .and_then(|c| JobId::from_wire(c.job_id))
        {
            Some(id) => id,
            None => return contract_error(ContractError::MalformedEnvelope),
        };
        match jobs().cancel(id) {
            Ok(canceled) => json!({"ok":true,"state":"CANCEL_FENCED","canceled":canceled}),
            Err(e) => job_error(e),
        }
    })
}
/// Stateless locale preflight over original SQL calendar rows. It creates no
/// snapshot or publication permission and never returns normalized entries.
/// # Safety
/// See `input`: callers retain a readable input buffer for the entire call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_calendar_candidates(
    bytes: *const u8,
    length: usize,
) -> EngineBuffer {
    guarded(|| {
        let mut value = match unsafe { input(bytes, length) }.and_then(contract::bounded_json) {
            Ok(value) => value,
            Err(error) => return contract_error(error),
        };
        crate::input::raw_json::normalize_integral_numbers(&mut value);
        match crate::runtime::calendar_source::candidate_page(&value) {
            Ok(page) => {
                json!({"ok":true,"wireSchemaVersion":contract::SCHEMA_VERSION,"engineVersion":crate::ENGINE_VERSION,"page":page})
            }
            Err(_) => json!({"ok":false,"code":"INVALID_CALENDAR_SOURCE"}),
        }
    })
}
/// # Safety
/// See `input`: callers retain a readable input buffer for the entire call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_snapshot_digests(
    bytes: *const u8,
    length: usize,
) -> EngineBuffer {
    guarded(
        || match unsafe { input(bytes, length) }.and_then(contract::snapshot_digests_json) {
            Ok(digests) => json!({"ok":true,"digests":digests}),
            Err(error) => contract_error(error),
        },
    )
}
/// # Safety
/// See `input`: callers retain a readable input buffer for the entire call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_bind_owner(bytes: *const u8, length: usize) -> EngineBuffer {
    guarded(
        || match unsafe { input(bytes, length) }.and_then(contract::parse_owner_binding) {
            Ok(owner) => match REGISTRY
                .get_or_init(SnapshotRegistry::default)
                .reset_for_owner(&owner)
            {
                Ok(()) => json!({"ok":true,"state":"OWNER_BOUND"}),
                Err(error) => registry_error(error),
            },
            Err(error) => contract_error(error),
        },
    )
}
/// # Safety
/// See `input`: callers retain a readable input buffer for the entire call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_advance_revision(
    bytes: *const u8,
    length: usize,
) -> EngineBuffer {
    guarded(
        || match unsafe { input(bytes, length) }.and_then(contract::parse_revision_fence) {
            Ok(fence) => match REGISTRY
                .get_or_init(SnapshotRegistry::default)
                .advance_revision(&fence)
            {
                Ok(changed) => json!({"ok":true,"state":"REVISION_FENCED","changed":changed}),
                Err(error) => registry_error(error),
            },
            Err(error) => contract_error(error),
        },
    )
}
#[unsafe(no_mangle)]
pub extern "C" fn luna_engine_reset() -> EngineBuffer {
    guarded(
        || match REGISTRY.get_or_init(SnapshotRegistry::default).reset() {
            Ok(()) => json!({"ok":true,"state":"RESET"}),
            Err(error) => registry_error(error),
        },
    )
}
/// Collect detached input ownership on a worker after an immediate control
/// fence. Never call this potentially large destruction on the UI/JS thread.
#[unsafe(no_mangle)]
pub extern "C" fn luna_engine_collect_retired() -> EngineBuffer {
    guarded(|| {
        match REGISTRY
            .get_or_init(SnapshotRegistry::default)
            .collect_retired()
        {
            Ok(collected) => match assembly::collect() {
                Ok(builders) => {
                    if let Err(error) = financial_collation::collect() {
                        return json!({"ok":false,"stage":"FINANCIAL_COLLATION","code":error.code()});
                    }
                    let forms = match form_resource::collect() {
                        Ok(value) => value,
                        Err(error) => {
                            return json!({"ok":false,"stage":"FORM_RESOURCE","code":error.code()});
                        }
                    };
                    let mut value = json!({"ok":true,"collected":collected || builders>0 || forms,"buildersCollected":builders});
                    match calendar::collect() {
                        Ok(Some(stats)) => value["calendar"] = stats,
                        Ok(None) => {}
                        Err(error) => return error,
                    };
                    value
                }
                Err(error) => assembly::failure(error),
            },
            Err(error) => registry_error(error),
        }
    })
}
/// # Safety
/// See `input`: callers retain a readable input buffer for the entire call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn luna_engine_execute(bytes: *const u8, length: usize) -> EngineBuffer {
    guarded(|| {
        let registry = REGISTRY.get_or_init(SnapshotRegistry::default);
        let preparation = match registry.preparation_marker() {
            Ok(marker) => marker,
            Err(error) => return registry_error(error),
        };
        let request = match unsafe { input(bytes, length) }.and_then(contract::parse_request) {
            Ok(request) => request,
            Err(error) => return contract_error(error),
        };
        match request {
            ValidatedRequest::RegisterSnapshot(snapshot) => {
                match registry.register_prepared(&preparation, snapshot) {
                    Ok(snapshot) => {
                        json!({"ok":true,"state":"REGISTERED","identity":snapshot.identity()})
                    }
                    Err(error) => registry_error(error),
                }
            }
            ValidatedRequest::ReleaseSnapshot(identity) => match registry.release(&identity) {
                Ok(released) => json!({"ok":true,"state":"RELEASED","released":released}),
                Err(error) => registry_error(error),
            },
            // A direct execute call may not bypass admission, cancellation or
            // the worker's publication reservation for expensive calculations.
            ValidatedRequest::Calculate(_) => {
                json!({"ok":false,"code":"QUEUED_CALCULATION_REQUIRED"})
            }
        }
    })
}
/// Release only a handle allocated by this library. A stale or repeated handle
/// never reconstructs a Vec from caller-controlled pointer/length/capacity.
#[unsafe(no_mangle)]
pub extern "C" fn luna_engine_release_buffer(handle: u64) -> bool {
    catch_unwind(|| {
        POOL.get()
            .is_some_and(|pool| pool.lock().is_ok_and(|mut pool| pool.release(handle)))
    })
    .unwrap_or(false)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn buffer_handles_are_bounded_and_never_reused_or_double_freed() {
        let mut pool = BufferPool::default();
        let mut handles = vec![];
        for _ in 0..MAX_BUFFERS {
            let buffer = pool.insert(b"{}".to_vec());
            assert_ne!(buffer.handle, 0);
            handles.push(buffer.handle);
        }
        assert_eq!(pool.insert(b"{}".to_vec()).handle, 0);
        let old = handles[0];
        assert!(pool.release(old));
        assert!(!pool.release(old));
        let next = pool.insert(b"{}".to_vec());
        assert!(next.handle > *handles.last().unwrap());
        assert_eq!(pool.buffers.len(), MAX_BUFFERS);
    }
    #[test]
    fn serialization_cannot_allocate_unbounded_output() {
        let mut bytes = LimitedBytes(vec![0; MAX_OUTPUT_BYTES - 1]);
        assert!(bytes.write_all(&[0, 0]).is_err());
        assert_eq!(bytes.0.len(), MAX_OUTPUT_BYTES - 1);
    }
    #[test]
    fn large_form_slot_is_separate_bounded_and_uses_the_same_nonreused_handles() {
        let mut pool = BufferPool::default();
        let ordinary = pool.insert(vec![0; MAX_OUTPUT_BYTES]);
        assert_ne!(ordinary.handle, 0);
        assert_eq!(pool.insert(vec![0; MAX_OUTPUT_BYTES + 1]).handle, 0);
        let form = pool.insert_form(vec![0; crate::runtime::form_resource::MAX_FORM_REPLY_BYTES]);
        assert!(form.handle > ordinary.handle);
        assert_eq!(pool.bytes, MAX_OUTPUT_BYTES);
        assert_eq!(pool.insert_form(vec![0]).handle, 0);
        assert!(pool.release(form.handle));
        assert!(!pool.release(form.handle));
        assert_eq!(pool.bytes, MAX_OUTPUT_BYTES);
        assert_eq!(
            pool.insert_form(vec![
                0;
                crate::runtime::form_resource::MAX_FORM_REPLY_BYTES + 1
            ])
            .handle,
            0
        );
        let second = pool.insert_form(vec![0]);
        assert!(second.handle > form.handle);
        assert!(pool.release(second.handle));
        assert!(pool.release(ordinary.handle));
        assert_eq!(pool.bytes, 0);
    }
}
