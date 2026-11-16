import { monthlyRustNetRequest, type MonthlyRustNetCalculator } from "./monthly-rust-net";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RuleResolver } from "@/rules/rule-resolver";
import { calendarPerformance } from "@/application/calendar-performance";
import {
  analysisSalaryKey,
  prepareAnalysisSalarySteps,
  readAnalysisSalary,
  retainPreparedAnalysisSalary,
  type AnalysisSalaryRequest,
  type PreparedAnalysisSalary,
} from "./analysis-salary";
import { analysisWorkPriority } from "./analysis-work-queue";
import type { PersistentAnalysisCache } from "./persistent-analysis-cache";
import { persistentSalaryValue } from "./persistent-analysis-values";
import { readSharedAnalysisResult, requestSharedAnalysis } from "./shared-analysis-tasks";

/** No salary calculation runs during rendering, including the selected month's first visit. */
export function usePreparedAnalysisSalary(
  request: AnalysisSalaryRequest | null,
  active: boolean,
  distance = 1,
  persistent: PersistentAnalysisCache | null = null,
  netCalculator: MonthlyRustNetCalculator | null = null,
) {
  const [retryRevision, setRetryRevision] = useState(0);
  const effectiveRequest = useMemo(
    () => (request === null ? null : monthlyRustNetRequest(request, netCalculator)),
    [request, netCalculator],
  );
  const key = useMemo(() => {
    if (effectiveRequest === null) return null;
    const finish = calendarPerformance.span("analysis-prepare", {
      month: Number(effectiveRequest.month.replace("-", "")),
      stage: 3,
    });
    try {
      return analysisSalaryKey(effectiveRequest);
    } finally {
      finish();
    }
  }, [effectiveRequest]);
  const resolver = effectiveRequest?.context.resolver ?? null;
  const currentRequest = useRef(effectiveRequest);
  const priority = useRef(analysisWorkPriority(3, active, distance));
  useLayoutEffect(() => {
    currentRequest.current = effectiveRequest;
    priority.current = analysisWorkPriority(3, active, distance);
  }, [effectiveRequest, active, distance]);
  const task = useRef<ReturnType<typeof requestSharedAnalysis> | null>(null);
  const [state, setState] = useState<{
    key: string;
    resolver: RuleResolver;
    result: PreparedAnalysisSalary | null;
    error: string | null;
    annual?: PreparedAnalysisSalary["annual"];
  } | null>(null);
  const cached =
    effectiveRequest === null || key === null ? null : readAnalysisSalary(effectiveRequest, key);
  const shared =
    key === null || resolver === null
      ? null
      : readSharedAnalysisResult<PreparedAnalysisSalary>("salary", key, resolver, persistent);
  const matching = state?.key === key && state?.resolver === resolver ? state : null;
  const result = cached ?? shared ?? matching?.result ?? null;
  const settled =
    cached !== null || (matching !== null && (matching.result !== null || matching.error !== null));
  useEffect(() => {
    if (cached !== null && currentRequest.current !== null)
      calendarPerformance.record("analysis-cache", {
        month: Number(currentRequest.current.month.replace("-", "")),
        stage: 3,
        cache: 1,
      });
  }, [cached, key]);
  useEffect(() => {
    const input = currentRequest.current;
    if (input === null || key === null || settled) return;
    task.current = requestSharedAnalysis<PreparedAnalysisSalary, PreparedAnalysisSalary["annual"]>({
      kind: "salary",
      key,
      month: input.month,
      resolver: input.context.resolver,
      persistent,
      prepared: shared,
      priority: priority.current,
      accept: (value): value is PreparedAnalysisSalary => persistentSalaryValue(value, input),
      retain: (value) => persistentSalaryValue(value, input),
      steps: (progress) => prepareAnalysisSalarySteps(input, key, progress, netCalculator),
      progress: (annual) => {
        if (analysisSalaryKey(input) === key)
          setState({ key, resolver: input.context.resolver, annual, result: null, error: null });
      },
      complete: (value) => {
        if (analysisSalaryKey(input) === key)
          setState({
            key,
            resolver: input.context.resolver,
            result: retainPreparedAnalysisSalary(input, key, value),
            error: null,
          });
      },
      fail: () =>
        setState({
          key,
          resolver: input.context.resolver,
          result: null,
          error: "Die Gehaltsprognose konnte nicht berechnet werden.",
        }),
    });
    return () => {
      task.current?.cancel();
      task.current = null;
    };
    // Equal SQL/profile snapshots must not cancel or restart the same effectiveRequest.
  }, [key, resolver, settled, persistent, shared, netCalculator, retryRevision]);
  useEffect(
    () => task.current?.setPriority(analysisWorkPriority(3, active, distance)),
    [active, distance, key],
  );
  const annual = result?.annual ?? matching?.annual ?? null;
  return {
    retry: () => {
      setState(null);
      setRetryRevision((value) => value + 1);
    },
    result,
    annual,
    annualPending: effectiveRequest !== null && !settled && result === null && annual === null,
    pending: effectiveRequest !== null && !settled && result === null,
    error: matching?.error ?? null,
  };
}
