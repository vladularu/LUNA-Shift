import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useIsFocused } from "expo-router";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTariff,
  usePflegeShiftTestData,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import type { ShiftEntry } from "@/domain/types";
import { useAnalysisSalaryInputs } from "./analysis-salary-inputs";
import { usePreparedAnalysisSalary } from "./use-prepared-analysis-salary";
import { usePreparedMonthlyAnalysis } from "./use-prepared-monthly-analysis";
import { useDeferredMonthlyCompliance } from "./use-monthly-compliance";
import { analysisWorkPriority } from "./analysis-work-queue";
import { useAnalysisPersistentResults } from "./analysis-persistent-results";
const EMPTY_SHIFTS: readonly ShiftEntry[] = Object.freeze([]);

function usePrepareMonth(month: string, active: boolean, enabled: boolean, distance: number) {
  const isFocused = useIsFocused();
  const status = usePflegeShiftStatus();
  const { profile: savedProfile, calculationProfile } = usePflegeShiftProfile();
  const profile = calculationProfile ?? savedProfile;
  const { entries } = usePflegeShiftEntries();
  const { tariffDecisions, workPatternSettings } = usePflegeShiftTariff();
  const { testMonths } = usePflegeShiftTestData();
  const { resolver: ruleResolver } = useRuleCatalogRuntime();
  const canPrepare = enabled && isFocused && status.ready && status.error === null;
  const storedResults = useAnalysisPersistentResults();
  const persistent = canPrepare && !testMonths.includes(month) ? storedResults : null;
  const salaryPayments = useAnalysisSalaryInputs(month, canPrepare && !testMonths.includes(month));
  const salaryRequest = useMemo(() => {
    if (
      !canPrepare ||
      savedProfile === null ||
      testMonths.includes(month) ||
      salaryPayments.status !== "ready"
    )
      return null;
    return {
      month,
      profile: savedProfile,
      settings: salaryPayments.saved?.settings ?? null,
      annualPayments: salaryPayments.annualPayments,
      context: {
        entries,
        tariffDecisions,
        workPatternSettings,
        resolver: ruleResolver,
        testMonths,
      },
    };
  }, [
    canPrepare,
    savedProfile,
    testMonths,
    month,
    salaryPayments.status,
    salaryPayments.saved,
    salaryPayments.annualPayments,
    entries,
    tariffDecisions,
    workPatternSettings,
    ruleResolver,
  ]);
  const salary = usePreparedAnalysisSalary(salaryRequest, active, distance, persistent);
  const monthlyRequest = useMemo(
    () =>
      canPrepare && profile !== null
        ? { month, entries, profile, tariffDecisions, workPatternSettings, ruleResolver }
        : null,
    [canPrepare, profile, month, entries, tariffDecisions, workPatternSettings, ruleResolver],
  );
  const monthlyData = usePreparedMonthlyAnalysis(monthlyRequest, active, distance, persistent);
  const monthlyCompliance = useDeferredMonthlyCompliance({
    enabled: canPrepare && monthlyData !== null && monthlyData.complianceShifts.ok,
    month,
    priority: analysisWorkPriority(2, active, distance),
    persistent,
    profile,
    ruleResolver,
    shifts:
      monthlyData?.complianceShifts.ok === true ? monthlyData.complianceShifts.value : EMPTY_SHIFTS,
  });
  return {
    ...status,
    profile,
    savedProfile,
    entries,
    tariffDecisions,
    workPatternSettings,
    testMonths,
    ruleResolver,
    salaryPayments,
    salaryRequest,
    salary,
    monthlyData,
    monthlyCompliance,
  };
}
const MonthData = createContext<ReturnType<typeof usePrepareMonth> | null>(null);
/** Retains preparation state when a headless future month becomes a visible report page. */
export function AnalysisMonthDataProvider({
  month,
  active,
  enabled,
  distance,
  children,
}: {
  readonly month: string;
  readonly active: boolean;
  readonly enabled: boolean;
  readonly distance: number;
  readonly children: ReactNode;
}) {
  const data = usePrepareMonth(month, active, enabled, distance);
  return <MonthData.Provider value={data}>{children}</MonthData.Provider>;
}
export function useAnalysisMonthData() {
  const value = useContext(MonthData);
  if (value === null) throw new Error("Die vorbereitete Monatsansicht fehlt.");
  return value;
}
