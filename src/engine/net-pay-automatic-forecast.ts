import { projectRegularPayShifts } from "./special-duty";
import { payrollEmploymentPeriods } from "./payroll-employment-periods";
import { employmentProfileAt } from "@/domain/employment-history";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { validateMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { netPayPensionMaxOwnRate } from "@/domain/net-pay-pension-schemes";
import type { SfnNetPayResult, SfnShift } from "@/domain/net-pay-sfn";
import type { MonthlyPayEstimate, ShiftEntry, UserProfile } from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
import { calculateMonthlyNetPay } from "./net-pay";
import { addAnnualSalaryPayment, type AnnualPaymentForecast } from "./net-pay-annual-payment";
import { classifySfnPayroll2026Steps } from "./net-pay-sfn";
import { premiumCategory, premiumKind } from "./net-pay-premium-trace";
import { calculateTvoedShiftPremiumTrace } from "./simple-pay";
import { calculateVkaEShift } from "./simple-vka-e-pay";
import { calculateNursingTrainingShift } from "./simple-nursing-training-pay";
import { calculateTvlKrShift } from "./simple-tvl-kr-pay";
import { calculateTvhKrShift } from "./simple-tvh-kr-pay";
import { calculateTvUkNursingShift } from "./simple-tvuk-nursing-pay";
import { calculateTvalPflegeShift } from "./simple-tval-pflege-pay";
import { isPayWorkShift } from "./tvoed-pattern";
import { calculateTimedShiftBounds } from "./working-time";

export type AutomaticNetPayRecovery =
  | { readonly kind: "entry"; readonly date: string; readonly entryId: string }
  | { readonly kind: "profile"; readonly section: "WORK" | "TARIFF" }
  | { readonly kind: "net-settings" };

export interface AutomaticNetPayForecast {
  readonly result: SfnNetPayResult;
  readonly basicHourlyPayCents?: number;
  readonly regularGrossCents?: number;
  readonly sourceMonth: string;
  /** Includes no pension contributions or pension-related tax/SV adjustments. */
  readonly pensionOmitted?: boolean;
  readonly recovery?: AutomaticNetPayRecovery;
  readonly annualPayment?: AnnualPaymentForecast;
}
const unavailable = (reason: string): SfnNetPayResult => ({
  status: "unavailable",
  stage: "sfn",
  reason,
});
function cents(euros: number): number {
  const value = Math.round(euros * 100);
  if (!Number.isSafeInteger(value) || value < 0 || Math.abs(value - euros * 100) > 0.000001)
    throw new Error("Ungültiger Geldbetrag in der Gehaltsprognose.");
  return value;
}

/** Uses the same dated cash calculation as the salary screen; does not duplicate tariff tables. */
export interface AutomaticNetPayInput {
  readonly month: string;
  readonly profile: UserProfile;
  readonly settings: MonthlyNetPaySettings;
  readonly shifts: readonly ShiftEntry[];
  readonly pay: MonthlyPayEstimate;
}

export function calculateAutomaticNetPayForecast(
  input: AutomaticNetPayInput,
  resolver: RuleResolver,
): AutomaticNetPayForecast {
  const steps = calculateAutomaticNetPayForecastSteps(input, resolver);
  while (true) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

export function* calculateAutomaticNetPayForecastSteps(
  input: AutomaticNetPayInput,
  resolver: RuleResolver,
): Generator<number, AutomaticNetPayForecast, void> {
  const { month, settings, pay } = input;
  const profile = employmentProfileAt(input.profile, month + "-01");
  const sourceMonth = settings.month;
  const stop = (reason: string, recovery?: AutomaticNetPayRecovery): AutomaticNetPayForecast => ({
    sourceMonth,
    result: unavailable(reason),
    ...(recovery ? { recovery } : {}),
  });
  try {
    if (payrollEmploymentPeriods(input.profile, month, month + "-31").length > 1)
      return stop(
        "Für Beschäftigungsänderungen innerhalb eines Monats ist die Netto-Prognose noch nicht verfügbar.",
      );
    validateMonthlyNetPaySettings(settings);
    if (settings.version !== 2 || !settings.automation)
      return stop("Richte deine Netto-Angaben ein.", { kind: "net-settings" });
    if (settings.month > month || pay.month !== month)
      return stop("Die Berechnungsgrundlagen gehören zu unterschiedlichen Monaten.");
    if (profile.salaryBasisConflict)
      return stop("Prüfe deine Gehaltsangaben.", { kind: "profile", section: "TARIFF" });
    if (profile.timeZone !== "Europe/Berlin")
      return stop("Für diese Zeitzone ist keine Netto-Prognose verfügbar.");
    if (!Number.isSafeInteger(profile.weeklyMinutes) || profile.weeklyMinutes <= 0)
      return stop("Deine Wochenarbeitszeit fehlt.", { kind: "profile", section: "WORK" });
    const shifts = projectRegularPayShifts(input.shifts).filter(
      (s) => s.deletedAt === null && s.date.startsWith(`${month}-`),
    );
    const incompleteShift = shifts.find(
      (s) => ["EARLY", "LATE", "NIGHT", "DAY", "CUSTOM"].includes(s.type) && !isPayWorkShift(s),
    );
    if (incompleteShift)
      return stop("Prüfe die Zeiten dieses Dienstes.", {
        kind: "entry",
        date: incompleteShift.date,
        entryId: incompleteShift.id,
      });
    if (!pay.available || pay.personalBaseAmount === null || pay.estimatedGrossAmount === null)
      return stop("Die vollständige Brutto-Gehaltsprognose fehlt.");
    const components = [
      pay.specialDutyAmount ?? 0,
      pay.personalBaseAmount,
      pay.timePremiumAmount,
      pay.overtimeAmount,
      pay.allowanceAmount,
      pay.tvoedAllowanceAmount,
      pay.careAllowanceAmount,
    ];
    if (components.reduce((sum, part) => sum + cents(part), 0) !== cents(pay.estimatedGrossAmount))
      return stop("Die Bestandteile passen nicht zum Gesamtbrutto.");
    const automation = settings.automation;
    const allowanceStatus = pay.confirmedAllowance ?? pay.assessment.suggestedAllowance;
    const saturdayShiftWork =
      pay.assessment.shiftWork === "DETECTED" ||
      pay.assessment.alternatingShiftWork === "DETECTED" ||
      allowanceStatus !== "NONE";
    // Fixed monthly recurring components. Variable actual premiums cannot determine regular income.
    const regularGrossCents =
      cents(pay.personalBaseAmount) +
      cents(pay.careAllowanceAmount) +
      cents(pay.tvoedAllowanceAmount) +
      (allowanceStatus.endsWith("_MONTHLY") ? cents(pay.allowanceAmount) : 0) +
      automation.additionalRecurringGrossCents;
    const basicHourlyPayCents = Math.round(
      (regularGrossCents * 6000) / (435 * profile.weeklyMinutes),
    );
    const workShifts = shifts.filter(isPayWorkShift);
    const manual =
      profile.manualMonthlyGrossCents != null &&
      !profile.tariff &&
      !profile.nursingTrainingTariff &&
      !profile.vkaETariff &&
      !profile.tvlKrTariff &&
      !profile.tvhKrTariff &&
      !profile.tvUkNursingTariff &&
      !profile.tvalPflegeTariff;
    if (!manual && workShifts.length !== pay.shiftBreakdowns.length)
      return stop("Die Dienstzeiten passen nicht zur Gehaltsprognose.");
    const traces: SfnShift[] = [];
    yield 0;
    for (const shift of manual ? [] : workShifts) {
      const bounds = calculateTimedShiftBounds(shift, profile.timeZone);
      if (
        !bounds ||
        !Number.isSafeInteger(shift.breakMinutes) ||
        shift.breakMinutes < 0 ||
        shift.breakMinutes >= bounds.grossMinutes
      )
        return stop("Prüfe Arbeitszeit und Pause dieses Dienstes.", {
          kind: "entry",
          date: shift.date,
          entryId: shift.id,
        });
      let breakdown;
      let trace: SfnShift;
      if (profile.tvalPflegeTariff)
        breakdown = calculateTvalPflegeShift(
          shift,
          profile,
          profile.tvalPflegeTariff,
          saturdayShiftWork,
          resolver,
          true,
        );
      else if (profile.tvhKrTariff)
        breakdown = calculateTvhKrShift(
          shift,
          profile,
          profile.tvhKrTariff,
          { allowanceStatus, saturdayShiftWork },
          resolver,
          true,
        );
      else if (profile.tvUkNursingTariff)
        breakdown = calculateTvUkNursingShift(
          shift,
          profile,
          profile.tvUkNursingTariff,
          { regularShiftWork: pay.assessment.shiftWork === "DETECTED" },
          resolver,
          true,
        );
      else if (profile.tvlKrTariff)
        breakdown = calculateTvlKrShift(
          shift,
          profile,
          { payGroup: profile.tvlKrTariff.payGroup, payLevel: profile.tvlKrTariff.payLevel },
          profile.tvlKrTariff.universityRegion,
          saturdayShiftWork,
          resolver,
          true,
        );
      else if (profile.vkaETariff) breakdown = calculateVkaEShift(shift, profile, resolver, true);
      else if (profile.nursingTrainingTariff)
        breakdown = calculateNursingTrainingShift(shift, profile, resolver, true);
      else if (profile.tariff) {
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
            amountCents: cents(p.line.amount),
            additionalToBasicPay: true,
            periods: p.periods,
          })),
        };
      } else return stop("Für diese Gehaltsbasis fehlt eine vollständige Tarifberechnung.");
      const { payrollTrace, ...cashBreakdown } = breakdown;
      const recorded = pay.shiftBreakdowns.find((b) => b.shiftId === shift.id);
      if (!recorded || JSON.stringify(recorded) !== JSON.stringify(cashBreakdown))
        return stop("Die Zuschläge konnten nicht vollständig berechnet werden.");
      trace = payrollTrace ?? trace!;
      if (!trace) return stop("Die Zuschläge konnten nicht vollständig berechnet werden.");
      traces.push(trace);
      yield 1;
    }
    if (
      traces.reduce(
        (sum, t) => sum + t.payments.reduce((total, p) => total + p.amountCents, 0),
        0,
      ) !== cents(pay.timePremiumAmount)
    )
      return stop("Die Zuschlagssummen passen nicht zum Brutto.");
    yield 0;
    const classification = yield* classifySfnPayroll2026Steps(
      {
        month,
        completeGross: true,
        grossCents: cents(pay.estimatedGrossAmount) + automation.additionalRecurringGrossCents,
        regularMonthlySocialInsuranceGrossCents: regularGrossCents,
        basicHourlyPayCents,
        workplace: { federalState: profile.federalState, holidayRegion: profile.holidayRegion },
        workEvidence: "PLANNED",
        monthAttribution: "SHIFT_START",
        shifts: traces,
      },
      resolver,
      "FORECAST",
    );
    if (classification.status !== "available") return stop(classification.reason);
    yield 0;
    const pensionOmitted =
      ["UNKNOWN", "OTHER"].includes(automation.pensionScheme) ||
      (netPayPensionMaxOwnRate(automation.pensionScheme) !== null &&
        automation.pensionEmployeeRateBps == null);
    let pensionContributionBasisCents = classification.amounts.taxableGrossCents;
    // Darmstadt's Satzung §62(2)(s) excludes all SFN premiums, including taxable portions.
    if (["ZVK_DARMSTADT_I", "ZVK_DARMSTADT_II"].includes(automation.pensionScheme))
      for (const shift of classification.shifts)
        for (const premium of shift.premiumBreakdown)
          if (["NIGHT", "SUNDAY", "HOLIDAY"].includes(premium.category))
            pensionContributionBasisCents -= premium.taxablePremiumCents;
    const result = calculateMonthlyNetPay(
      {
        month,
        profile: { ...settings.profile, worksInSaxony: profile.federalState === "SN" },
        amounts: classification.amounts,
        specialCases: automation.annualPayments?.some((p) =>
          p.payoutMonth.startsWith(month.slice(0, 4)),
        )
          ? settings.specialCases.filter((value) => value !== "ONE_OFF_PAYMENT")
          : settings.specialCases,
        employmentKind:
          profile.nursingTrainingTariff || profile.tvalPflegeTariff ? "APPRENTICE" : "EMPLOYEE",
        pension: {
          scheme: pensionOmitted ? "NONE" : automation.pensionScheme,
          contributionBasisCents: pensionContributionBasisCents,
          regularContributionBasisCents: regularGrossCents,
          employeeRateBps: pensionOmitted
            ? undefined
            : (automation.pensionEmployeeRateBps ?? undefined),
        },
        additionalNetDeductionCents: automation.additionalNetDeductionCents,
      },
      "FORECAST",
    );
    yield 0;
    const annual =
      result.status === "available"
        ? addAnnualSalaryPayment(
            result,
            { ...settings.profile, worksInSaxony: profile.federalState === "SN" },
            automation.annualPayments ?? [],
          )
        : null;
    return {
      sourceMonth,
      basicHourlyPayCents,
      regularGrossCents,
      pensionOmitted,
      ...(result.status !== "available" ? { recovery: { kind: "net-settings" as const } } : {}),
      ...(annual?.annualPayment ? { annualPayment: annual.annualPayment } : {}),
      result:
        result.status === "available"
          ? { status: "available", classification, pay: annual!.pay }
          : { status: "unavailable", stage: "net-pay", reason: result.reason },
    };
  } catch {
    return stop(
      "Tarif-, Arbeitszeit- oder Feiertagsdaten konnten nicht vollständig zugeordnet werden.",
    );
  }
}
