import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { MonthlyComplianceResult, ShiftEntry, UserProfile } from "@/domain/types";
import { calculateMonthlyComplianceSteps } from "@/engine/compliance";
import { useLocalReferenceDate } from "@/features/analysis/use-local-reference-date";
import { useCheckPreferences } from "@/features/settings/check-preferences";
import { recordDiagnostic } from "@/infrastructure/diagnostics";
import { bundledRuleResolver, type RuleResolver } from "@/rules/rule-resolver";
import { requestSharedAnalysis, readSharedAnalysisResult } from "./shared-analysis-tasks";
import {
  completedMonthlyCompliance as completedResults,
  monthlyComplianceKey,
} from "./analysis-compliance-cache";
import type { PersistentAnalysisCache } from "./persistent-analysis-cache";
import { persistentCheckValue } from "./persistent-analysis-values";

interface MonthlyComplianceState {
  readonly error: string | null;
  readonly youthProtection: boolean;
  readonly month: string;
  readonly profile: UserProfile;
  readonly referenceDate: string;
  readonly ruleResolver: RuleResolver;
  readonly result: MonthlyComplianceResult | null;
  readonly shifts: readonly ShiftEntry[];
}

interface DeferredMonthlyComplianceResult {
  readonly error: string | null;
  readonly result: MonthlyComplianceResult | null;
  readonly retry: () => void;
}

export function useDeferredMonthlyCompliance({
  enabled,
  month,
  profile,
  ruleResolver = bundledRuleResolver,
  shifts,
  priority = 0,
  persistent = null,
}: {
  readonly enabled: boolean;
  readonly month: string;
  readonly profile: UserProfile | null;
  readonly ruleResolver?: RuleResolver;
  readonly shifts: readonly ShiftEntry[];
  readonly priority?: number;
  readonly persistent?: PersistentAnalysisCache | null;
}): DeferredMonthlyComplianceResult {
  const {
    youthEnabled = false,
    error: preferenceError,
    retry: retryPreferences,
  } = useCheckPreferences();
  const [retryRevision, setRetryRevision] = useState(0);
  const [state, setState] = useState<MonthlyComplianceState | null>(null);
  const task = useRef<ReturnType<typeof requestSharedAnalysis> | null>(null);
  const initialPriority = useRef(priority);
  useLayoutEffect(() => {
    initialPriority.current = priority;
  }, [priority]);
  const retry = useCallback(() => {
    if (youthEnabled === null) retryPreferences();
    setRetryRevision((value) => value + 1);
  }, [youthEnabled, retryPreferences]);
  const referenceDate = useLocalReferenceDate(profile?.timeZone ?? "Europe/Berlin");
  const requestKey = useMemo(
    () =>
      profile === null || youthEnabled === null
        ? null
        : monthlyComplianceKey(month, profile, referenceDate, shifts, youthEnabled),
    [month, profile, referenceDate, shifts, youthEnabled],
  );
  const cached =
    requestKey === null
      ? null
      : completedResults.read(ruleResolver, requestKey, month === referenceDate.slice(0, 7));
  const shared =
    requestKey === null
      ? null
      : readSharedAnalysisResult<MonthlyComplianceResult>(
          "checks",
          requestKey,
          ruleResolver,
          persistent,
        );
  const matchesRequest =
    state !== null &&
    profile !== null &&
    youthEnabled !== null &&
    state.youthProtection === youthEnabled &&
    state.month === month &&
    state.profile === profile &&
    state.referenceDate === referenceDate &&
    state.ruleResolver === ruleResolver &&
    state.shifts === shifts;
  const completedRequest =
    cached !== null || (matchesRequest && state.result !== null && state.error === null);

  useEffect(() => {
    if (
      !enabled ||
      profile === null ||
      youthEnabled === null ||
      requestKey === null ||
      completedRequest
    )
      return;
    const complete = (result: MonthlyComplianceResult) => {
      setState({
        error: null,
        month,
        youthProtection: youthEnabled,
        profile,
        referenceDate,
        ruleResolver,
        result: completedResults.write(
          ruleResolver,
          requestKey,
          result,
          month === referenceDate.slice(0, 7),
        ),
        shifts,
      });
    };
    task.current = requestSharedAnalysis({
      kind: "checks",
      key: requestKey,
      month,
      resolver: ruleResolver,
      persistent,
      prepared: shared,
      priority: initialPriority.current,
      accept: persistentCheckValue,
      complete,
      steps: () =>
        calculateMonthlyComplianceSteps(month, shifts, profile.timeZone, {
          employmentProfile: profile,
          federalState: profile.federalState,
          holidayRegion: profile.holidayRegion,
          weeklyMinutes: profile.weeklyMinutes,
          regularRotatingNightWork: profile.regularRotatingNightWork,
          sundayHolidayWorkEligible: profile.sundayHolidayWorkEligible,
          allEmploymentWorkRecorded: profile.allEmploymentWorkRecorded,
          referenceDate,
          ruleResolver,
          youthProtection: youthEnabled,
        }),
      fail: (complianceError) => {
        recordDiagnostic("reporting", "MONTHLY_COMPLIANCE_FAILED", complianceError);
        setState({
          error: "Die Arbeitszeitprüfung konnte nicht berechnet werden.",
          month,
          youthProtection: youthEnabled,
          profile,
          referenceDate,
          ruleResolver,
          result: null,
          shifts,
        });
      },
    });
    return () => {
      task.current?.cancel();
      task.current = null;
    };
  }, [
    completedRequest,
    enabled,
    month,
    profile,
    referenceDate,
    requestKey,
    retryRevision,
    ruleResolver,
    shifts,
    youthEnabled,
    persistent,
    shared,
  ]);
  useEffect(() => task.current?.setPriority(priority), [priority, requestKey]);

  return {
    error: youthEnabled === null ? preferenceError : matchesRequest ? state.error : null,
    result: cached ?? shared ?? (matchesRequest ? state.result : null),
    retry,
  };
}
