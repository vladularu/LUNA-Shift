import { employmentProfileAt } from "@/domain/employment-history";
import type {
  CalendarEntry,
  MonthlyTariffDecision,
  TvoedWorkPatternSettings,
  UserProfile,
} from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
import { calculateMonthlyPayEstimate } from "@/engine/simple-pay";
import { prepareMonthlyPaySteps } from "@/engine/prepare-monthly-pay";
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
  profile = employmentProfileAt(profile, month + "-01");
  const { tariffDecisions, workPatternSettings, resolver } = context;
  const { shifts, assessment } = selectSalaryMonthEntries(month, profile, context);
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

/** The exact existing selectors, shared by the input and its content key. Profile is dated. */
function selectSalaryMonthEntries(
  month: string,
  profile: UserProfile,
  context: SalaryMonthContext,
) {
  const { entries, resolver } = context;
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
  return { shifts, assessment };
}

/** Covers every possible existing annual reference month, plus the requested net month. */
export function salaryEntryDependencies(
  year: number,
  profile: UserProfile,
  context: SalaryMonthContext,
  month?: string,
) {
  const months = new Set([7, 8, 9, 10, 11].map((m) => `${year}-${String(m).padStart(2, "0")}`));
  if (month) months.add(month);
  return [...months].map((value) =>
    selectSalaryMonthEntries(value, employmentProfileAt(profile, value + "-01"), context),
  );
}

export function* salaryMonthInputSteps(
  month: string,
  profile: UserProfile,
  context: SalaryMonthContext,
): Generator<number, ReturnType<typeof salaryMonthInput>, void> {
  const dated = employmentProfileAt(profile, month + "-01");
  const { shifts, assessment } = selectSalaryMonthEntries(month, dated, context);
  yield* prepareMonthlyPaySteps(
    month,
    shifts,
    dated,
    context.tariffDecisions.find((d) => d.month === month) ?? null,
    assessment,
    context.workPatternSettings,
    context.resolver,
  );
  return salaryMonthInput(month, profile, context);
}
