import { employmentWorkPatternAt } from "@/domain/employment-history";
import type {
  MonthlyTariffDecision,
  AllowanceStatus,
  ShiftEntry,
  TvoedWorkPatternSettings,
  UserProfile,
} from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
import { payrollEmploymentPeriods } from "./payroll-employment-periods";
import { calculateShiftPremiumBreakdown, DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "./simple-pay";
import { calculateTvlKrAssessment } from "./simple-tvl-kr-profile-pay";
import { calculateTvUkNursingAssessment } from "./simple-tvuk-nursing-profile-pay";
import { calculateTvalPflegeAssessment } from "./simple-tval-pflege-profile-pay";
import { calculateTvhKrAssessment } from "./simple-tvh-kr-profile-pay";
import { calculateTvhKrShift } from "./simple-tvh-kr-pay";
import { isPayWorkShift } from "./tvoed-pattern";
import { prepareNightSequenceSteps } from "./tvoed-k-calendar-nights";

/** Warm the exact cash inputs used below by the authoritative monthly calculator. */
export function* prepareMonthlyPaySteps(
  month: string,
  shifts: readonly ShiftEntry[],
  profile: UserProfile,
  decision: MonthlyTariffDecision | null,
  assessmentShifts: readonly ShiftEntry[],
  settings: TvoedWorkPatternSettings | undefined,
  resolver: RuleResolver,
): Generator<number, void, void> {
  try {
    const periods = payrollEmploymentPeriods(profile, month, month + "-31");
    if (periods.length !== 1) return;
    profile = periods[0].profile;
    if (
      profile.vkaETariff?.sector === "BT_K" ||
      profile.tariff?.sector === "BT_K" ||
      profile.nursingTrainingTariff?.sector === "BT_K"
    )
      yield* prepareNightSequenceSteps(assessmentShifts, month, profile.timeZone);
    if (!shifts.some(isPayWorkShift)) return;
    let shiftWork = false;
    let allowanceStatus: AllowanceStatus = "NONE";
    const pattern = employmentWorkPatternAt(
      profile,
      settings ?? DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
      month + "-01",
    );
    if (profile.tvalPflegeTariff || profile.tvhKrTariff) {
      const assessment = profile.tvalPflegeTariff
        ? calculateTvalPflegeAssessment(month, assessmentShifts, pattern, resolver).assessment
        : calculateTvhKrAssessment(month, assessmentShifts, pattern, profile.timeZone).assessment;
      allowanceStatus = decision?.allowanceStatus ?? assessment?.suggestedAllowance ?? "NONE";
      shiftWork =
        assessment?.shiftWork === "DETECTED" ||
        assessment?.alternatingShiftWork === "DETECTED" ||
        allowanceStatus !== "NONE";
    } else if (profile.tvUkNursingTariff) {
      shiftWork =
        calculateTvUkNursingAssessment(month, assessmentShifts).assessment.shiftWork === "DETECTED";
    } else if (profile.tvlKrTariff) {
      const assessment = calculateTvlKrAssessment(
        month,
        assessmentShifts,
        pattern,
        resolver,
      ).assessment;
      const allowance = decision?.allowanceStatus ?? assessment?.suggestedAllowance ?? "NONE";
      shiftWork =
        assessment?.shiftWork === "DETECTED" ||
        assessment?.alternatingShiftWork === "DETECTED" ||
        allowance !== "NONE";
    } else if (!profile.tariff && !profile.nursingTrainingTariff && !profile.vkaETariff) return;
    for (const shift of shifts) {
      if (!isPayWorkShift(shift)) continue;
      if (profile.tvhKrTariff && !profile.tvalPflegeTariff)
        calculateTvhKrShift(
          shift,
          profile,
          profile.tvhKrTariff,
          { allowanceStatus, saturdayShiftWork: shiftWork },
          resolver,
        );
      else calculateShiftPremiumBreakdown(shift, profile, resolver, shiftWork);
      yield 1;
    }
  } catch {
    // The complete calculator retains its original validation, eligibility and error handling.
  }
}
