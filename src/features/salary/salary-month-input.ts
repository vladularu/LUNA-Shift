import type {
  CalendarEntry,
  MonthlyTariffDecision,
  TvoedWorkPatternSettings,
  UserProfile,
} from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
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

export interface SalaryMonthContext {
  readonly entries: readonly CalendarEntry[];
  readonly testMonths?: readonly string[];
  readonly tariffDecisions: readonly MonthlyTariffDecision[];
  readonly workPatternSettings: TvoedWorkPatternSettings;
  readonly resolver: RuleResolver;
}

/** Both ordinary net and annual-payment proposals use the same dated gross calculation. */
export function salaryMonthInput(month: string, profile: UserProfile, context: SalaryMonthContext) {
  const { entries, tariffDecisions, workPatternSettings, resolver } = context;
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
  return {
    shifts,
    pay: calculateMonthlyPayEstimate(
      month,
      shifts,
      profile,
      tariffDecisions.find((d) => d.month === month) ?? null,
      assessment,
      workPatternSettings,
      resolver,
    ),
  };
}
