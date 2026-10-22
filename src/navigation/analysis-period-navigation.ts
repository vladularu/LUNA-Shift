/** Analysis resets deliberately do not issue Calendar Today requests. */
export function createAnalysisPeriodRequests() {
  let revision = 0;
  let month: string | null = null;
  let period: "MONTH" | "YEAR" = "MONTH";
  const listeners = new Set<() => void>();
  return Object.freeze({
    getRevision: () => revision,
    getMonth: () => month,
    setMonth: (next: string) => {
      if (month === next) return;
      month = next;
      for (const listener of listeners) listener();
    },
    getPeriod: () => period,
    setPeriod: (next: "MONTH" | "YEAR") => {
      period = next;
    },
    request: () => {
      revision += 1;
      for (const listener of listeners) listener();
      return revision;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

export function requestAnalysisCurrentPeriodOnReselect(
  coordinator: { readonly analysisRequests: ReturnType<typeof createAnalysisPeriodRequests> },
  analysisIsFocused: boolean,
): void {
  if (analysisIsFocused) coordinator.analysisRequests.request();
}
