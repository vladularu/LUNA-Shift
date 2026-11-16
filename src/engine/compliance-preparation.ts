import type { ComplianceOptions } from "./compliance";
import { projectDutyShifts } from "./special-duty";
import { planningWeekendCoverageStart } from "@/domain/planning-weekend-policy";
import { calculateTimedShiftMinutes } from "@/engine/working-time";
import { getLegalCalculationEnd, getLegalCalculationWindow } from "@/rules/calculation-windows";
import { Temporal } from "@js-temporal/polyfill";
import type { ShiftEntry } from "@/domain/types";
import type { RuleLegalPackage } from "@/rules/contracts.generated";
import {
  bundledRuleResolver,
  requireResolvedPackage,
  type RuleResolver,
} from "@/rules/rule-resolver";
import type { ComplianceInterval as Interval } from "./compliance-sequences";

export interface ComplianceCalendarContext {
  readonly shifts: readonly ShiftEntry[];
  readonly referenceDate: Temporal.PlainDate;
  readonly first: Temporal.PlainDate;
  readonly legalPackage: RuleLegalPackage;
  readonly rules: RuleLegalPackage["rules"];
  readonly baseEnd: Temporal.PlainDate;
  readonly shortAssessmentStart: Temporal.PlainDate;
  readonly shortAssessmentEnd: Temporal.PlainDate;
  readonly start: string;
  readonly end: string;
  readonly intervals: readonly Interval[];
  readonly calculationShifts: readonly ShiftEntry[];
}

/** Request-local only: callers hold one immutable annual input snapshot. */
export type CompliancePreparation = WeakMap<
  RuleResolver,
  WeakMap<readonly ShiftEntry[], Map<string, ComplianceCalendarContext>>
>;
export function createCompliancePreparation(): CompliancePreparation {
  return new WeakMap();
}

const RELEVANT_TYPES = new Set(["EARLY", "LATE", "NIGHT", "DAY", "TRAINING", "CUSTOM"]);

interface CachedInterval {
  readonly signature: string;
  readonly value: Interval;
}

const INTERVAL_CACHE = new WeakMap<ShiftEntry, Map<string, CachedInterval>>();

function isRelevant(shift: ShiftEntry): boolean {
  return (
    shift.deletedAt === null &&
    !shift.allDay &&
    RELEVANT_TYPES.has(shift.type) &&
    shift.startTime !== null &&
    shift.endTime !== null
  );
}

function compareIntervalsByRecordedStart(left: Interval, right: Interval): number {
  return (
    left.shift.date.localeCompare(right.shift.date) ||
    (left.shift.startTime ?? "").localeCompare(right.shift.startTime ?? "") ||
    left.shift.id.localeCompare(right.shift.id)
  );
}

function intervalSignature(shift: ShiftEntry): string {
  return [
    shift.revision,
    shift.date,
    shift.type,
    shift.startTime,
    shift.endTime,
    shift.breakMinutes,
    shift.deletedAt,
  ].join("|");
}

function toInterval(shift: ShiftEntry, timeZone: string): Interval {
  const signature = intervalSignature(shift);
  const cachedByTimeZone = INTERVAL_CACHE.get(shift);
  const cached = cachedByTimeZone?.get(timeZone);
  if (cached?.signature === signature) return cached.value;

  const date = Temporal.PlainDate.from(shift.date);
  const startTime = Temporal.PlainTime.from(shift.startTime!);
  const endTime = Temporal.PlainTime.from(shift.endTime!);
  const endDate =
    Temporal.PlainTime.compare(endTime, startTime) <= 0 ? date.add({ days: 1 }) : date;
  const start = Temporal.ZonedDateTime.from(
    {
      timeZone,
      year: date.year,
      month: date.month,
      day: date.day,
      hour: startTime.hour,
      minute: startTime.minute,
    },
    { disambiguation: "earlier" },
  );
  const end = Temporal.ZonedDateTime.from(
    {
      timeZone,
      year: endDate.year,
      month: endDate.month,
      day: endDate.day,
      hour: endTime.hour,
      minute: endTime.minute,
    },
    { disambiguation: "later" },
  );
  const value = Object.freeze({
    shift,
    start,
    end,
    grossMinutes: Math.max(
      0,
      Math.round(Number(end.epochMilliseconds - start.epochMilliseconds) / 60_000),
    ),
    netMinutes: calculateTimedShiftMinutes(shift, timeZone),
  });
  const nextCache = cachedByTimeZone ?? new Map<string, CachedInterval>();
  nextCache.set(timeZone, Object.freeze({ signature, value }));
  if (!cachedByTimeZone) INTERVAL_CACHE.set(shift, nextCache);
  return value;
}

