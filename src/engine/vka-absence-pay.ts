import { Temporal } from "@js-temporal/polyfill";
import {
  EMPTY_ABSENCE_PAY,
  hasTariffAbsenceInMonth,
  absencePayTariffAt,
  type AbsencePayFacts,
} from "@/domain/absence-pay";
import { addSalaryPaymentMonths } from "@/domain/salary-payment";
import type { CalendarEntry, MonthlyPayEstimate, ShiftEntry, UserProfile } from "@/domain/types";
import type { WorkingTimeTargetProfile } from "@/domain/working-time-target";
import type { RuleResolver } from "@/rules/rule-resolver";
import { formatMonthTitle } from "./calendar";
import { employmentProfileAt } from "@/domain/employment-history";
import { getPublicHolidays } from "./holidays";

type Tariff = NonNullable<ReturnType<typeof absencePayTariffAt>>;
type ReferenceSlice = {
  from: string;
  before: string;
  tvUkRateDate?: string;
  includeEarlierAbsences?: boolean;
};
export type AbsenceReferencePay = (
  month: string,
  slice?: ReferenceSlice,
) => MonthlyPayEstimate | null;

// Protokollerklärung Nr. 4 zu § 21 TV-L/TV-H, dated agreements from TdL and Land Hessen.
const adjustments = {
  TVL: [
    ["2024-11-01", 428],
    ["2025-02-01", 495],
    ["2026-04-01", 254],
    ["2027-03-01", 180],
    ["2028-01-01", 90],
  ],
  TVH: [
    ["2025-02-01", 432],
    ["2025-08-01", 495],
    ["2026-07-01", 273],
    ["2027-10-01", 252],
  ],
} as const;
const vkaChanges = ["2025-04-01", "2026-05-01"];

function referenceMoney(pay: MonthlyPayEstimate, tariff: Tariff): number | null {
  if (!pay.available) return null;
  // The TV-UK excludes additional overtime pay. For the other families a rostered
  // overtime payment counts, but a confirmed overtime balance alone does not prove scheduling.
  if (
    tariff !== "TVUK" &&
    (pay.overtimeAmount || pay.shiftBreakdowns.some((b) => b.overtimePremiumAmount !== 0))
  )
    return null;
  if (
    tariff === "VKA" &&
    pay.specialDutyBreakdowns?.some(
      (line) => line.calloutPay?.baseAmountCents || line.calloutPay?.overtimePremiumCents,
    )
  )
    return null;
  const monthly = (pay.confirmedAllowance ?? pay.assessment.suggestedAllowance).endsWith(
    "_MONTHLY",
  );
  const priorDays = tariff === "VKA" || tariff === "TVH" ? (pay.absencePayAmount ?? 0) : 0;
  return (
    Math.round(100 * pay.timePremiumAmount) +
    Math.round(100 * (monthly ? 0 : pay.allowanceAmount)) +
    Math.round(100 * (pay.specialDutyAmount ?? 0)) +
    Math.round(100 * priorDays)
  );
}

function adjusted(cents: number, claim: string, event: string, tariff: Tariff) {
  if (tariff !== "TVL" && tariff !== "TVH") return cents;
  for (const [effective, basisPoints] of adjustments[tariff]) {
    if (claim < effective.slice(0, 7) && event >= effective)
      cents = Math.round((cents * (10000 + basisPoints)) / 10000);
  }
  return cents;
}

