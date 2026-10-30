import { projectRegularPayShifts } from "./special-duty";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import type { SfnNetPayResult, SfnShift } from "@/domain/net-pay-sfn";
import type { MonthlyPayEstimate, ShiftEntry, UserProfile } from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
import { calculateMonthlyNetPayWithSfn } from "./net-pay-with-sfn";
import { calculateTvoedShiftPremiumTrace } from "./simple-pay";
import { isPayWorkShift } from "./tvoed-pattern";
import { calculateTimedShiftBounds } from "./working-time";
import { specialDutyPayrollTraces } from "./special-duty-payroll-trace";

export function isTvoedSfnForecastProfile(profile: UserProfile): boolean {
  return Boolean(
    profile.tariff &&
    !profile.salaryBasisConflict &&
    profile.manualMonthlyGrossCents == null &&
    !profile.nursingTrainingTariff &&
    !profile.vkaETariff &&
    !profile.tvlKrTariff &&
    !profile.tvUkNursingTariff &&
    !profile.tvhKrTariff &&
    !profile.tvalPflegeTariff,
  );
}

function unavailable(reason: string): SfnNetPayResult {
  return { status: "unavailable", stage: "sfn", reason };
}

function cents(euros: number): number {
  const result = Math.round(euros * 100);
  if (!Number.isSafeInteger(result) || result < 0 || Math.abs(euros * 100 - result) > 0.000001)
    throw new Error("Die Gehaltsprognose enthält ungültige Geldbeträge.");
  return result;
}

/** Conditional PLANNED forecast. Confirmation never asserts that planned work already occurred. */
export function calculateTvoedNetPayForecast(
  input: {
    readonly month: string;
    readonly profile: UserProfile;
    readonly settings: MonthlyNetPaySettings;
    readonly shifts: readonly ShiftEntry[];
    readonly pay: MonthlyPayEstimate;
    readonly regularMonthlySocialInsuranceGrossCents: number;
    readonly assumptionsConfirmed: boolean;
  },
  ruleResolver: RuleResolver,
): SfnNetPayResult {
  const { month, profile, settings, pay } = input;
  if (!isTvoedSfnForecastProfile(profile))
    return unavailable("Die automatische Zuschlagszuordnung unterstützt derzeit nur TVöD-P.");
  if (profile.timeZone !== "Europe/Berlin")
    return unavailable("Die automatische Prognose benötigt die Zeitzone Europe/Berlin.");
  if (settings.month !== month || pay.month !== month)
    return unavailable("Die Berechnungsgrundlagen gehören zu unterschiedlichen Monaten.");
  if (!input.assumptionsConfirmed)
    return unavailable("Bestätige zunächst die Grundlagen dieser bedingten Dienstplan-Prognose.");
  if (!pay.available || pay.estimatedGrossAmount === null || pay.personalBaseAmount === null)
    return unavailable("Die vollständige Gehaltsprognose fehlt.");
  if (settings.sfnBasicHourlyPayCents === null)
    return unavailable("Ergänze den steuerlichen SFN-Grundlohn in den monatlichen Angaben.");
  try {
    const grossCents = cents(pay.estimatedGrossAmount);
    const components = [
      pay.specialDutyAmount ?? 0,
      pay.personalBaseAmount,
      pay.timePremiumAmount,
      pay.overtimeAmount,
      pay.allowanceAmount,
      pay.tvoedAllowanceAmount,
      pay.careAllowanceAmount,
    ];
    if (components.reduce((sum, value) => sum + cents(value), 0) !== grossCents)
      return unavailable("Die Bestandteile der Gehaltsprognose passen nicht zum Gesamtbrutto.");
    const monthShifts = projectRegularPayShifts(input.shifts).filter(
      (shift) => shift.deletedAt === null && shift.date.startsWith(`${month}-`),
    );
    if (
      monthShifts.some(
        (shift) =>
          ["EARLY", "LATE", "NIGHT", "DAY", "CUSTOM"].includes(shift.type) &&
          !isPayWorkShift(shift),
      )
    )
      return unavailable("Eine Schicht hat keine vollständigen Arbeits- und Pausenzeiten.");
    const shifts = monthShifts.filter(
      (shift) =>
        shift.deletedAt === null && shift.date.startsWith(`${month}-`) && isPayWorkShift(shift),
    );
    if (shifts.length > 100 || shifts.length !== pay.shiftBreakdowns.length)
      return unavailable("Die Schichten passen nicht zur Gehaltsprognose.");
    const sfnShifts: SfnShift[] = [];
    let premiumTotal = 0;
    let overtimeTotal = 0;
    for (const shift of shifts) {
      const bounds = calculateTimedShiftBounds(shift, profile.timeZone);
      if (
        !bounds ||
        !Number.isInteger(shift.breakMinutes) ||
        shift.breakMinutes < 0 ||
        shift.breakMinutes >= bounds.grossMinutes
      )
        return unavailable("Eine Schicht hat keine vollständigen Arbeits- und Pausenzeiten.");
      const trace = calculateTvoedShiftPremiumTrace(shift, profile, ruleResolver);
      const recorded = pay.shiftBreakdowns.find((item) => item.shiftId === shift.id);
      if (!recorded || JSON.stringify(recorded) !== JSON.stringify(trace.breakdown))
        return unavailable("Die Zuschlagszeitspur stimmt nicht mit der Gehaltsprognose überein.");
      const payments = trace.premiums.map((premium) => ({
        id: `${shift.id}:${premium.ruleId}`,
        kind:
          premium.premiumType === "NIGHT"
            ? ("NIGHT" as const)
            : [
                  "SUNDAY",
                  "HOLIDAY_WITH_TIME_OFF",
                  "HOLIDAY_WITHOUT_TIME_OFF",
                  "PRE_HOLIDAY",
                ].includes(premium.premiumType)
              ? ("DAY" as const)
              : ("OTHER" as const),
        amountCents: cents(premium.line.amount),
        additionalToBasicPay: true,
        periods: premium.periods,
      }));
      premiumTotal += payments.reduce((sum, value) => sum + value.amountCents, 0);
      overtimeTotal += cents(recorded.overtimeBaseAmount) + cents(recorded.overtimePremiumAmount);
      sfnShifts.push({
        id: shift.id,
        start: trace.start,
        end: trace.end,
        unpaidBreaks: trace.unpaidBreaks,
        payments,
      });
    }
    if (
      premiumTotal !== cents(pay.timePremiumAmount) ||
      overtimeTotal !== cents(pay.overtimeAmount)
    )
      return unavailable("Die Zuschlagssummen passen nicht zur Gehaltsprognose.");
    return calculateMonthlyNetPayWithSfn(
      {
        payroll: {
          month,
          completeGross: true,
          grossCents,
          regularMonthlySocialInsuranceGrossCents: input.regularMonthlySocialInsuranceGrossCents,
          basicHourlyPayCents: settings.sfnBasicHourlyPayCents,
          workplace: { federalState: profile.federalState, holidayRegion: profile.holidayRegion },
          workEvidence: "PLANNED",
          monthAttribution: "SHIFT_START",
          shifts: [...sfnShifts, ...specialDutyPayrollTraces(pay.specialDutyBreakdowns ?? [])],
        },
        profile: settings.profile,
        specialCases: settings.specialCases,
      },
      ruleResolver,
    );
  } catch {
    return unavailable(
      "Arbeitszeiten, Tarif- oder Feiertagsregeln konnten nicht vollständig zugeordnet werden.",
    );
  }
}
