import { calendarPerformance } from "./calendar-performance";

/** Opt-in synchronous input spans; arguments and results never enter the report. */
export function measureAnalysisInput<T>(
  phase: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11,
  count: number,
  operation: () => T,
): T {
  if (!calendarPerformance.getSnapshot()) return operation();
  const record = calendarPerformance.capture();
  const started = performance.now();
  let state = 1;
  let result: T | undefined;
  try {
    result = operation();
    return result;
  } catch (error) {
    state = 3;
    throw error;
  } finally {
    const duration = performance.now() - started;
    // One 120Hz frame. Omit cheap calls rather than flooding the bounded log.
    if (duration >= 8)
      record("analysis-input", {
        phase,
        count,
        duration,
        state,
        ...(typeof result === "string" ? { output: result.length } : {}),
      });
  }
}