export function withTariffAbsencePay(
  month: string,
  pay: MonthlyPayEstimate,
  profile: UserProfile,
  entries: readonly CalendarEntry[],
  resolver: RuleResolver,
  previousPay: AbsenceReferencePay,
): MonthlyPayEstimate {
  if (!hasTariffAbsenceInMonth(month, entries, profile)) return pay;
  const target = (profile as WorkingTimeTargetProfile).workingTimeTarget;
  const context = target?.context;
  const period = (date: string) =>
    context?.periods.find((p) => p.validFrom <= date && (!p.validTo || date <= p.validTo));
  const byDate = new Map<string, ShiftEntry[]>();
  for (const entry of entries) {
    if (
      entry.kind !== "SHIFT" ||
      (entry.type !== "VACATION" && entry.type !== "SICK") ||
      entry.deletedAt !== null
    )
      continue;
    const group = byDate.get(entry.date) ?? [];
    group.push(entry);
    byDate.set(entry.date, group);
  }
  const paidHistory = new Map<string, boolean | null>();
  const isDay = (s: ShiftEntry) => {
    const fact = context?.days.find((d) => d.date === s.date && d.rosterStatus === "FINAL");
    if (fact?.disposition === "WORK_REQUIRED") return true;
    if (fact?.disposition === "ROSTER_FREE") return false;
    if (fact?.disposition === "RELEASED" && fact.lostMinutes != null) return fact.lostMinutes > 0;
    const model = period(s.date)?.model;
    if (s.absencePay?.plannedShift) return true;
    const date = Temporal.PlainDate.from(s.date);
    if (
      model?.kind === "FIXED_WEEK" ? !model.weekdayMinutes[date.dayOfWeek - 1] : date.dayOfWeek > 5
    )
      return false;
    const dated = employmentProfileAt(profile, s.date);
    try {
      return !getPublicHolidays(date.year, dated.federalState, resolver, dated.holidayRegion).some(
        (h) => h.date === s.date,
      );
    } catch {
      return null;
    }
  };
  function automatic(
    start: string,
    day: string,
    f: AbsencePayFacts,
    tariff: Tariff,
  ): number | string {
    if (f.referenceCents != null && f.referenceDays != null)
      return Math.round(f.referenceCents / f.referenceDays);
    let bound = context?.employment?.from ?? "";
    const periods = (context?.periods ?? [])
      .filter((p) => p.validFrom <= start)
      .slice()
      .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    for (let i = 1; i < periods.length; i++)
      if (periods[i].weeklyMinutes !== periods[i - 1].weeklyMinutes && periods[i].validFrom > bound)
        bound = periods[i].validFrom;
    for (const row of profile.employmentTimeline ?? []) {
      const from = row.effectiveFrom;
      if (!from || from <= bound || from > start || !row.employment) continue;
      const before = Temporal.PlainDate.from(from).subtract({ days: 1 }).toString();
      if (
        employmentProfileAt(profile, before).weeklyMinutes !==
          employmentProfileAt(profile, from).weeklyMinutes ||
        absencePayTariffAt(profile, before) !== absencePayTariffAt(profile, from)
      )
        bound = from;
    }
    const months = [-3, -2, -1]
      .map((delta) => addSalaryPaymentMonths(start.slice(0, 7), delta))
      .filter((m) => m + "-01" >= bound);
    if (!months.length) {
      const worked = new Set(
        entries
          .filter(
            (e) =>
              e.kind === "SHIFT" &&
              !e.deletedAt &&
              !e.allDay &&
              ["EARLY", "LATE", "NIGHT", "DAY", "CUSTOM"].includes(e.type) &&
              e.date >= bound &&
              e.date < start,
          )
          .map((e) => e.date),
      );
      const days =
        f.referenceDays ??
        (f.historyComplete || tariff === "TVL" || tariff === "TVH" ? worked.size : 0);
      if (f.referenceCents != null && days > 0) return Math.round(f.referenceCents / days);
      if (days > 0 && (tariff === "TVL" || tariff === "TVH")) {
        let sum = 0;
        for (const claim of new Set([...worked].map((date) => date.slice(0, 7)))) {
          const includeEarlierAbsences =
            tariff === "TVH" &&
            [...paidHistory].some(
              ([d, paid]) => paid !== false && d >= bound && d < start && d.startsWith(claim),
            );
          const source = previousPay(claim, { from: bound, before: start, includeEarlierAbsences });
          const amount = source && referenceMoney(source, tariff);
          if (amount == null)
            return "Für den Zeitraum seit Eintritt oder Arbeitszeitwechsel fehlen anrechenbare Bezüge.";
          sum += adjusted(amount, claim, start, tariff);
        }
        return Math.round(sum / days);
      }
      return "Seit Beginn oder Änderung der Arbeitszeit liegt noch kein voller Referenzmonat vor.";
    }
    if (f.referenceCents == null && !f.historyComplete) {
      const missing = months.filter(
        (m) =>
          !entries.some(
            (entry) =>
              entry.kind === "SHIFT" &&
              !entry.deletedAt &&
              entry.date.startsWith(m) &&
              !entry.allDay &&
              entry.startTime &&
              entry.endTime,
          ),
      );
      if (missing.length)
        return (
          "Für die Schätzung fehlen erfasste Dienste für " +
          missing.map(formatMonthTitle).join(", ") +
          "."
        );
    }
    const first = months[0] + "-01";
    if (
      f.referenceCents == null &&
      tariff === "VKA" &&
      vkaChanges.some((change) => first < change && change <= day)
    )
      return "Der Vergleichszeitraum enthält eine Tariferhöhung. Die angepassten Bezüge liegen noch nicht vor.";
    const model = period(first)?.model;
    const week =
      f.workdaysPerWeek ??
      (model?.kind === "FIXED_WEEK"
        ? model.weekdayMinutes.filter((minutes) => minutes > 0).length
        : 5);
    if (!week && !f.referenceDays) return "Regelmäßige Arbeitstage pro Woche fehlen.";
    const excused = [...byDate].filter(
      ([d, group]) =>
        months.includes(d.slice(0, 7)) && group.some((s) => s.absencePay?.day === "EXCUSED_UNPAID"),
    ).length;
    const previousDays =
      tariff === "TVL"
        ? [...paidHistory].filter(([date]) => months.includes(date.slice(0, 7)))
        : [];
    if (f.referenceDays == null && previousDays.some(([, paid]) => paid === null))
      return "Für einen früheren Ausfalltag ist der Anspruch noch offen.";
    const excluded = tariff === "VKA" ? excused : previousDays.filter(([, paid]) => paid).length;
    const fullDays = 13 * week;
    const shortDivisor = (fullDays * months.length) / 3;
    // NRW guidance on § 21 TV-L, Ersatzberechnungszeitraum: 21.67 or 43.33 at five days per week.
    const divisor =
      months.length === 3
        ? fullDays
        : tariff === "VKA"
          ? Math.round(shortDivisor)
          : Math.round(shortDivisor * 100) / 100;
    const days = f.referenceDays ?? divisor - excluded;
    if (days <= 0) return "Maßgebliche Arbeitstage im Vergleichszeitraum fehlen.";
    if (f.referenceCents != null) return Math.round(f.referenceCents / days);
    let sum = 0;
    for (const claim of months) {
      const src =
        tariff === "TVL" || tariff === "TVUK"
          ? previousPay(claim, {
              from: claim + "-01",
              before: start,
              ...(tariff === "TVUK" ? { tvUkRateDate: start } : {}),
            })
          : previousPay(claim);
      const amount = src && referenceMoney(src, tariff);
      if (amount == null && src?.absencePayNotes?.length)
        return (
          "Im Referenzmonat " + formatMonthTitle(claim) + " ist ein früherer U/K-Aufschlag offen."
        );
      if (amount == null && src?.overtimeAmount)
        return (
          "Für " +
          formatMonthTitle(claim) +
          " ist offen, welche Mehrarbeit laut Dienstplan vorgesehen war."
        );
      if (amount == null)
        return `Die anrechenbaren Bezüge für ${formatMonthTitle(claim)} sind noch unvollständig.`;
      sum += adjusted(amount, claim, start, tariff);
    }
    return Math.round(sum / days);
  }
  const days: NonNullable<MonthlyPayEstimate["absencePayDays"]>[number][] = [];
  const notes: string[] = [];
  let monthlyPayUncertain = false;
  const automaticRates = new Map<string, number | string>();
  const rates = new Map<string, number>(),
    history = new Map<string, AbsencePayFacts>();
  let prior: { date: string; type: string; start: string; tariff: Tariff } | undefined;
  for (const date of [...byDate.keys()].sort()) {
    if (date.slice(0, 7) > month) break;
    const group = byDate.get(date)!;
    const active = group.filter(
      (s) => !["FREE", "UNPAID", "EXCUSED_UNPAID"].includes(s.absencePay?.day ?? "AUTO"),
    );
    const shift = active[0] ?? group[0],
      f = shift.absencePay ?? EMPTY_ABSENCE_PAY;
    const tariff = absencePayTariffAt(profile, date);
    if (!tariff) {
      prior = undefined;
      continue;
    }
    const start: string =
      f.eventStart ??
      (prior?.type === shift.type &&
      prior.tariff === tariff &&
      Temporal.PlainDate.from(prior.date).add({ days: 1 }).toString() === date
        ? prior.start
        : date);
    prior = { date, type: shift.type, start, tariff };
    const key = [
      start,
      shift.type,
      tariff,
      ...(tariff === "VKA" ? vkaChanges.filter((change) => change <= date) : []),
    ].join("/");
    if (f.dailyRateCents != null) rates.set(key, f.dailyRateCents);
    if (
      f.historyComplete ||
      f.workdaysPerWeek != null ||
      f.referenceCents != null ||
      f.referenceDays != null
    )
      history.set(key, f);
    if (
      !active.length ||
      (context?.employment &&
        (date < context.employment.from || (context.employment.to && date > context.employment.to)))
    )
      continue;
    let reason: string | undefined;
    if (target && target.status !== "ready" && f.day === "AUTO" && !f.plannedShift)
      reason =
        target.status === "loading"
          ? "Der Dienstplan wird geladen."
          : "Der Dienstplan konnte nicht geladen werden.";
    if (active.length > 1) reason = "Mehrere Abwesenheiten. Bezahlten Ausfall eindeutig zuordnen.";
    const paid = f.day === "PAID" || isDay(shift);
    if (!reason && paid === false) continue;
    if (!reason && paid == null) reason = "Der Feiertagskalender für diesen Tag fehlt.";
    if (
      !reason &&
      shift.type === "SICK" &&
      (f.day !== "PAID" || !!f.plannedShift) &&
      Temporal.PlainDate.from(start).until(date).days >= 42
    ) {
      reason = "Nach sechs Wochen Krankheit ist der Anspruch auf Entgeltfortzahlung zu klären.";
      if (date.startsWith(month)) monthlyPayUncertain = true;
    }
    paidHistory.set(date, reason ? null : true);
    if (!date.startsWith(month)) continue;
    // §§ 9/12 TVAöD and §§ 9/13 TVA-L Pflege reference the monthly training pay.
    if (tariff === "TVAOED" || tariff === "TVAL") {
      if (reason) notes.push(date + " · " + reason);
      continue;
    }
    let amount: number | string | undefined = reason ?? rates.get(key);
    if (amount == null) {
      const facts = history.get(key) ?? f;
      const rateKey = JSON.stringify([
        key,
        facts.workdaysPerWeek,
        facts.historyComplete,
        facts.referenceCents,
        facts.referenceDays,
      ]);
      amount = automaticRates.get(rateKey) ?? automatic(start, date, facts, tariff);
      automaticRates.set(rateKey, amount);
    }
    if (typeof amount === "string") notes.push(date + " · " + amount);
    else
      days.push({
        date,
        eventStart: start,
        type: shift.type,
        dailyRateCents: amount,
        manual: rates.has(key),
      });
  }
  if (!days.length && !notes.length) return pay;
  const cents = days.reduce((sum, d) => sum + d.dailyRateCents, 0);
  const plus = (v: number) => (Math.round(v * 100) + cents) / 100;
  const gross = pay.estimatedGrossAmount == null ? null : plus(pay.estimatedGrossAmount);
  return {
    ...pay,
    absencePayAmount: cents / 100,
    absencePayDays: days,
    absencePayNotes: notes,
    available: pay.available && !notes.length,
    estimatedGrossAmount: notes.length ? null : gross,
    ...(monthlyPayUncertain
      ? { personalBaseAmount: null, knownGrossAmount: undefined }
      : pay.knownGrossAmount != null
        ? { knownGrossAmount: plus(pay.knownGrossAmount) }
        : notes.length && gross != null
          ? { knownGrossAmount: gross }
          : {}),
  };
}