export function* prepareComplianceIntervalsIncrementally(
  shifts: readonly ShiftEntry[],
  timeZone: string,
  batchSize = 4,
): Generator<number, void, void> {
  const safeBatchSize = Math.max(1, Math.floor(batchSize));
  let prepared = 0;
  for (const shift of shifts) {
    if (!isRelevant(shift)) continue;
    toInterval(shift, timeZone);
    prepared += 1;
    if (prepared % safeBatchSize === 0) yield prepared;
  }
  if (prepared % safeBatchSize !== 0) yield prepared;
}

export function* prepareComplianceCalendarSteps(
  month: string,
  shifts: readonly ShiftEntry[],
  timeZone: string,
  options: ComplianceOptions = {},
): Generator<number, ComplianceCalendarContext, void> {
  const input = shifts;
  const resolver = options.ruleResolver ?? bundledRuleResolver;
  const key = JSON.stringify([
    month,
    timeZone,
    options.referenceDate ?? Temporal.Now.plainDateISO(timeZone).toString(),
  ]);
  const byInput = options.preparation?.get(resolver);
  const byMonth = byInput?.get(input);
  const known = byMonth?.get(key);
  if (known) return known;
  shifts = projectDutyShifts(shifts);
  const ruleResolver = options.ruleResolver ?? bundledRuleResolver;
  const referenceDate = Temporal.PlainDate.from(
    options.referenceDate ?? Temporal.Now.plainDateISO(timeZone).toString(),
  );
  const first = Temporal.PlainDate.from(`${month}-01`);
  const legalPackage = requireResolvedPackage(ruleResolver.resolveLegal(first.toString()));
  const rules = legalPackage.rules;
  const calculationWindow = getLegalCalculationWindow(first.toString(), ruleResolver);
  const baseStart = first.subtract({ days: calculationWindow.lookbackDays });
  const monthEnd = first.add({ months: 1 }).subtract({ days: 1 });
  const shortAssessmentStart = first.subtract({
    days: calculationWindow.shortAssessmentLookbackDays,
  });
  const shortDayAssessmentEnd = monthEnd.add({
    days: calculationWindow.shortAssessmentLookaheadDays,
  });
  const shortMonthAssessmentEnd = monthEnd.add({
    months: calculationWindow.shortAssessmentLookaheadCalendarMonths,
  });
  const shortAssessmentEnd =
    Temporal.PlainDate.compare(shortDayAssessmentEnd, shortMonthAssessmentEnd) >= 0
      ? shortDayAssessmentEnd
      : shortMonthAssessmentEnd;
  const baseEnd = getLegalCalculationEnd(monthEnd, calculationWindow);
  const yearStart = Temporal.PlainDate.from({ year: first.year, month: 1, day: 1 });
  const yearEnd = Temporal.PlainDate.from({ year: first.year, month: 12, day: 31 });
  const legalStart = (
    calculationWindow.calendarYearCoverage && Temporal.PlainDate.compare(yearStart, baseStart) < 0
      ? yearStart
      : baseStart
  ).toString();
  const weekendStart = planningWeekendCoverageStart(month);
  const start = legalStart < weekendStart ? legalStart : weekendStart;
  const end = (
    calculationWindow.calendarYearCoverage && Temporal.PlainDate.compare(yearEnd, baseEnd) > 0
      ? yearEnd
      : baseEnd
  ).toString();
  const preparation = prepareComplianceIntervalsIncrementally(shifts, timeZone);
  while (true) {
    const step = preparation.next();
    if (step.done) break;
    yield step.value;
  }
  const intervals = shifts
    .filter((shift) => isRelevant(shift) && shift.date >= start && shift.date <= end)
    .map((shift) => toInterval(shift, timeZone))
    .sort(compareIntervalsByRecordedStart);
  const calculationShifts = shifts.filter(
    (shift) => shift.deletedAt === null && shift.date >= start && shift.date <= end,
  );
  const result = {
    shifts,
    ruleResolver,
    referenceDate,
    first,
    legalPackage,
    rules,
    baseEnd,
    shortAssessmentStart,
    shortAssessmentEnd,
    start,
    end,
    intervals,
    calculationShifts,
  };
  if (options.preparation) {
    const inputs =
      byInput ?? new WeakMap<readonly ShiftEntry[], Map<string, ComplianceCalendarContext>>();
    const months = byMonth ?? new Map<string, ComplianceCalendarContext>();
    months.set(key, result);
    inputs.set(input, months);
    options.preparation.set(resolver, inputs);
  }
  return result;
}
