import { dutyInstant } from "@/domain/special-duty";
import { employmentProfileAt } from "@/domain/employment-history";
import type { DutyCalloutPay, DutyOvertimeRates } from "@/domain/special-duty-pay";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
import { dutyTariffFamily, onCallPaidMinutes, type DutyTariffFamily } from "./special-duty-tariff";
import { specialDutyOvertimeRates } from "./special-duty-overtime-rate";
import { specialDutyWorkMinutes } from "./special-duty";
import { roundRemunerationCents } from "./remuneration-money";
import { tariffPayrollTrace } from "./tariff-payroll-trace";
import type { SfnShift } from "@/domain/net-pay-sfn";

/** One <=24h duty with an unchanged pay basis, already checked by the parent calculator. */
export function calculateDutyCalloutPay(
  shift: ShiftEntry,
  profile: UserProfile,
  family: DutyTariffFamily,
  resolver: RuleResolver,
): DutyCalloutPay {
  const duty = shift.specialDuty!;
  const notes: string[] = [];
  const actualMinutes = specialDutyWorkMinutes(shift);
  let rates: DutyOvertimeRates | null = null;
  const onsite: number[] = [],
    remote: number[] = [];
  const payrollTraces: SfnShift[] = [];
  let timePremiumCents = 0;
  let mandatoryRestMinutes = 0;
  for (const [index, call] of duty.callouts.entries()) {
    const start = dutyInstant(shift.date, call.departure, duty.timeZone);
    const end = dutyInstant(shift.date, call.returned, duty.timeZone);
    const date = start.toPlainDate().toString();
    const work = employmentProfileAt(profile, date);
    const endDate = end.subtract({ milliseconds: 1 }).toPlainDate().toString();
    const lastWork = employmentProfileAt(profile, endDate);
    const rate = specialDutyOvertimeRates(date, work, shift, resolver);
    const lastRate = specialDutyOvertimeRates(endDate, lastWork, shift, resolver);
    if (
      !rate ||
      !lastRate ||
      dutyTariffFamily(work) !== family ||
      dutyTariffFamily(lastWork) !== family ||
      JSON.stringify(rate) !== JSON.stringify(lastRate) ||
      (rates && JSON.stringify(rate) !== JSON.stringify(rates))
    ) {
      return {
        actualMinutes,
        paidMinutes: null,
        baseAmountCents: null,
        overtimePremiumCents: null,
        rates: null,
        notes: [
          "Die Entgeltgrundlage der Einsätze fehlt oder wechselt während der Rufbereitschaft.",
        ],
      };
    }
    rates = rate;
    if (call.breakMinutes) {
      return {
        actualMinutes,
        paidMinutes: null,
        baseAmountCents: null,
        overtimePremiumCents: null,
        rates,
        notes: ["Für Einsätze mit Pausen muss die Abrechnung noch geprüft werden."],
      };
    }
    const elapsed = Number(end.epochMilliseconds - start.epochMilliseconds) / 60000;
    (call.kind === "ON_SITE" ? onsite : remote).push(elapsed);
    try {
      // BAG 10 AZR 937/13: actual callout and necessary travel, no fictitious rounded time.
      const traced = tariffPayrollTrace(
        {
          ...shift,
          id: `duty-callout:${shift.id}:${index}`,
          date,
          type: "CUSTOM",
          startTime: start.toPlainTime().toString({ smallestUnit: "minute" }),
          endTime: end.toPlainTime().toString({ smallestUnit: "minute" }),
          breakMinutes: 0,
          specialDuty: null,
          overtimeMinutes: 0,
          tariffOvertimeConfirmed: false,
        },
        work,
        { allowanceStatus: "NONE", saturdayShiftWork: false, regularShiftWork: false },
        resolver,
      );
      if (traced.trace.payments.length)
        payrollTraces.push({ ...traced.trace, sourceShiftId: shift.id });
      timePremiumCents += traced.trace.payments.reduce((sum, p) => sum + p.amountCents, 0);
      mandatoryRestMinutes += traced.nightCompensatoryMinutes;
    } catch {
      notes.push("Die Zeitzuschläge dieses Einsatzes konnten nicht vollständig zugeordnet werden.");
    }
  }
  const paidMinutes = onCallPaidMinutes(family, onsite, remote);
  return {
    actualMinutes,
    paidMinutes,
    rates,
    baseAmountCents:
      rates && duty.settlement !== "TIME_OFF"
        ? roundRemunerationCents(rates.baseHourlyCents * paidMinutes, 60)
        : 0,
    overtimePremiumCents:
      rates && duty.settlement !== "TIME_OFF"
        ? roundRemunerationCents(
            rates.premiumHourlyCents * paidMinutes * rates.premiumBasisPoints,
            600000,
          )
        : 0,
    timePremiumCents: notes.length ? null : timePremiumCents,
    timeCreditMinutes: notes.length
      ? null
      : (duty.settlement === "TIME_OFF" && rates
          ? paidMinutes * (1 + rates.premiumBasisPoints / 10000)
          : 0) + mandatoryRestMinutes,
    mandatoryRestMinutes,
    payrollTraces,
    notes: [...new Set(notes)],
  };
}
