import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  calculateMonthlyAnalysisSteps,
  inspectMonthlyAnalysis,
  retainPreparedMonthlyAnalysis,
  type MonthlyAnalysisCalculation,
  type MonthlyAnalysisRequest,
} from "./monthly-analysis";
import { analysisWorkPriority } from "./analysis-work-queue";
import type { RuleResolver } from "@/rules/rule-resolver";
import { calendarPerformance } from "@/application/calendar-performance";
import type { PersistentAnalysisCache } from "./persistent-analysis-cache";
import { persistentMonthValue } from "./persistent-analysis-values";
import { readSharedAnalysisResult, requestSharedAnalysis } from "./shared-analysis-tasks";

/** Cached months are immediate; every uncached month is computed outside rendering. */
export function usePreparedMonthlyAnalysis(
  request: MonthlyAnalysisRequest | null,
  active: boolean,
  distance = 1,
  persistent: PersistentAnalysisCache | null = null,
) {
  const [prepared, setPrepared] = useState<{
    key: string;
    resolver: RuleResolver;
    result: MonthlyAnalysisCalculation | null;
    failure?: unknown;
  } | null>(null);
  const task = useRef<ReturnType<typeof requestSharedAnalysis> | null>(null);
  const input = useRef(request);
  const priority = useRef(analysisWorkPriority(1, active, distance));
  useLayoutEffect(() => {
    input.current = request;
    priority.current = analysisWorkPriority(1, active, distance);
  }, [request, active, distance]);
  const inspection = useMemo(() => {
    if (request === null) return null;
    const finish = calendarPerformance.span("analysis-prepare", {
      month: Number(request.month.replace("-", "")),
      stage: 1,
    });
    try {
      return inspectMonthlyAnalysis(request);
    } finally {
      finish();
    }
  }, [request]);
  const cached = inspection?.cached ?? null;
  const key = inspection?.key ?? null;
  const resolver = request?.ruleResolver ?? null;
  const shared =
    key === null || resolver === null
      ? null
      : readSharedAnalysisResult<MonthlyAnalysisCalculation>("month", key, resolver, persistent);
  const matching = prepared?.key === key && prepared?.resolver === resolver ? prepared : null;
  const settled = cached !== null || matching !== null;
  useEffect(() => {
    const current = input.current;
    if (current === null || key === null || settled) return;
    task.current = requestSharedAnalysis({
      kind: "month",
      key,
      month: current.month,
      resolver: current.ruleResolver,
      persistent,
      prepared: shared,
      priority: priority.current,
      accept: persistentMonthValue,
      steps: () => calculateMonthlyAnalysisSteps(current),
      complete: (value) =>
        setPrepared({
          key,
          resolver: current.ruleResolver,
          result: retainPreparedMonthlyAnalysis(current, key, value),
        }),
      fail: (failure) =>
        setPrepared({ key, resolver: current.ruleResolver, result: null, failure }),
    });
    return () => {
      task.current?.cancel();
      task.current = null;
    };
  }, [key, resolver, settled, persistent, shared]);
  useEffect(
    () => task.current?.setPriority(analysisWorkPriority(1, active, distance)),
    [active, distance, key, resolver],
  );
  if (active && matching && "failure" in matching) throw matching.failure;
  return cached ?? shared ?? matching?.result ?? null;
}
