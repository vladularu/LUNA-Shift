/** Opt-in, bounded numeric diagnostics. No domain objects or free text are accepted. */
const kinds = [
  "prototype-request",
  "prototype-start",
  "prototype-end",
  "request-month",
  "request-year",
  "request-year-step",
  "request-today",
  "scroll-begin",
  "scroll-end",
  "expand",
  "index",
  "load-start",
  "load-end",
  "load-discard",
  "load-error",
  "commit",
  "pager-layout",
  "prepare",
  "measure",
  "plan-ready",
  "animation-start",
  "animation-end",
  "fallback",
  "effect-cleanup",
  "ui-frames",
  "ui-sampling",
  "navigation-frames",
  "navigation-sampling",
  "navigation-lag",
  "calendar-lag",
  "stamp-touch",
  "stamp-handler",
  "stamp-preview",
  "stamp-persist",
  "widget-work",
  "analysis-request",
  "analysis-view",
  "analysis-commit",
  "analysis-result-commit",
  "analysis-cache",
  "analysis-cache-phase",
  "analysis-cache-row",
  "analysis-parts",
  "analysis-prepare",
  "analysis-work",
  "analysis-input",
  "analysis-native-rest",
  "analysis-lag",
  "salary-settings-start",
  "salary-settings-end",
] as const;
export type CalendarPerformanceKind = (typeof kinds)[number];
const fields = [
  "duration",
  "input",
  "output",
  "series",
  "month",
  "height",
  "width",
  "mode",
  "round",
  "nodes",
  "valid",
  "load",
  "full",
  "epoch",
  "count",
  "maximum",
  "kernel",
  "over17",
  "over34",
  "over50",
  "missed60",
  "stage",
  "cpu",
  "wait",
  "state",
  "priority",
  "cache",
  "phase",
  "reason",
  "fingerprint",
  "instance",
] as const;
export type CalendarPerformanceValues = Partial<Record<(typeof fields)[number], number>>;
export function createCalendarPerformanceRecorder(now: () => number = () => performance.now()) {
  let session = 0,
    serial = 0,
    request = 0,
    started = 0,
    dropped = 0;
  let touchOrigin: number | null = null;
  const events: {
    t: number;
    request: number;
    kind: CalendarPerformanceKind;
    values: CalendarPerformanceValues;
  }[] = [];
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const stop = () => {
    session = 0;
    notify();
  };
  const active = () => {
    if (session && now() - started >= 600_000) stop();
    return session;
  };
  const record = (
    kind: CalendarPerformanceKind,
    values: CalendarPerformanceValues = {},
    expected = session,
    requestId = request,
  ) => {
    if (!active() || expected !== session || !kinds.includes(kind)) return;
    const clean: CalendarPerformanceValues = {};
    for (const field of fields) {
      const value = values[field];
      if (typeof value === "number" && Number.isFinite(value))
        clean[field] = Math.round(value * 100) / 100;
    }
    if (events.length === 2000) {
      events.shift();
      dropped++;
    }
    events.push({
      t: Math.round((now() - started) * 100) / 100,
      request: requestId,
      kind,
      values: clean,
    });
  };
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => session,
    start: (allowed: boolean) => {
      if (!allowed) return;
      events.length = 0;
      dropped = 0;
      request = 0;
      touchOrigin = null;
      started = now();
      session = ++serial;
      notify();
    },
    stop,
    clear: () => {
      stop();
      events.length = 0;
      dropped = 0;
    },
    record,
    touch: (phase: number, nativeTimestamp: number) => {
      if (!active()) return;
      // Native uptime and performance.now have separate origins. Export only
      // native deltas; comparing intervals can reveal changing delivery lag.
      const valid = Number.isFinite(nativeTimestamp) && nativeTimestamp >= 0;
      if (valid && touchOrigin === null) touchOrigin = nativeTimestamp;
      record("stamp-touch", {
        phase,
        ...(valid ? { input: nativeTimestamp - touchOrigin! } : {}),
      });
    },
    capture: () => {
      const id = active(),
        owner = request;
      return (kind: CalendarPerformanceKind, values: CalendarPerformanceValues = {}) => {
        if (id) record(kind, values, id, owner);
      };
    },
    begin: (kind: CalendarPerformanceKind, month?: string) => {
      if (!active()) return;
      request++;
      record(
        kind,
        month && /^\d{4}-\d{2}$/.test(month) ? { month: Number(month.replace("-", "")) } : {},
      );
    },
    span: (kind: CalendarPerformanceKind, values: CalendarPerformanceValues = {}) => {
      const id = active(),
        owner = request,
        start = id ? now() : 0;
      return (result: CalendarPerformanceValues = {}) => {
        if (id) record(kind, { ...values, ...result, duration: now() - start }, id, owner);
      };
    },
    report: () => ({
      schema: 2,
      baseline: "monthly-salary-v3",
      calendar: {
        stampTouch:
          "phase 1 touch start, 2 touch end, 3 touch cancel, 4 onPress; input is native event milliseconds relative to the first recorded touch. Native and JS clocks have separate origins: compare intervals only, not absolute latency. No coordinates, dates, entry IDs or titles are recorded.",
        stampHandler:
          "duration covers synchronous feedback, optimistic publication and write kickoff; it excludes async persistence and native paint.",
        stampPreview:
          "phase 1 queue publication, phase 2 React layout-effect commit of display entries; count is preview day count for phase 1, input is entry count. A React commit is not native paint or proof of visible response.",
        stampPersist:
          "mode 1 save, 0 remove; state 1 completed, 3 failed; duration includes await time and is independent of optimistic preview commit.",
        widgetWork:
          "widget-work phase 1 sums synchronous timeline/highlight preparation slices (input is entry count, count is slice count, maximum is longest slice, state 1 completed or 2 stopped/failed); duration excludes cooperative waiting. Phase 2 synchronous property-list conversion and native publication (count is timeline entry count), phase 3 refresh deferred during calendar editing, phase 4 unchanged published input reused (no duration). These spans exclude async database/photo waiting; native publication can include synchronous native work. No widget content, IDs, paths or titles are recorded.",
        sampling:
          "ui-sampling phase 1 JS lifecycle, state 1 enabled or 0 disabled, mode 1 focused calendar; phase 2 first UI callback. calendar-lag measures excess over a 100ms JS timer interval, not touch latency. ui-frames contains full one-second callback windows, not GPU FPS.",
      },
      analysis: {
        stages:
          "0 untagged input preparation/orchestration (priority identifies queue class), 1 overview, 2 compliance, 3 annual salary and full net, 4 annual analysis, 5 salary settings",
        inputPhases:
          "analysis-input records synchronous spans of at least 8ms: phase 1 source-row JSON decode, 2 catalog JSON decode, 3 transport JSON encode, 4 transport reply JSON decode, 5 calendar candidate ordering, 6 catalog candidate ordering, 7 annual input selection, 8 annual request key, 9 monthly inspection, 10 salary request key, 11 compliance request key. count is characters for decode, candidates for ordering or input entry count for preparation; output is string length when available. state 1 returned, 3 threw. No arguments, payloads, identifiers or error text. Duration is synchronous elapsed time, not async transport waiting or a CPU sampling profile; nested spans can overlap.",
        cacheStages:
          "For analysis-cache, analysis-cache-phase and analysis-parts: 1 month, 2 compliance, 3 salary, 4 annual, 5 annual-month parts. These differ from work stages.",
        annualCacheRow:
          "analysis-cache-row inspects row and owner epoch in the same SQLite snapshot: state 1 exact row, 2 missing row, 3 different request hash, 4 invalidated owner epoch; valid 1 means full request hash matches, epoch 1 means owner matches. This precedes payload integrity/shape validation in analysis-cache; no raw keys are exported.",
        annualParts:
          "analysis-parts compares a monthly write attempt with the last restored candidate in this recording: input previous-part mask, valid new-part mask, cache equal-key mask, state changed-key mask. Part bits: 1 summary, 2 shift types, 4 compliance, 8 pay, 16 remuneration. Reason bits for changed keys: 1 shifts, 2 profile, 4 reference date, 8 youth protection, 16 tariff decision, 32 work-pattern settings, 64 calculation contract, 128 unknown format. Equality indicates reuse eligibility, not timed work or a confirmed database write. Missing/evicted diagnostic baselines are not changes. Baselines are session-scoped and bounded to 36 months / 1 million key characters.",
        cachePhases:
          "1 read request hash, 2 repository read, 3 decode, 4 read validation, 5 write validation, 6 write request hash, 7 encode, 8 payload hash, 9 whole repository write, 10 read payload hash, 11 wait for write turn including initialization/BEGIN and earlier batch items, 12 SQL upsert, 13 SQL cleanup, 14 remaining batch and COMMIT, 15 completed result callbacks, 16 persistent write kickoff, 17 retention, 18 progress callbacks, 19 exact persisted-row recheck; duration includes await time; repository subphases overlap phase 9, callback phases measure handover not React render",
        cacheWriteReasons:
          "0 completed, 1 superseded before validation, 2 result not persistable, 3 payload too large, 4 no compatible request hash, 5 superseded during write, 6 exception, 7 identical result confirmed in database without another write; write state 9 stored, 10 unchanged already stored, 8 skipped, 7 exception; fingerprint is a diagnostic-only 32-bit SHA-256 prefix, instance identifies the local cache owner",
        resultCommitStates:
          "analysis-result-commit records annual hook state after React commit: 0 waiting, 1 core, 2 final (coverage may be unavailable), 3 failure; mode 1 active, 0 inactive. Its timestamp is not render duration or native paint time.",
        workState:
          "1 completed, 2 cancelled, 3 failed; wait is enqueue to first step; cpu is sum of step times; maximum is longest step; duration includes queue waiting",
        commitFlags:
          "1 data ready, 2 overview, 4 compliance settled, 8 settings settled, 16 salary settled, 32 check preferences settled; mode 1 is the selected page",
      },
      sessionSerial: serial,
      dropped,
      events: events.map((event) => ({ ...event, values: { ...event.values } })),
      limits:
        "Local numeric data only; JS handler time is not physical touch time. Commit marks are not React render duration. JS timer lag and UI callback intervals are not GPU FPS; partial final frame windows are omitted. Instrumentation adds overhead. Maximum 2000 events / 10 minutes; no persistence across restart.",
    }),
  };
}
export const calendarPerformance = createCalendarPerformanceRecorder();
