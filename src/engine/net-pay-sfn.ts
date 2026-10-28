import { Temporal } from "@js-temporal/polyfill";

import { isHolidayRegionCompatible } from "@/domain/employment-profile";
import type { NetPayCalculationMode } from "@/domain/net-pay";
import type {
  SfnClassificationResult,
  SfnPayrollInput,
  SfnPremiumCategory,
  SfnShiftClassification,
  SfnTimeRange,
} from "@/domain/net-pay-sfn";
import { FEDERAL_STATES, HOLIDAY_REGIONS } from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";

import { resolveHolidayMapForMonths } from "./holidays";
import { resolveNetPayCalculationBasis } from "./net-pay-calculation-basis";

type Fraction = readonly [bigint, bigint];
const ZERO: Fraction = [0n, 1n];
const MINUTE_NS = 60_000_000_000n;

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function fraction(n: bigint, d: bigint): Fraction {
  const divisor = gcd(n, d);
  return [n / divisor, d / divisor];
}

function add(a: Fraction, b: Fraction): Fraction {
  return fraction(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
}

function minimum(a: Fraction, b: Fraction): Fraction {
  return a[0] * b[1] <= b[0] * a[1] ? a : b;
}

type FailureStatus = "missing-data" | "invalid-input" | "unsupported";
class SfnInputError extends Error {
  constructor(
    readonly status: FailureStatus,
    reason: string,
  ) {
    super(reason);
  }
}

function fail(status: FailureStatus, reason: string): never {
  throw new SfnInputError(status, reason);
}

function cents(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000;
}

function timestamp(value: string): Temporal.ZonedDateTime {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::00)?[+-]\d{2}:\d{2}$/.test(value)
  ) {
    return fail(
      "invalid-input",
      "Zeitangaben benötigen minutengenaue Berliner Ortszeit mit UTC-Offset.",
    );
  }
  try {
    return Temporal.ZonedDateTime.from(`${value}[Europe/Berlin]`, {
      offset: "reject",
      overflow: "reject",
      disambiguation: "reject",
    });
  } catch {
    return fail("invalid-input", "Ungültige Ortszeit oder unpassender UTC-Offset.");
  }
}

function range(value: SfnTimeRange): readonly [Temporal.ZonedDateTime, Temporal.ZonedDateTime] {
  if (!value) return fail("invalid-input", "Zeitintervall fehlt.");
  const start = timestamp(value.start);
  const end = timestamp(value.end);
  if (end.epochNanoseconds <= start.epochNanoseconds)
    return fail("invalid-input", "Zeitintervalle müssen positiv sein.");
  return [start, end];
}

function minuteIndex(point: Temporal.ZonedDateTime, start: Temporal.ZonedDateTime): number {
  return Number((point.epochNanoseconds - start.epochNanoseconds) / MINUTE_NS);
}

function indices(
  value: SfnTimeRange,
  start: Temporal.ZonedDateTime,
  end: Temporal.ZonedDateTime,
): readonly [number, number] {
  const [from, until] = range(value);
  if (
    from.epochNanoseconds < start.epochNanoseconds ||
    until.epochNanoseconds > end.epochNanoseconds
  )
    return fail("invalid-input", "Intervall liegt außerhalb der Schicht.");
  return [minuteIndex(from, start), minuteIndex(until, start)];
}

function dayRate(
  date: Temporal.PlainDate,
  minuteOfDay: number,
  holidays: ReadonlySet<string>,
): number {
  const special150 =
    (date.month === 12 &&
      (date.day === 25 || date.day === 26 || (date.day === 24 && minuteOfDay >= 840))) ||
    (date.month === 5 && date.day === 1);
  if (special150) return 15_000;
  if (holidays.has(date.toString()) || (date.month === 12 && date.day === 31 && minuteOfDay >= 840))
    return 12_500;
  return date.dayOfWeek === 7 ? 5_000 : 0;
}

function minuteCap(hourlyCents: number, rateBps: number): Fraction {
  return fraction(BigInt(hourlyCents) * BigInt(rateBps), 600_000n);
}

interface ClockDay {
  readonly date: Temporal.PlainDate;
  readonly key: string;
  readonly prior: Temporal.PlainDate;
  readonly priorKey: string;
}

