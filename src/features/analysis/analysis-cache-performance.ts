import { calendarPerformance } from "@/application/calendar-performance";
import type { AnalysisResultKind } from "@/infrastructure/database/analysis-result-repository";

const inactive = { next: (_phase: number) => {}, finish: () => {} };

export function analysisCacheStage(kind: AnalysisResultKind) {
  return kind === "month"
    ? 1
    : kind === "checks"
      ? 2
      : kind === "annual"
        ? 4
        : kind === "annual-month"
          ? 5
          : 3;
}

/** Phase durations are diagnostic spans, including await time; never OS CPU usage. */
export function measureAnalysisCache(kind: AnalysisResultKind, month: string) {
  if (!calendarPerformance.getSnapshot()) return inactive;
  const session = calendarPerformance.getSnapshot();
  const record = calendarPerformance.capture();
  let end: (() => void) | null = null;
  let stopped = false;
  const stage = analysisCacheStage(kind);
  return {
    next(phase: number) {
      if (stopped) return;
      end?.();
      if (calendarPerformance.getSnapshot() !== session) {
        stopped = true;
        end = null;
        return;
      }
      const start = performance.now();
      end = () =>
        record("analysis-cache-phase", {
          month: Number(month.replace("-", "")),
          stage,
          phase,
          duration: performance.now() - start,
        });
    },
    finish() {
      if (stopped) return;
      stopped = true;
      end?.();
      end = null;
    },
  };
}
