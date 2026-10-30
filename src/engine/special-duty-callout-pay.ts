import { dutyInstant } from "@/domain/special-duty";
import { employmentProfileAt } from "@/domain/employment-history";
import type { DutyCalloutPay, DutyOvertimeRates } from "@/domain/special-duty-pay";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
import { dutyTariffFamily, onCallPaidMinutes, type DutyTariffFamily } from "./special-duty-tariff";
import { specialDutyOvertimeRates } from "./special-duty-overtime-rate";
import { specialDutyWorkMinutes } from "./special-duty";
import { getPublicHolidays } from "./holidays";
import { roundRemunerationCents } from "./remuneration-money";

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
  const nightStartHour = family === "TVUK" ? 20 : 21;
  for (const call of duty.callouts) {
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
    // Rounded remuneration never invents night/holiday work. Until F3 has the
    // precise tariff/SFN allocation, show known base pay but leave that total open.
    if (
      date !== end.toPlainDate().toString() ||
      start.dayOfWeek >= 6 ||
      start.hour < 6 ||
      end.hour > nightStartHour ||
      (end.hour === nightStartHour && end.minute > 0) ||
      date.endsWith("-12-24") ||
      date.endsWith("-12-31") ||
      getPublicHolidays(start.year, work.federalState, resolver, work.holidayRegion).some(
        (h) => h.date === date,
      )
    ) {
      notes.push(
        "Zusätzliche Nacht-, Wochenend- oder Feiertagszuschläge der Einsätze sind noch offen.",
      );
    }
  }
  const paidMinutes = onCallPaidMinutes(family, onsite, remote);
  return {
    actualMinutes,
    paidMinutes,
    rates,
    baseAmountCents: rates ? roundRemunerationCents(rates.baseHourlyCents * paidMinutes, 60) : 0,
    overtimePremiumCents: rates
      ? roundRemunerationCents(
          rates.premiumHourlyCents * paidMinutes * rates.premiumBasisPoints,
          600000,
        )
      : 0,
    notes: [...new Set(notes)],
  };
}
