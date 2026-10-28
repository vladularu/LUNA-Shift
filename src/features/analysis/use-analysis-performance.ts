import { useEffect, useSyncExternalStore } from "react";
import { calendarPerformance } from "@/application/calendar-performance";

/** Opt-in JS timestamps; these do not measure native touch latency or GPU frames. */
export function useAnalysisPerformance(month: string, focused: boolean, period: "MONTH" | "YEAR") {
  const session = useSyncExternalStore(
    calendarPerformance.subscribe,
    calendarPerformance.getSnapshot,
    () => 0,
  );
  useEffect(() => {
    if (!session || !focused) return;
    calendarPerformance.record("analysis-view", {
      month: Number(month.replace("-", "")),
      mode: period === "MONTH" ? 1 : 2,
    });
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const lag = Math.max(0, now - previous - 100);
      previous = now;
      if (lag > 20) calendarPerformance.record("analysis-lag", { duration: lag });
    }, 100);
    return () => clearInterval(timer);
  }, [focused, month, period, session]);
}

export function useAnalysisCommit(month: string, active: boolean, state: number, enabled: boolean) {
  const session = useSyncExternalStore(
    calendarPerformance.subscribe,
    calendarPerformance.getSnapshot,
    () => 0,
  );
  useEffect(() => {
    if (enabled && session)
      calendarPerformance.record("analysis-commit", {
        month: Number(month.replace("-", "")),
        mode: active ? 1 : 0,
        state,
      });
  }, [active, enabled, month, session, state]);
}