/** Arithmetic on ordinary days; retain absolute-minute traversal at an offset transition. */
function* localClocksSteps(
  start: Temporal.ZonedDateTime,
  minutes: number,
): Generator<number, { day: ClockDay; minute: number }[], void> {
  const days = new Map<string, ClockDay>();
  const day = (date: Temporal.PlainDate) => {
    const key = date.toString();
    const existing = days.get(key);
    if (existing) return existing;
    const prior = date.subtract({ days: 1 });
    const result = { date, key, prior, priorKey: prior.toString() };
    days.set(key, result);
    return result;
  };
  if (start.offsetNanoseconds !== start.add({ minutes: minutes - 1 }).offsetNanoseconds) {
    const result: { day: ClockDay; minute: number }[] = [];
    for (let i = 0; i < minutes; i++) {
      const time = start.add({ minutes: i });
      result.push({ day: day(time.toPlainDate()), minute: time.hour * 60 + time.minute });
      if (i % 32 === 31) yield 1;
    }
    return result;
  }
  const first = start.toPlainDate();
  const firstMinute = start.hour * 60 + start.minute;
  let offset = -1;
  let current: ClockDay;
  return Array.from({ length: minutes }, (_, i) => {
    const localMinute = firstMinute + i;
    const nextOffset = Math.floor(localMinute / 1_440);
    if (offset !== nextOffset) {
      offset = nextOffset;
      current = day(offset === 0 ? first : first.add({ days: offset }));
    }
    return { day: current!, minute: localMinute % 1_440 };
  });
}

