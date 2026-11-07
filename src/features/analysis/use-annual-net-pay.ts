import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useIsFocused } from "expo-router";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftTariff,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import type { SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { useSalaryPaymentPreferences } from "@/features/salary/salary-payment-preferences";
import { annualNetPaySteps, type AnnualNetPay, type AnnualNetPayRequest } from "./annual-net-pay";
import { createAnalysisResultCache } from "./analysis-result-cache";
import { useAnalysisPersistentResults } from "./analysis-persistent-results";
import {
  annualNetPayKey,
  annualNetPayPeriod,
  persistentAnnualNetPay,
} from "./annual-net-pay-cache";
import { requestSharedAnalysis } from "./shared-analysis-tasks";

// Full input content and resolver identity isolate years, profiles and rule catalogs.
// SQLite additionally retains validated snapshots across restarts of the same app update.
const results = createAnalysisResultCache<AnnualNetPay>(6);

export interface AnnualNetPayState {
  readonly report: AnnualNetPay | null;
  readonly loading: boolean;
  readonly error: string | null;
}
export function useAnnualNetPay(
  year: number,
  data: {
    readonly status: "loading" | "ready" | "error";
    readonly timeline: readonly SavedMonthlyNetPaySettings[];
    readonly error: string | null;
  },
  enabled: boolean,
  testMonths: readonly string[],
): AnnualNetPayState {
  const focused = useIsFocused();
  const { profile } = usePflegeShiftProfile();
  const { entries } = usePflegeShiftEntries();
  const { tariffDecisions, workPatternSettings } = usePflegeShiftTariff();
  const { resolver } = useRuleCatalogRuntime();
  const payment = useSalaryPaymentPreferences();
  const request = useMemo<AnnualNetPayRequest | null>(
    () =>
      enabled && data.status === "ready" && payment.ready && profile
        ? {
            year,
            profile,
            timeline: data.timeline,
            preferences: payment.preferences,
            context: { entries, tariffDecisions, workPatternSettings, resolver, testMonths },
          }
        : null,
    [
      enabled,
      data.status,
      data.timeline,
      payment.ready,
      payment.preferences,
      profile,
      year,
      entries,
      tariffDecisions,
      workPatternSettings,
      resolver,
      testMonths,
    ],
  );
  const prepared = usePreparedAnnualNetPay(request, focused);
  const error =
    data.error ??
    payment.error ??
    prepared.error ??
    (data.status === "ready" && !profile ? "Keine Gehaltsgrundlage eingerichtet." : null);
  return { ...prepared, loading: !error && prepared.loading, error };
}

// Shared by the mounted background preparation and the visible annual pages.
// Route focus only belongs to the wrapper above, never to the background consumer.
export function usePreparedAnnualNetPay(
  request: AnnualNetPayRequest | null,
  enabled: boolean,
  priority = -1,
): AnnualNetPayState {
  const persistent = useAnalysisPersistentResults();
  const resolver = request?.context.resolver ?? null;
  const key = useMemo(() => (request ? annualNetPayKey(request) : null), [request]);
  const currentRequest = useRef(request);
  useLayoutEffect(() => {
    currentRequest.current = request;
  }, [request]);
  const [state, setState] = useState<{
    key: string;
    resolver: typeof resolver;
    report: AnnualNetPay | null;
    error: string | null;
  } | null>(null);
  const cached = key === null || resolver === null ? null : results.read(resolver, key);
  const matching = key !== null && state?.key === key && state.resolver === resolver ? state : null;
  const settled = cached !== null || matching !== null;
  useEffect(() => {
    const input = currentRequest.current;
    if (!enabled || !input || key === null || resolver === null || settled) return;
    let active = true;
    const job = requestSharedAnalysis<AnnualNetPay>({
      // Dedicated annual period keeps the January salary cache intact.
      kind: "salary",
      key,
      month: annualNetPayPeriod(input.year),
      resolver,
      persistent,
      priority,
      accept: (value): value is AnnualNetPay => persistentAnnualNetPay(value, input.year),
      steps: () => annualNetPaySteps(input),
      complete: (report) => {
        if (active)
          setState({
            key,
            resolver,
            report: results.read(resolver, key) ?? results.write(resolver, key, report),
            error: null,
          });
      },
      fail: () => {
        if (active)
          setState({
            key,
            resolver,
            report: null,
            error: "Die Jahres-Netto-Prognose konnte nicht berechnet werden.",
          });
      },
    });
    return () => {
      active = false;
      job.cancel();
    };
  }, [enabled, key, resolver, settled, priority, persistent]);
  const error = matching?.error ?? null;
  return {
    report: cached ?? matching?.report ?? null,
    loading: !error && (!request || !settled),
    error,
  };
}
