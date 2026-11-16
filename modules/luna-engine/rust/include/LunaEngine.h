#ifndef LUNA_ENGINE_H
#define LUNA_ENGINE_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* ABI v1. Copy bytes before release. handle=0 names a static, non-owned error.
 * Input buffers must remain readable until the synchronous call returns.
 * Registration is transport validation, not calculation readiness. */
typedef struct {
  const uint8_t *bytes;
  size_t length;
  uint64_t handle;
} LunaEngineBuffer;
LunaEngineBuffer luna_engine_info(void);
/* Stateless, bounded pages of native comparison candidates, no ready entries. */
LunaEngineBuffer luna_engine_calendar_candidates(const uint8_t *, size_t);
LunaEngineBuffer luna_engine_snapshot_digests(const uint8_t *, size_t);
LunaEngineBuffer luna_engine_bind_owner(const uint8_t *, size_t);
/* Tiny control message, called before asynchronous source loading begins. */
LunaEngineBuffer luna_engine_advance_revision(const uint8_t *, size_t);
LunaEngineBuffer luna_engine_execute(const uint8_t *, size_t);
/* Bounded worker-only calendar/time/form utilities, maximum input 256 KiB.
 * Owner/draft/snapshot guards are echoed. Never a CALCULATE queue bypass. */
LunaEngineBuffer luna_engine_utility(const uint8_t *, size_t);
/* Worker-only raw source assembly; JSON replies contain opaque safe builder IDs.
 * Source has two separate original UTF8 ranges, never a host-parsed value. */
LunaEngineBuffer luna_engine_snapshot_begin(const uint8_t *header, size_t length);
LunaEngineBuffer luna_engine_snapshot_source(const uint8_t *header, size_t header_length,
                                           const uint8_t *source, size_t source_length);
LunaEngineBuffer luna_engine_snapshot_seal(const uint8_t *, size_t);
/* Tiny cancellation. Worker collect_retired releases detached large owners. */
LunaEngineBuffer luna_engine_snapshot_abort(const uint8_t *, size_t);
/* Builder-bound locale preflight. Candidate request is a tiny numeric cursor;
 * ranks are separate original UTF8 bytes. Both run on preparation workers. */
LunaEngineBuffer luna_engine_snapshot_calendar_candidates(const uint8_t *, size_t);
LunaEngineBuffer luna_engine_snapshot_calendar_ranks(const uint8_t *, size_t,
                                                  const uint8_t *, size_t);
/* Derive selection and locale candidates natively from the original catalog.
 * Raw-read/domain failures are unavailable; unrelated calendar sealing remains
 * possible. Original rank JSON is a separate input, not host-reencoded data. */
LunaEngineBuffer luna_engine_snapshot_catalog_candidates(const uint8_t *, size_t);
/* Original raw instant only; profile/date facts are derived inside the builder. */
LunaEngineBuffer luna_engine_snapshot_profile_clock(const uint8_t *, size_t);
LunaEngineBuffer luna_engine_snapshot_catalog_finalize(const uint8_t *, size_t,
                                                     const uint8_t *, size_t);
/* Snapshot-bound structural financial sort resources; no salary calculation.
 * Prepare <=8KiB; candidates/abort/finalize header <=1KiB; original ranks <=32MiB.
 * Abort is tiny control-only. Finalize/preparation/collect run on workers. */
LunaEngineBuffer luna_engine_financial_collation_prepare(const uint8_t *, size_t);
LunaEngineBuffer luna_engine_financial_collation_candidates(const uint8_t *, size_t);
LunaEngineBuffer luna_engine_financial_collation_abort(const uint8_t *, size_t);
LunaEngineBuffer luna_engine_financial_collation_finalize(const uint8_t *, size_t,
                                                       const uint8_t *, size_t);
/* Independent CalendarOnly sources: begin <=8KiB, controls <=1KiB,
 * original source header <=8KiB and body <=32MiB. Abort is control-only.
 * Same owner/reset witness; no financial snapshot is synthesized. */
LunaEngineBuffer luna_engine_calendar_begin(const uint8_t *, size_t);
LunaEngineBuffer luna_engine_calendar_source(const uint8_t *, size_t,const uint8_t *, size_t);
LunaEngineBuffer luna_engine_calendar_seal(const uint8_t *, size_t);
LunaEngineBuffer luna_engine_calendar_abort(const uint8_t *, size_t);
/* Bounded worker-only windows; prepare <=8KiB, other headers <=1KiB.
 * Finalize uses original raw ranks <=32MiB; read pages <=1MiB.
 * Window abort is control-only. Copy by length and release handles once. */
LunaEngineBuffer luna_engine_calendar_window_prepare(const uint8_t *, size_t);
LunaEngineBuffer luna_engine_calendar_window_candidates(const uint8_t *, size_t);
LunaEngineBuffer luna_engine_calendar_window_finalize(const uint8_t *, size_t,const uint8_t *, size_t);
LunaEngineBuffer luna_engine_calendar_window_read(const uint8_t *, size_t);
LunaEngineBuffer luna_engine_calendar_window_abort(const uint8_t *, size_t);
/* Private form resources, Finance instance only. Header <=8192 bytes and
 * original raw body <=16515072 bytes. Dedicated reply <=33554432 bytes.
 * It does not widen ordinary/utility buffers or register report snapshots.
 * Worker-only: copy exact length and release the shared opaque handle once. */
LunaEngineBuffer luna_engine_form_resource(const uint8_t *, size_t,const uint8_t *, size_t);
/* Tiny arrival-time admission. Lane 0=finance, 1=checks. */
LunaEngineBuffer luna_engine_admit(const uint8_t *, size_t, uint8_t lane);
/* Worker-only bounded pull; skipped handles let the host settle old promises. */
LunaEngineBuffer luna_engine_run_next(uint8_t lane);
LunaEngineBuffer luna_engine_cancel_job(const uint8_t *, size_t);
LunaEngineBuffer luna_engine_reset(void);
/* Worker-only disposal after owner/reset fence; cannot remove new active data. */
LunaEngineBuffer luna_engine_collect_retired(void);
bool luna_engine_release_buffer(uint64_t handle);
#ifdef __cplusplus
}
#endif
#endif
