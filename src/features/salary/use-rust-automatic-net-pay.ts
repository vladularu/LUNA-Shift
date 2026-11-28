import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftTariff,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import {
  collectAnnualSalaryPayments,
  type MonthlyNetPaySettings,
  type SavedMonthlyNetPaySettings,
} from "@/domain/net-pay-profile";
import type { SalaryPerspective } from "@/domain/salary-payment";
import type { AutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import {
  analysisSalaryKey,
  readAnalysisSalary,
  type AnalysisSalaryRequest,
  type PreparedAnalysisSalary,
} from "@/features/analysis/analysis-salary";
import { useAnalysisPersistentResults } from "@/features/analysis/analysis-persistent-results";
import { useMonthlyRustNetCalculator } from "@/features/analysis/use-monthly-rust-net-calculator";
import {
  monthlyRustNetRequest,
  monthlyRustNetSteps,
  readMonthlyRustNetForecast,
} from "@/features/analysis/monthly-rust-net";
import {
  isMonthlyNetForecast,
  persistentSalaryValue,
} from "@/features/analysis/persistent-salary-value";
import {
  readSharedAnalysisResult,
  requestSharedAnalysis,
} from "@/features/analysis/shared-analysis-tasks";
import { useSalaryPaymentPreferences } from "./salary-payment-preferences";
import { useRustSalaryPreparation } from "./use-rust-salary-preparation";

const EMPTY: readonly SavedMonthlyNetPaySettings[] = Object.freeze([]);
const NO_TESTS: readonly string[] = Object.freeze([]);

/** Data hook only. Existing pages receive their original nullable forecast DTO. */
function useOriginalRustAutomaticNetPay(
  month: string,
  settings: MonthlyNetPaySettings | null,
  enabled: boolean,
  testMonths: readonly string[] = NO_TESTS,
  sourceSettings: readonly SavedMonthlyNetPaySettings[] = EMPTY,
  perspective: SalaryPerspective = "PAYOUT",
): AutomaticNetPayForecast | null {
  const { entries } = usePflegeShiftEntries();
  const { profile: savedProfile, calculationProfile } = usePflegeShiftProfile();
  const profile = calculationProfile ?? savedProfile;
  const { tariffDecisions, workPatternSettings } = usePflegeShiftTariff();
  const { resolver, diagnosis } = useRuleCatalogRuntime();
  const payment = useSalaryPaymentPreferences();
  const calculator = useMonthlyRustNetCalculator(diagnosis);
  const persistent = useAnalysisPersistentResults();
  const request = useMemo<AnalysisSalaryRequest | null>(() => {
    if (
      !enabled ||
      !profile ||
      !settings ||
      !calculator ||
      (perspective === "PAYOUT" && !payment.ready)
    )
      return null;
    return monthlyRustNetRequest(
      {
        month,
        profile,
        settings,
        annualPayments:
          perspective === "PAYOUT"
            ? collectAnnualSalaryPayments(sourceSettings)
            : (settings.automation?.annualPayments ?? []),
        ...(perspective === "PAYOUT"
          ? { payment: { preferences: payment.preferences, perspective, sourceSettings } }
          : {}),
        context: { entries, tariffDecisions, workPatternSettings, resolver, testMonths },
      },
      calculator,
    );
  }, [
    enabled,
    profile,
    settings,
    calculator,
    perspective,
    payment.ready,
    payment.preferences,
    month,
    sourceSettings,
    entries,
    tariffDecisions,
    workPatternSettings,
    resolver,
    testMonths,
  ]);
  const key = useMemo(() => (request ? analysisSalaryKey(request) : null), [request]);
  const latest = useRef(request);
  useLayoutEffect(() => {
    latest.current = request;
  }, [request]);
  const [state, setState] = useState<{
    key: string;
    resolver: typeof resolver;
    value: AutomaticNetPayForecast;
  } | null>(null);
  const full =
    request && key && perspective === "PAYOUT"
      ? (readAnalysisSalary(request, key) ??
        readSharedAnalysisResult<PreparedAnalysisSalary>("salary", key, resolver, persistent))
      : null;
  const cached =
    request && calculator
      ? (full?.forecast ?? readMonthlyRustNetForecast(request, calculator))
      : null;
  const matching = state?.key === key && state.resolver === resolver ? state.value : null;
  const value = cached ?? matching;
  useEffect(() => {
    const input = latest.current;
    if (!input || !key || !calculator || value) return;
    const task = requestSharedAnalysis<AutomaticNetPayForecast>({
      kind: "salary",
      key: "native-net:" + key,
      month: input.month,
      resolver,
      persistent: null,
      priority: 3,
      accept: (result): result is AutomaticNetPayForecast => isMonthlyNetForecast(result, input),
      retain: (result) => result.result.status === "available",
      steps: function* () {
        let restored: PreparedAnalysisSalary | null = null;
        if (persistent && perspective === "PAYOUT") {
          yield persistent
            .read(
              "salary",
              input.month,
              key,
              resolver,
              (result): result is PreparedAnalysisSalary => persistentSalaryValue(result, input),
            )
            .then((result) => {
              restored = result;
            });
          const saved = restored as PreparedAnalysisSalary | null;
          if (saved?.forecast) return saved.forecast;
        }
        return yield* monthlyRustNetSteps(input, calculator);
      },
      complete: (result) => setState({ key, resolver, value: result }),
      fail: () =>
        setState({
          key,
          resolver,
          value: {
            sourceMonth: input.settings?.month ?? input.month,
            result: {
              status: "unavailable",
              stage: "sfn",
              reason: "Die vollständige Gehaltsprognose konnte nicht berechnet werden.",
            },
          },
        }),
    });
    return () => task.cancel();
  }, [key, resolver, calculator, value, persistent, perspective]);
  return value;
}

export function usePreparedRustAutomaticNetPay(
  month: string,
  settings: MonthlyNetPaySettings | null,
  enabled: boolean,
  testMonths: readonly string[] = NO_TESTS,
  sourceSettings: readonly SavedMonthlyNetPaySettings[] = EMPTY,
  perspective: SalaryPerspective = "PAYOUT",
): AutomaticNetPayForecast | null {
  const overrides = useMemo(
    () => ({ settings, sourceSettings, testMonths }),
    [settings, sourceSettings, testMonths],
  );
  const prepared = useRustSalaryPreparation(month, enabled && perspective === "PAYOUT", overrides);
  const earned = useOriginalRustAutomaticNetPay(
    month,
    settings,
    enabled && perspective === "EARNED",
    testMonths,
    sourceSettings,
    perspective,
  );
  if (perspective === "EARNED") return earned;
  if (!enabled) return null;
  return (
    prepared.result?.forecast ??
    (prepared.error
      ? {
          sourceMonth: settings?.month ?? month,
          result: {
            status: "unavailable",
            stage: "sfn",
            reason: "Die vollständige Gehaltsprognose konnte nicht berechnet werden.",
          },
        }
      : null)
  );
}

export const useRustAutomaticNetPay: typeof useOriginalRustAutomaticNetPay =
  process.env.EXPO_PUBLIC_RUST_SALARY_PREPARATION === "1"
    ? usePreparedRustAutomaticNetPay
    : useOriginalRustAutomaticNetPay;

function useDisabledRustNetPay(): null {
  return null;
}
export const useOptionalRustAutomaticNetPay: typeof useRustAutomaticNetPay =
  process.env.EXPO_PUBLIC_RUST_NET_BRIDGE === "1" ? useRustAutomaticNetPay : useDisabledRustNetPay;
