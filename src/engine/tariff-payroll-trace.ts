import type {
  AllowanceStatus,
  ShiftEntry,
  ShiftPremiumBreakdown,
  UserProfile,
} from "@/domain/types";
import type { SfnShift } from "@/domain/net-pay-sfn";
import type { RuleResolver } from "@/rules/rule-resolver";
import { calculateTvoedShiftPremiumTrace } from "./simple-pay";
import { calculateVkaEShift } from "./simple-vka-e-pay";
import { calculateNursingTrainingShift } from "./simple-nursing-training-pay";
import { calculateTvlKrShift } from "./simple-tvl-kr-pay";
import { calculateTvhKrShift } from "./simple-tvh-kr-pay";
import { calculateTvUkNursingShift } from "./simple-tvuk-nursing-pay";
import { calculateTvalPflegeShift } from "./simple-tval-pflege-pay";
import { premiumCategory, premiumKind } from "./net-pay-premium-trace";
import { payrollTariffContinuation } from "./payroll-tariff-continuation";
import { isPayrollTariffContinuation } from "./payroll-tariff-dates";

/** The same dated tariff calculation for regular shifts and actual callout intervals. */
export function tariffPayrollTrace(
  shift: ShiftEntry,
  profile: UserProfile,
  context: {
    readonly allowanceStatus: AllowanceStatus;
    readonly saturdayShiftWork: boolean;
    readonly regularShiftWork: boolean;
  },
  resolver: RuleResolver,
): {
  readonly breakdown: ShiftPremiumBreakdown;
  readonly trace: SfnShift;
  readonly nightCompensatoryMinutes: number;
} {
  if (!isPayrollTariffContinuation(resolver)) {
    resolver = payrollTariffContinuation(resolver, shift.date.slice(0, 7)).resolver;
  }
  let breakdown: ShiftPremiumBreakdown;
  let trace: SfnShift | undefined;
  let nightCompensatoryMinutes = 0;
  if (profile.tvalPflegeTariff)
    breakdown = calculateTvalPflegeShift(
      shift,
      profile,
      profile.tvalPflegeTariff,
      context.saturdayShiftWork,
      resolver,
      true,
    );
  else if (profile.tvhKrTariff)
    breakdown = calculateTvhKrShift(shift, profile, profile.tvhKrTariff, context, resolver, true);
  else if (profile.tvUkNursingTariff) {
    const uk = calculateTvUkNursingShift(
      shift,
      profile,
      profile.tvUkNursingTariff,
      context,
      resolver,
      true,
    );
    breakdown = uk;
    nightCompensatoryMinutes = uk.nightCompensatoryMinutes;
  } else if (profile.tvlKrTariff)
    breakdown = calculateTvlKrShift(
      shift,
      profile,
      { payGroup: profile.tvlKrTariff.payGroup, payLevel: profile.tvlKrTariff.payLevel },
      profile.tvlKrTariff.universityRegion,
      context.saturdayShiftWork,
      resolver,
      true,
    );
  else if (profile.vkaETariff || profile.nursingTrainingTariff) {
    breakdown = profile.vkaETariff
      ? calculateVkaEShift(shift, profile, resolver, true)
      : calculateNursingTrainingShift(shift, profile, resolver, true);
  } else if (profile.tariff) {
    const dated = calculateTvoedShiftPremiumTrace(shift, profile, resolver);
    breakdown = dated.breakdown;
    trace = {
      id: shift.id,
      start: dated.start,
      end: dated.end,
      unpaidBreaks: dated.unpaidBreaks,
      payments: dated.premiums.map((p) => ({
        id: `${shift.id}:${p.ruleId}`,
        kind: premiumKind(p.premiumType),
        category: premiumCategory(p.premiumType),
        amountCents: Math.round(p.line.amount * 100),
        additionalToBasicPay: true,
        periods: p.periods,
      })),
    };
  } else throw new Error("Für diese Gehaltsbasis fehlt eine vollständige Tarifberechnung.");
  const { payrollTrace, ...cashBreakdown } = breakdown;
  trace = payrollTrace ?? trace;
  if (!trace) throw new Error("Die Zuschläge konnten nicht vollständig berechnet werden.");
  return { breakdown: cashBreakdown, trace, nightCompensatoryMinutes };
}
