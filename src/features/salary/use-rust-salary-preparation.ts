import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useSQLiteContext } from "expo-sqlite";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTariff,
  usePflegeShiftTestData,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import {
  collectAnnualSalaryPayments,
  resolveNetPaySettings,
  type MonthlyNetPaySettings,
  type SavedMonthlyNetPaySettings,
} from "@/domain/net-pay-profile";
import { analysisSalaryKey, type AnalysisSalaryRequest } from "@/features/analysis/analysis-salary";
import { useAnalysisPersistentResults } from "@/features/analysis/analysis-persistent-results";
import { usePreparedAnalysisSalary } from "@/features/analysis/use-prepared-analysis-salary";
import { useMonthlyRustNetCalculator } from "@/features/analysis/use-monthly-rust-net-calculator";
import { useSalaryPaymentPreferences } from "./salary-payment-preferences";

interface Overrides {
  readonly settings: MonthlyNetPaySettings | null;
  readonly sourceSettings: readonly SavedMonthlyNetPaySettings[];
  readonly testMonths: readonly string[];
}

/** Existing committed-input store and full salary cache, shared by every consumer. */
export function useRustSalaryPreparation(
  month: string,
  enabled: boolean,
  overrides?: Overrides,
  testMonthsOverride?: readonly string[],
) {
  const db = useSQLiteContext(),
    status = usePflegeShiftStatus();
  const { profile } = usePflegeShiftProfile(),
    { entries } = usePflegeShiftEntries();
  const { tariffDecisions, workPatternSettings } = usePflegeShiftTariff();
  const { testMonths: storedTests } = usePflegeShiftTestData();
  const { resolver, diagnosis } = useRuleCatalogRuntime();
  const payment = useSalaryPaymentPreferences(),
    calculator = useMonthlyRustNetCalculator(diagnosis);
  const store = useMemo(() => {
    // Load existing native salary IO only when this optional hook is invoked.
    const module =
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Preserve the default hook import graph; Metro resolves this literal native-path dependency.
      require("@/features/analysis/analysis-salary-input-store") as typeof import("@/features/analysis/analysis-salary-input-store");
    return module.analysisSalaryInputStore(db);
  }, [db]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    if (enabled && status.ready && !status.error && profile) void store.ensure();
  }, [enabled, status.ready, status.error, profile, store, snapshot.epoch]);
  const timeline = overrides?.sourceSettings ?? snapshot.timeline;
  const testMonths = overrides?.testMonths ?? testMonthsOverride ?? storedTests;
  const projectionIdentity = useMemo(() => {
    if (!profile || !payment.ready) return null;
    return analysisSalaryKey({
      month,
      profile,
      settings: null,
      annualPayments: [],
      netCalculationIdentity: calculator?.cacheIdentity,
      payment: { preferences: payment.preferences, perspective: "PAYOUT", sourceSettings: [] },
      context: { entries, tariffDecisions, workPatternSettings, resolver, testMonths },
    });
  }, [
    month,
    profile,
    payment.ready,
    payment.preferences,
    calculator?.cacheIdentity,
    entries,
    tariffDecisions,
    workPatternSettings,
    resolver,
    testMonths,
  ]);
  const selection = useMemo<{ request: AnalysisSalaryRequest | null; error: string | null }>(() => {
    if (
      !enabled ||
      !status.ready ||
      status.error ||
      !profile ||
      !payment.ready ||
      !calculator?.prepare ||
      (!overrides && snapshot.status !== "ready")
    )
      return { request: null, error: null };
    try {
      const settings = overrides
        ? overrides.settings
        : (resolveNetPaySettings(month, timeline)?.settings ?? null);
      return {
        request: {
          month,
          profile,
          settings,
          annualPayments: collectAnnualSalaryPayments(timeline),
          payment: {
            preferences: payment.preferences,
            perspective: "PAYOUT",
            sourceSettings: timeline,
          },
          context: { entries, tariffDecisions, workPatternSettings, resolver, testMonths },
        },
        error: null,
      };
    } catch {
      return { request: null, error: "Die Netto-Angaben konnten nicht geladen werden." };
    }
  }, [
    enabled,
    status.ready,
    status.error,
    profile,
    payment.ready,
    payment.preferences,
    calculator,
    overrides,
    snapshot.status,
    month,
    timeline,
    entries,
    tariffDecisions,
    workPatternSettings,
    resolver,
    testMonths,
  ]);
  const stored = useAnalysisPersistentResults();
  const request = selection.request;
  const prepared = usePreparedAnalysisSalary(
    request,
    enabled,
    1,
    testMonths.includes(month) ? null : stored,
    calculator,
  );
  const error =
    status.error ??
    (!payment.ready ? payment.error : null) ??
    (!overrides && snapshot.status === "error" ? snapshot.error : null) ??
    selection.error ??
    prepared.error;
  return {
    ...prepared,
    projectionIdentity,
    resolver,
    sourceReady: status.ready && payment.ready,
    sourceError: status.error ?? (!payment.ready ? payment.error : null),
    request,
    error,
    profile,
    entries,
    testMonths,
    payment,
    ready:
      status.ready &&
      payment.ready &&
      !selection.error &&
      (overrides !== undefined || snapshot.status === "ready"),
    reload: async () => {
      prepared.retry();
      await Promise.all([status.reload(), payment.reload(), store.ensure(true)]);
    },
    retry: () => {
      prepared.retry();
      void store.ensure(true);
    },
  };
}
