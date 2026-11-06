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
import { scheduleAnalysisWork } from "./analysis-work-queue";

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
      enabled && focused && data.status === "ready" && payment.ready && profile
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
      focused,
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
        ? JSON.stringify({ ...request, context: { ...request.context, resolver: undefined } })
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
  useEffect(() => {
    const input = currentRequest.current;
    if (!input || key === null) return;
    let active = true;
    const job = scheduleAnalysisWork(
      annualNetPaySteps(input),
      (report) => {
        if (active) setState({ key, resolver, report, error: null });
      },
      () => {
        if (active)
          setState({
            key,
            resolver,
            report: null,
            error: "Die Jahres-Netto-Prognose konnte nicht berechnet werden.",
          });
      },
      -1,
      { month: `${input.year}-01`, stage: 3 },
    );
    return () => {
      active = false;
      job.cancel();
    };
  }, [key, resolver]);
  const matching = key !== null && state?.key === key && state.resolver === resolver ? state : null;
  const error =
    data.error ??
    payment.error ??
    matching?.error ??
    (data.status === "ready" && !profile ? "Keine Gehaltsgrundlage eingerichtet." : null);
  return {
    report: matching?.report ?? null,
    loading: !error && (!request || matching === null),
    error,
  };
}
