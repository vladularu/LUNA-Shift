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
import { requestSharedAnalysis } from "./shared-analysis-tasks";

// Full input content and resolver identity isolate years, profiles and rule catalogs.
// Keep only a few immutable results in memory; no new persistent financial data.
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
  const key = useMemo(
    () =>
      request
        ? "annual-net:" +
          JSON.stringify({ ...request, context: { ...request.context, resolver: undefined } })
        : null,
    [request],
  );
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
  const cached = key === null ? null : results.read(resolver, key);
  const matching = key !== null && state?.key === key && state.resolver === resolver ? state : null;
  const settled = cached !== null || matching !== null;
  useEffect(() => {
    const input = currentRequest.current;
    if (!focused || !input || key === null || settled) return;
    let active = true;
    const job = requestSharedAnalysis<AnnualNetPay>({
      // A namespaced, memory-only salary task cannot collide with monthly requests.
      kind: "salary",
      key,
      month: `${input.year}-01`,
      resolver,
      persistent: null,
      priority: -1,
      accept: (value): value is AnnualNetPay =>
        typeof value === "object" && value !== null && "months" in value && "netCents" in value,
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
  }, [focused, key, resolver, settled]);
  const error =
    data.error ??
    payment.error ??
    matching?.error ??
    (data.status === "ready" && !profile ? "Keine Gehaltsgrundlage eingerichtet." : null);
  return {
    report: cached ?? matching?.report ?? null,
    loading: !error && (!request || !settled),
    error,
  };
}
