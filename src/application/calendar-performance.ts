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
  "analysis-request",
  "analysis-view",
  "analysis-commit",
  "analysis-cache",
  "analysis-cache-phase",
  "analysis-prepare",
  "analysis-work",
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
  "over17",
  "over34",
  "over50",
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
      analysis: {
        stages:
          "1 overview, 2 compliance, 3 annual salary and full net, 4 annual analysis, 5 salary settings",
        cachePhases:
          "1 read request hash, 2 repository read, 3 decode, 4 read validation, 5 write validation, 6 write request hash, 7 encode, 8 payload hash, 9 whole repository write, 10 read payload hash, 11 wait for write turn including initialization/BEGIN and earlier batch items, 12 SQL upsert, 13 SQL cleanup, 14 remaining batch and COMMIT, 15 completed result callbacks, 16 persistent write kickoff, 17 retention, 18 progress callbacks; duration includes await time; repository subphases overlap phase 9, callback phases measure handover not React render",
        cacheWriteReasons:
          "0 completed, 1 superseded before validation, 2 result not persistable, 3 payload too large, 4 no compatible request hash, 5 superseded during write, 6 exception; fingerprint is a diagnostic-only 32-bit SHA-256 prefix, instance identifies the local cache owner",
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
