import { useMemo } from "react";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftTariff,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import {
  calculateAutomaticNetPayForecast,
  type AutomaticNetPayForecast,
} from "@/engine/net-pay-automatic-forecast";
import { createAutomaticNetPayCache } from "@/engine/net-pay-automatic-cache";
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

const cachedForecast = createAutomaticNetPayCache();

export function useAutomaticNetPay(
  month: string,
  settings: MonthlyNetPaySettings | null,
  enabled: boolean,
) {
  const { entries } = usePflegeShiftEntries();
  const { profile } = usePflegeShiftProfile();
  const { tariffDecisions, workPatternSettings } = usePflegeShiftTariff();
  const { resolver } = useRuleCatalogRuntime();
  return useMemo<AutomaticNetPayForecast | null>(() => {
    if (!enabled || !profile || !settings) return null;
    try {
      const shifts = selectMonthlyAnalysisEntries(entries, month).monthShifts;
      const assessment = profile.tvhKrTariff
        ? selectTvhKrAssessmentShifts(entries, month)
        : profile.tvUkNursingTariff
          ? selectTvUkAssessmentShifts(entries, month)
          : profile.tvlKrTariff || profile.tvalPflegeTariff
            ? selectTvlKrAssessmentShifts(entries, month)
            : profile.vkaETariff
              ? selectVkaEAssessmentShifts(entries, month)
              : profile.nursingTrainingTariff
                ? selectNursingTrainingAssessmentShifts(entries, month)
                : !profile.tariff
                  ? shifts
                  : selectAllowanceShifts(entries, month, resolver);
      const pay = calculateMonthlyPayEstimate(
        month,
        shifts,
        profile,
        tariffDecisions.find((d) => d.month === month) ?? null,
        assessment,
        workPatternSettings,
        resolver,
      );
      const input = { month, profile, settings, shifts, pay };
      return cachedForecast(input, resolver, () =>
        calculateAutomaticNetPayForecast(input, resolver),
      );
    } catch {
      return {
        sourceMonth: settings.month,
        result: {
          status: "unavailable" as const,
          stage: "sfn" as const,
          reason: "Die vollständige Gehaltsprognose konnte nicht berechnet werden.",
        },
      };
    }
  }, [enabled, profile, settings, entries, month, tariffDecisions, workPatternSettings, resolver]);
}
