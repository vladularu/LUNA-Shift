import { useMemo, useState } from "react";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTariff,
  usePflegeShiftTestData,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import { calculateMonthlyPayEstimate } from "@/engine/simple-pay";
import { selectTvhKrAssessmentShifts } from "@/engine/simple-tvh-kr-profile-pay";
import { selectTvUkAssessmentShifts } from "@/engine/simple-tvuk-nursing-profile-pay";
import { selectTvlKrAssessmentShifts } from "@/engine/simple-tvl-kr-profile-pay";
import { selectVkaEAssessmentShifts } from "@/engine/simple-vka-e-pay";
import { selectNursingTrainingAssessmentShifts } from "@/engine/simple-nursing-training-pay";
import {
  selectAllowanceShifts,
  selectMonthlyAnalysisEntries,
} from "@/features/analysis/analysis-data";
import { captureRuleComputation } from "@/features/analysis/rule-computation";

export function useSalaryReport(month: string, enabled = true) {
  const { error, ready, reload } = usePflegeShiftStatus();
  const { profile } = usePflegeShiftProfile();
  const { entries } = usePflegeShiftEntries();
  const { tariffDecisions, workPatternSettings } = usePflegeShiftTariff();
  const { testMonths } = usePflegeShiftTestData();
  const { resolver: ruleResolver } = useRuleCatalogRuntime();
  const [ruleRetryRevision, setRuleRetryRevision] = useState(0);
  const calculation = useMemo(() => {
    void ruleRetryRevision;
    if (!enabled || !ready || error !== null || profile === null) return null;
    return captureRuleComputation(() => {
      const monthlyEntries = selectMonthlyAnalysisEntries(entries, month);
      const allowanceShifts = profile.tvhKrTariff
        ? selectTvhKrAssessmentShifts(entries, month)
        : profile.tvUkNursingTariff
          ? selectTvUkAssessmentShifts(entries, month)
          : profile.tvlKrTariff || profile.tvalPflegeTariff
            ? selectTvlKrAssessmentShifts(entries, month)
            : profile.vkaETariff
              ? selectVkaEAssessmentShifts(entries, month)
              : profile.nursingTrainingTariff
                ? selectNursingTrainingAssessmentShifts(entries, month)
                : profile.tariff === null
                  ? monthlyEntries.monthShifts
                  : selectAllowanceShifts(entries, month, ruleResolver);
      const decision = tariffDecisions.find((item) => item.month === month) ?? null;
      return {
        monthShifts: monthlyEntries.monthShifts,
        pay: calculateMonthlyPayEstimate(
          month,
          monthlyEntries.monthShifts,
          profile,
          decision,
          allowanceShifts,
          workPatternSettings,
          ruleResolver,
        ),
      };
    });
  }, [
    enabled,
    entries,
    error,
    month,
    profile,
    ready,
    ruleResolver,
    ruleRetryRevision,
    tariffDecisions,
    workPatternSettings,
  ]);

  return {
    error,
    ready,
    reload,
    profile,
    entries,
    calculation,
    testMonths,
    retryRules: () => setRuleRetryRevision((value) => value + 1),
  };
}
