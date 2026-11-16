//! Keep worker ownership through bounded serialization and output allocation.
use super::*;
use crate::runtime::{dispatch::ComputedCalculation, jobs::Work};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Completed<'a> {
    ok: bool,
    state: &'static str,
    job_id: u64,
    skipped_jobs: &'a [u64],
    result: &'a ComputedCalculation,
}
fn canceled(id: u64, skipped: &[u64]) -> EngineBuffer {
    output(&json!({"ok":true,"state":"CANCELED","jobId":id,"skippedJobs":skipped}))
}
fn release(buffer: EngineBuffer) {
    if buffer.handle != 0 {
        luna_engine_release_buffer(buffer.handle);
    }
}
fn publish(
    work: Work,
    skipped: &[u64],
    computed: ComputedCalculation,
    after_allocation: impl FnOnce(),
) -> EngineBuffer {
    let id = work.id().value();
    if !work.is_current().unwrap_or(false)
        || !computed.financial_details_is_current().unwrap_or(false)
    {
        return canceled(id, skipped);
    }
    let completed = Completed {
        ok: true,
        state: "COMPLETED",
        job_id: id,
        skipped_jobs: skipped,
        result: &computed,
    };
    let buffer = if computed.requires_large_output() {
        // Reuse the existing single large-frame slot. Count borrowed output
        // before allocation; ordinary jobs retain their original 4MiB writer.
        let Some(size) =
            crate::report::cache_budget::serialized_bytes(&completed, 32 * 1024 * 1024)
        else {
            return unavailable();
        };
        let mut bytes = Vec::with_capacity(size as usize);
        if serde_json::to_writer(&mut bytes, &completed).is_err() {
            return unavailable();
        }
        output_form_bytes(bytes)
    } else {
        let mut bytes = LimitedBytes(Vec::with_capacity(1024));
        // Stream borrowed DTOs directly; do not materialize another full Value tree.
        if serde_json::to_writer(&mut bytes, &completed).is_err() {
            return unavailable();
        }
        output_bytes(bytes.0)
    };
    if buffer.handle == 0 {
        return buffer;
    }
    after_allocation();
    // finish rechecks owner, source, writer slots and cancellation *after*
    // serialization/allocation. Keep the returned permit and computed private
    // proof alive through the final native publication check below.
    match work.finish() {
        Ok(Some(permit)) => {
            let current = computed.financial_details_is_current().unwrap_or(false)
                && permit
                    .financial_details()
                    .is_none_or(|p| p.is_current().unwrap_or(false));
            if current {
                buffer
            } else {
                release(buffer);
                canceled(id, skipped)
            }
        }
        Ok(None) => {
            release(buffer);
            canceled(id, skipped)
        }
        Err(error) => {
            release(buffer);
            let mut value = job_error(error);
            value["jobId"] = json!(id);
            value["skippedJobs"] = json!(skipped);
            output(&value)
        }
    }
}
pub(super) fn run(worker_lane: u8) -> EngineBuffer {
    let lane = match lane(worker_lane) {
        Ok(lane) => lane,
        Err(error) => return output(&registry_error(error)),
    };
    let (work, skipped) = match jobs().next_with_skipped(lane) {
        Ok(next) => next,
        Err(error) => return output(&job_error(error)),
    };
    let skipped = skipped.into_iter().map(JobId::value).collect::<Vec<_>>();
    let Some(work) = work else {
        return output(&json!({"ok":true,"state":"IDLE","skippedJobs":skipped}));
    };
    let id = work.id().value();
    match crate::runtime::dispatch::calculate(&work) {
        Ok(Some(computed)) => publish(work, &skipped, computed, || {}),
        Ok(None) => canceled(id, &skipped),
        Err(error) => {
            let mut value = job_error(error);
            value["jobId"] = json!(id);
            value["skippedJobs"] = json!(skipped);
            output(&value)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup_kind(export: bool) -> (SnapshotRegistry, JobScheduler, Work, ComputedCalculation) {
        let registry = SnapshotRegistry::default();
        let sources = contract::ALL_SOURCE_KINDS
            .iter()
            .map(|kind| json!({"kind":kind,"source":{"state":"NOT_REQUESTED"}}))
            .collect::<Vec<_>>();
        let mut raw = json!({"identity":{"ownerScope":"publication-test","ownerEpoch":1,"snapshotId":"s","snapshotRevision":1,"inputDigest":"a".repeat(64),"catalogDigest":"b".repeat(64)},"referenceDate":"2026-11-13","sources":sources,"catalogs":{"current":{"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"tariff":{"state":"NOT_REQUESTED"},"legal":{"state":"NOT_REQUESTED"},"holiday":{"state":"NOT_REQUESTED"}},"history":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}});
        let d = contract::snapshot_digests_json(&serde_json::to_vec(&raw).unwrap()).unwrap();
        raw["identity"]["inputDigest"] = json!(d.input_digest);
        raw["identity"]["catalogDigest"] = json!(d.catalog_digest);
        let envelope = |command: Value| {
            serde_json::to_vec(&json!({"wireSchemaVersion":1,"expectedEngineVersion":crate::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":command})).unwrap()
        };
        let snapshot = match contract::parse_request(&envelope(
            json!({"kind":"REGISTER_SNAPSHOT","snapshot":raw}),
        ))
        .unwrap()
        {
            ValidatedRequest::RegisterSnapshot(s) => s,
            _ => panic!("snapshot"),
        };
        let identity = snapshot.identity().clone();
        registry.register(snapshot).unwrap();
        let mut request = json!({"guard":{"snapshot":identity,"requestId":"publication","requestRevision":1},"periods":[{"kind":"MONTH","month":"2026-11"}],"sections":{"time":false,"gross":!export,"net":false,"checks":false},"perspective":if export{"PAYOUT"}else{"EARNED"},"priority":"INTERACTIVE"});
        if export {
            request["exportReport"] = json!({"format":"CSV","layout":"standard","includeSalary":false,"profileRole":"PROVIDED","observedEpochMilliseconds":1793552400000i64,"records":{"kind":"RECORDED_ENTRIES","entries":[]},"ranks":{},"netSettingsRows":[],"salaryPreferenceRow":null});
        }
        let request =
            match contract::parse_request(&envelope(json!({"kind":"CALCULATE","request":request})))
                .unwrap()
            {
                ValidatedRequest::Calculate(r) => *r,
                _ => panic!("request"),
            };
        let scheduler = JobScheduler::new(registry.clone());
        scheduler.admit(request, JobLane::Finance).unwrap();
        let work = scheduler.next(JobLane::Finance).unwrap().unwrap();
        let computed = crate::runtime::dispatch::calculate(&work).unwrap().unwrap();
        (registry, scheduler, work, computed)
    }
    fn setup() -> (SnapshotRegistry, JobScheduler, Work, ComputedCalculation) {
        setup_kind(false)
    }
    fn take(buffer: EngineBuffer) -> Value {
        // SAFETY: output is retained until the one matching release below.
        let value = serde_json::from_slice(unsafe {
            std::slice::from_raw_parts(buffer.bytes, buffer.length)
        })
        .unwrap();
        release(buffer);
        value
    }
    #[test]
    fn reset_or_cancel_after_allocation_prevents_native_publication() {
        let (registry, _scheduler, work, computed) = setup();
        let value = take(publish(work, &[17], computed, || {
            registry.reset().unwrap();
        }));
        assert_eq!(
            value,
            json!({"ok":true,"state":"CANCELED","jobId":value["jobId"],"skippedJobs":[17]})
        );
        let (_registry, scheduler, work, computed) = setup();
        let id = work.id();
        assert_eq!(
            take(publish(work, &[], computed, || {
                assert!(scheduler.cancel(id).unwrap());
            }))["state"],
            "CANCELED"
        );
        let (_registry, _scheduler, work, computed) = setup();
        assert_eq!(
            take(publish(work, &[], computed, || {}))["state"],
            "COMPLETED"
        );
    }
    #[test]
    fn large_export_reuses_the_existing_slot_and_keeps_after_allocation_fences() {
        for cancel in [false, true] {
            let (registry, scheduler, work, mut computed) = setup_kind(true);
            let id = work.id();
            // Writer-boundary probe, deliberately independent of the already
            // source-proven artifact producer. No deserialized Ready admission.
            computed.replace_export_artifact_for_writer_test(
                json!({"format":"CSV","period":"2026-11","text":"x".repeat(5*1024*1024)}),
            );
            let result = take(publish(work, &[], computed, || {
                if cancel {
                    assert!(scheduler.cancel(id).unwrap());
                } else {
                    registry.reset().unwrap();
                }
            }));
            assert_eq!(result["state"], "CANCELED");
        }
        let (_registry, _scheduler, work, mut computed) = setup_kind(true);
        computed.replace_export_artifact_for_writer_test(
            json!({"format":"CSV","period":"2026-11","text":"x".repeat(5*1024*1024)}),
        );
        let buffer = publish(work, &[], computed, || {});
        assert!(buffer.length > 4 * 1024 * 1024 && buffer.length < 32 * 1024 * 1024);
        assert_eq!(take(buffer)["state"], "COMPLETED");
    }
}