/** No tariff guessing: caller supplies complete cash payroll and explicit payment/time attribution. */
export function classifySfnPayroll2026(
  input: SfnPayrollInput,
  ruleResolver: RuleResolver,
  mode: NetPayCalculationMode = "VERIFIED",
): SfnClassificationResult {
  const steps = classifySfnPayroll2026Steps(input, ruleResolver, mode);
  while (true) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

export function* classifySfnPayroll2026Steps(
  input: SfnPayrollInput,
  ruleResolver: RuleResolver,
  mode: NetPayCalculationMode = "VERIFIED",
): Generator<number, SfnClassificationResult, void> {
  try {
    return yield* classifySteps(input, ruleResolver, mode);
  } catch (error) {
    if (!(error instanceof SfnInputError)) throw error;
    return Object.freeze({ status: error.status, reason: error.message });
  }
}

function* classifySteps(
  input: SfnPayrollInput,
  ruleResolver: RuleResolver,
  mode: NetPayCalculationMode,
): Generator<number, SfnClassificationResult, void> {
  if (!/^\d{4}-\d{2}$/.test(input.month))
    return fail("invalid-input", "Ungültiger Abrechnungsmonat.");
  let first: Temporal.PlainDate;
  try {
    first = Temporal.PlainDate.from(`${input.month}-01`, { overflow: "reject" });
  } catch {
    return fail("invalid-input", "Ungültiger Abrechnungsmonat.");
  }
  const calculationBasis = resolveNetPayCalculationBasis(input.month, mode);
  if (!calculationBasis || calculationBasis.rulesYear !== 2026)
    return fail("unsupported", "Für dieses Jahr fehlen geprüfte SFN-Berechnungsgrundlagen.");
  if (mode === "FORECAST" && input.workEvidence !== "PLANNED")
    return fail("unsupported", "Vorläufige SFN-Prognosen benötigen geplante Dienste.");
  if (input.completeGross !== true)
    return fail("missing-data", "Das Gesamtbrutto ist nicht vollständig bestätigt.");
  if (
    !cents(input.grossCents) ||
    input.grossCents === 0 ||
    !cents(input.regularMonthlySocialInsuranceGrossCents) ||
    input.regularMonthlySocialInsuranceGrossCents > input.grossCents
  )
    return fail("invalid-input", "Ungültige Bruttobeträge.");
  if (input.basicHourlyPayCents == null)
    return fail("missing-data", "Der steuerliche SFN-Grundlohn fehlt.");
  if (!cents(input.basicHourlyPayCents) || input.basicHourlyPayCents === 0)
    return fail("invalid-input", "Ungültiger SFN-Grundlohn.");
  if (!input.workplace || input.workplace.holidayRegion === "UNKNOWN")
    return fail("missing-data", "Der genaue Arbeitsort für Feiertage fehlt.");
  const { federalState, holidayRegion } = input.workplace;
  if (
    !FEDERAL_STATES.includes(federalState) ||
    !HOLIDAY_REGIONS.includes(holidayRegion) ||
    !isHolidayRegionCompatible(federalState, holidayRegion)
  )
    return fail("invalid-input", "Ungültiger Arbeitsort.");
  if (input.workEvidence !== "PLANNED" && input.workEvidence !== "RECORDED")
    return fail(
      "missing-data",
      "Arbeitszeiten müssen als geplant oder aufgezeichnet gekennzeichnet sein.",
    );
  if (
    input.monthAttribution !== undefined &&
    !["WORK_MINUTES", "SHIFT_START"].includes(input.monthAttribution)
  )
    return fail("invalid-input", "Ungültige Monatszuordnung.");
  const shiftStartAttribution = input.monthAttribution === "SHIFT_START";
  if (shiftStartAttribution && input.workEvidence !== "PLANNED")
    return fail(
      "invalid-input",
      "Die Zuordnung nach Dienstbeginn gilt nur für Dienstplan-Prognosen.",
    );
  if (!Array.isArray(input.shifts) || input.shifts.length > 100)
    return fail("invalid-input", "Ungültige Schichtliste.");

  const ids = new Set<string>();
  const paymentIds = new Set<string>();
  const occupied: (readonly [bigint, bigint])[] = [];
  const results: SfnShiftClassification[] = [];
  for (const shift of input.shifts) {
    if (!shift || typeof shift.id !== "string" || shift.id.length === 0 || ids.has(shift.id))
      return fail("invalid-input", "Schicht-IDs müssen eindeutig sein.");
    ids.add(shift.id);
    const [start, end] = range(shift);
    const minutes = minuteIndex(end, start);
    if (minutes > 1_560)
      return fail("unsupported", "Schichten über 26 Stunden sind nicht unterstützt.");
    if (shiftStartAttribution) {
      if (start.toPlainDate().toString().slice(0, 7) !== input.month)
        return fail("unsupported", "Der Dienstbeginn gehört zu einem anderen Prognosemonat.");
    } else if (
      Temporal.PlainDate.compare(start.toPlainDate(), first.subtract({ days: 1 })) < 0 ||
      Temporal.PlainDate.compare(end.toPlainDate(), first.add({ months: 1 })) > 0
    )
      return fail("unsupported", "Arbeitszeiten außerhalb dieses Monats sind nicht unterstützt.");
    if (shift.unpaidBreaks === null || shift.unpaidBreaks === undefined)
      return fail("missing-data", "Die Lage unbezahlter Pausen fehlt.");
    if (
      !Array.isArray(shift.unpaidBreaks) ||
      shift.unpaidBreaks.length > 100 ||
      (shift.paidBreaks !== undefined &&
        (!Array.isArray(shift.paidBreaks) || shift.paidBreaks.length > 100)) ||
      !Array.isArray(shift.payments) ||
      shift.payments.length > 100
    )
      return fail("invalid-input", "Ungültige Pausen- oder Zahlungsliste.");
    const working = Array<boolean>(minutes).fill(true);
    for (const pause of [...shift.unpaidBreaks, ...(shift.paidBreaks ?? [])]) {
      const [from, until] = indices(pause, start, end);
      for (let i = from; i < until; i++) {
        if (!working[i]) return fail("invalid-input", "Unbezahlte Pausen überschneiden sich.");
        working[i] = false;
      }
    }
    if (
      occupied.some(
        ([from, until]) => start.epochNanoseconds < until && end.epochNanoseconds > from,
      )
    )
      return fail("invalid-input", "Schichten überschneiden sich.");
    occupied.push([start.epochNanoseconds, end.epochNanoseconds]);
    const times = yield* localClocksSteps(start, minutes);
    const months = new Set(times.map((time) => time.day.key.slice(0, 7)));
    const holidayResolution = resolveHolidayMapForMonths(
      [...months],
      federalState,
      ruleResolver,
      holidayRegion,
    );
    if (holidayResolution.status !== "AVAILABLE")
      return fail("missing-data", "Feiertagsregeln für die benötigten Arbeitstage fehlen.");
    const holidays = new Set(holidayResolution.holidays.keys());
    const previousNights = new Set<string>();
    for (let i = 0; i < minutes; i++)
      if (working[i] && times[i].minute >= 1_200) previousNights.add(times[i].day.key);
    const nightPayments: Fraction[] = Array<Fraction>(minutes).fill(ZERO);
    const dayPayments: Fraction[] = Array<Fraction>(minutes).fill(ZERO);
    const categories = new Map<
      SfnPremiumCategory,
      { paid: number; free: Fraction; night: Fraction[]; day: Fraction[] }
    >();
    let paidPremiumCents = 0;
    for (const payment of shift.payments) {
      if (
        !payment ||
        typeof payment.id !== "string" ||
        payment.id.length === 0 ||
        paymentIds.has(payment.id)
      )
        return fail("invalid-input", "Zahlungs-IDs müssen eindeutig sein.");
      paymentIds.add(payment.id);
      if (
        !["NIGHT", "DAY", "OTHER"].includes(payment.kind) ||
        !cents(payment.amountCents) ||
        typeof payment.additionalToBasicPay !== "boolean" ||
        !Array.isArray(payment.periods) ||
        payment.periods.length === 0 ||
        payment.periods.length > 100
      )
        return fail("invalid-input", "Ungültige Zuschlagszahlung.");
      const paid = new Set<number>();
      const covered = new Set<number>();
      for (const period of payment.periods) {
        const [from, until] = indices(period, start, end);
        for (let i = from; i < until; i++) {
          if (covered.has(i))
            return fail("invalid-input", "Intervalle einer Zuschlagszahlung überschneiden sich.");
          covered.add(i);
          if (!working[i]) continue;
          if (!shiftStartAttribution && times[i].day.key.slice(0, 7) !== input.month)
            return fail(
              "unsupported",
              "Bezahlte Zuschlagszeiten müssen im Abrechnungsmonat liegen.",
            );
          paid.add(i);
        }
      }
      if (paid.size === 0)
        return fail("invalid-input", "Eine Zuschlagszahlung benötigt bezahlte Arbeitsminuten.");
      paidPremiumCents += payment.amountCents;
      const category = payment.category ?? (payment.kind === "NIGHT" ? "NIGHT" : "OTHER");
      if (!["NIGHT", "SUNDAY", "HOLIDAY", "SATURDAY", "OTHER"].includes(category))
        return fail("invalid-input", "Ungültige Zuschlagsart.");
      let categoryBucket = categories.get(category);
      if (!categoryBucket) {
        categoryBucket = {
          paid: 0,
          free: ZERO,
          night: Array<Fraction>(minutes).fill(ZERO),
          day: Array<Fraction>(minutes).fill(ZERO),
        };
        categories.set(category, categoryBucket);
      }
      categoryBucket.paid += payment.amountCents;
      if (payment.kind === "OTHER" || !payment.additionalToBasicPay) continue;
      const value = fraction(BigInt(payment.amountCents), BigInt(paid.size));
      const bucket = payment.kind === "NIGHT" ? nightPayments : dayPayments;
      const categoryMinutes = payment.kind === "NIGHT" ? categoryBucket.night : categoryBucket.day;
      for (const i of paid) {
        bucket[i] = add(bucket[i], value);
        categoryMinutes[i] = add(categoryMinutes[i], value);
      }
    }
    let taxFree = ZERO;
    let socialFree = ZERO;
    let workedMinutes = 0;
    let nightMinutes = 0;
    let dayMinutes = 0;
    const dayRates = new Map<ClockDay, readonly [number, number, number]>();
    const paidRates = new Map<
      string,
      {
        payment: Fraction;
        rate: number;
        minutes: number;
        shares: readonly (readonly [SfnPremiumCategory, Fraction])[];
      }
    >();
    for (let i = 0; i < minutes; i++) {
      if (!working[i]) continue;
      workedMinutes++;
      const time = times[i];
      const { day, minute: localMinute } = time;
      let rates = dayRates.get(day);
      if (!rates) {
        rates = [
          dayRate(day.date, 0, holidays),
          dayRate(day.date, 840, holidays),
          dayRate(day.prior, 1_439, holidays),
        ];
        dayRates.set(day, rates);
      }
      const continuedNight = localMinute < 240 && previousNights.has(day.priorKey);
      const nightBps =
        localMinute >= 1_200 || localMinute < 360 ? (continuedNight ? 4_000 : 2_500) : 0;
      const dayBps = Math.max(rates[localMinute < 840 ? 0 : 1], continuedNight ? rates[2] : 0);
      if (nightBps > 0) nightMinutes++;
      if (dayBps > 0) dayMinutes++;
      for (const [payment, rate, kind] of [
        [nightPayments[i], nightBps, "night"],
        [dayPayments[i], dayBps, "day"],
      ] as const) {
        if (!rate || payment[0] === 0n) continue;
        const shares = [...categories]
          .map(([category, bucket]) => [category, bucket[kind][i]] as const)
          .filter(([, value]) => value[0] > 0n);
        const key = `${payment[0]}/${payment[1]}:${rate}:${shares.map(([category, value]) => `${category}:${value[0]}/${value[1]}`).join(",")}`;
        const bucket = paidRates.get(key);
        if (bucket) bucket.minutes++;
        else paidRates.set(key, { payment, rate, minutes: 1, shares });
      }
    }
    // Sum identical exact fractions once; keep the existing floor-to-cents per shift.
    for (const { payment, rate, minutes: count, shares } of paidRates.values()) {
      const tax = minimum(payment, minuteCap(Math.min(input.basicHourlyPayCents, 5_000), rate));
      const social = minimum(payment, minuteCap(Math.min(input.basicHourlyPayCents, 2_500), rate));
      taxFree = add(taxFree, fraction(tax[0] * BigInt(count), tax[1]));
      socialFree = add(socialFree, fraction(social[0] * BigInt(count), social[1]));
      // Attribute the shared cap using the exact paid fraction at the same minutes.
      // Category names do not grant exemptions or change the original shift total.
      for (const [category, share] of shares) {
        const bucket = categories.get(category)!;
        bucket.free = add(
          bucket.free,
          fraction(tax[0] * share[0] * payment[1] * BigInt(count), tax[1] * share[1] * payment[0]),
        );
      }
    }
    const taxFreeCents = Number(taxFree[0] / taxFree[1]);
    const socialInsuranceFreeCents = Number(socialFree[0] / socialFree[1]);
    const categoryRows = [...categories]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, bucket]) => ({
        category,
        paidPremiumCents: bucket.paid,
        taxFreeCents: Number(bucket.free[0] / bucket.free[1]),
        remainder: fraction(bucket.free[0] % bucket.free[1], bucket.free[1]),
      }));
    let remainderCents =
      taxFreeCents - categoryRows.reduce((sum, row) => sum + row.taxFreeCents, 0);
    const roundingOrder = [...categoryRows].sort((a, b) => {
      const difference = a.remainder[0] * b.remainder[1] - b.remainder[0] * a.remainder[1];
      return difference > 0n ? -1 : difference < 0n ? 1 : a.category.localeCompare(b.category);
    });
    for (const row of roundingOrder) {
      if (remainderCents <= 0) break;
      row.taxFreeCents++;
      remainderCents--;
    }
    const premiumBreakdown = Object.freeze(
      categoryRows.map(({ remainder: _remainder, ...row }) =>
        Object.freeze({
          ...row,
          taxablePremiumCents: row.paidPremiumCents - row.taxFreeCents,
        }),
      ),
    );
    results.push(
      Object.freeze({
        shiftId: shift.id,
        workedMinutes,
        nightMinutes,
        dayMinutes,
        paidPremiumCents,
        taxFreeCents,
        socialInsuranceFreeCents,
        taxablePremiumCents: paidPremiumCents - taxFreeCents,
        socialInsuranceLiablePremiumCents: paidPremiumCents - socialInsuranceFreeCents,
        premiumBreakdown,
      }),
    );
    yield 1;
  }
  const paidPremiumCents = results.reduce((sum, shift) => sum + shift.paidPremiumCents, 0);
  if (paidPremiumCents > input.grossCents)
    return fail("invalid-input", "Zuschlagszahlungen überschreiten das Gesamtbrutto.");
  const taxFreeCents = results.reduce((sum, shift) => sum + shift.taxFreeCents, 0);
  const socialInsuranceFreeCents = results.reduce(
    (sum, shift) => sum + shift.socialInsuranceFreeCents,
    0,
  );
  return Object.freeze({
    status: "available",
    ruleVersion: "DE-SFN-2026-PROTOTYPE",
    calculationBasis,
    workEvidence: input.workEvidence,
    amounts: Object.freeze({
      grossCents: input.grossCents,
      taxableGrossCents: input.grossCents - taxFreeCents,
      socialInsuranceGrossCents: input.grossCents - socialInsuranceFreeCents,
      regularMonthlySocialInsuranceGrossCents: input.regularMonthlySocialInsuranceGrossCents,
    }),
    shifts: Object.freeze(results),
    paidPremiumCents,
    taxFreeCents,
    socialInsuranceFreeCents,
  });
}
