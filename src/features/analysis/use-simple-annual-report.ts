import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  CalendarEntry,
  MonthlyTariffDecision,
  TvoedWorkPatternSettings,
  UserProfile,
} from "@/domain/types";
import type { AnnualReport } from "./annual-report";
import type { RuleComputationFailure } from "./rule-computation";
import { useLocalReferenceDate } from "./use-local-reference-date";
import { bundledRuleResolver, type RuleResolver } from "@/rules/rule-resolver";
import { useCheckPreferences } from "@/features/settings/check-preferences";
import { useAnalysisPersistentResults } from "./analysis-persistent-results";
import {
  annualAnalysisKey,
  readAnnualAnalysis,
  requestAnnualAnalysis,
  type AnnualAnalysisRequest,
} from "./annual-analysis";
import type { PersistentAnalysisCache } from "./persistent-analysis-cache";
import { calendarPerformance } from "@/application/calendar-performance";
interface AnnualReportState {
  readonly key: string;
  readonly resolver: RuleResolver;
  readonly persistent: PersistentAnalysisCache | null;
  readonly revision: number;
  readonly report: AnnualReport | null;
  readonly fatalError: Error | null;
}
interface DeferredAnnualReportResult {
  readonly coreReport: AnnualReport | null;
  readonly error: string | null;
  readonly fatalError: Error | null;
  readonly report: AnnualReport | null;
  readonly ruleFailure: RuleComputationFailure | null;
  readonly retry: () => void;
}
const NO_TEST_MONTHS: readonly string[] = [];
export function useSimpleAnnualReport({
  enabled,
  active = true,
  entries,
  profile,
  ruleResolver = bundledRuleResolver,
  tariffDecisions,
  workPatternSettings,
  year,
  testMonths = NO_TEST_MONTHS,
}: {
  readonly enabled: boolean;
  /** Pause new work without invalidating results for otherwise valid inputs. */
  readonly active?: boolean;
  readonly entries: readonly CalendarEntry[];
  readonly profile: UserProfile | null;
  readonly ruleResolver?: RuleResolver;
  readonly tariffDecisions: readonly MonthlyTariffDecision[];
  readonly workPatternSettings: TvoedWorkPatternSettings;
  readonly year: number;
  readonly testMonths?: readonly string[];
}): DeferredAnnualReportResult {
  const {
    youthEnabled = false,
    error: preferenceError,
    retry: retryPreferences,
  } = useCheckPreferences();
  const stored = useAnalysisPersistentResults();
  const persistent = testMonths.length === 0 ? stored : null;
  const [retryRevision, setRetryRevision] = useState(0);
  const [state, setState] = useState<AnnualReportState | null>(null);
  const [coreState, setCoreState] = useState<AnnualReportState | null>(null);
  const retry = useCallback(() => {
    if (youthEnabled === null) retryPreferences();
    setRetryRevision((value) => value + 1);
  }, [youthEnabled, retryPreferences]);
  const referenceDate = useLocalReferenceDate(profile?.timeZone ?? "Europe/Berlin");
  const request = useMemo<AnnualAnalysisRequest | null>(
    () =>
      enabled && profile !== null && youthEnabled !== null
        ? {
            year,
            entries,
            profile,
            ruleResolver,
            tariffDecisions,
            workPatternSettings,
            referenceDate,
            youthProtection: youthEnabled,
          }
        : null,
    [
      enabled,
      profile,
      youthEnabled,
      year,
      entries,
      ruleResolver,
      tariffDecisions,
      workPatternSettings,
      referenceDate,
    ],
  );
  const input = useRef(request);
  useLayoutEffect(() => {
    input.current = request;
  }, [request]);
  const key = useMemo(() => (request === null ? null : annualAnalysisKey(request)), [request]);
  const resolver = request?.ruleResolver ?? null;
  const cached =
    request !== null && key !== null ? readAnnualAnalysis(request, key, persistent) : null;
  const matches = (candidate: AnnualReportState | null) =>
    key !== null &&
    candidate?.key === key &&
    candidate.resolver === resolver &&
    candidate.persistent === persistent &&
    candidate.revision === retryRevision;
  const matching = matches(state) ? state : null;
  const core = matches(coreState) ? coreState : null;
  const settled = cached !== null || matching !== null;
  useEffect(() => {
    const current = input.current;
    if (!active || current === null || key === null || settled) return;
    let subscribed = true;
    const snapshot = { key, resolver: current.ruleResolver, persistent, revision: retryRevision };
    const lease = requestAnnualAnalysis(
      current,
      key,
      persistent,
      -1,
      (report) => {
        if (subscribed) setState({ ...snapshot, report, fatalError: null });
      },
      (error) => {
        if (subscribed)
          setState({
            ...snapshot,
            report: null,
            fatalError:
              error instanceof Error ? error : new Error("Annual report computation failed."),
          });
      },
      (report) => {
        if (subscribed) setCoreState({ ...snapshot, report, fatalError: null });
      },
    );
    return () => {
      subscribed = false;
      lease.cancel();
    };
  }, [active, key, resolver, persistent, settled, retryRevision]);
  const report = cached ?? matching?.report ?? null;
  const coreReport = core?.report ?? null;
  const fatalError = matching?.fatalError ?? null;
  useLayoutEffect(() => {
    if (!enabled) return;
    calendarPerformance.record("analysis-result-commit", {
      month: year * 100 + 1,
      stage: 4,
      mode: active ? 1 : 0,
      state: report !== null ? 2 : coreReport !== null ? 1 : fatalError !== null ? 3 : 0,
    });
  }, [enabled, active, year, key, report, coreReport, fatalError]);
  return {
    coreReport,
    error: youthEnabled === null ? preferenceError : null,
    fatalError,
    report,
    ruleFailure: null,
    retry,
  };
}
