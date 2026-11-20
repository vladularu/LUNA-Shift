import { projectRegularPayShifts } from "./special-duty";
import { calculateSpecialDutyPay } from "./special-duty-pay";
import { payrollEmploymentPeriods } from "./payroll-employment-periods";
import {
  isContinuedPayrollPackage,
  payrollTariffContinuation,
  payrollTariffPackageIds,
} from "./payroll-tariff-continuation";
import { isPayrollTariffContinuation, type DatedPayrollValue } from "./payroll-tariff-dates";
import { getTvhKrTable } from "./simple-tvh-kr-pay";
import { getTvUkNursingTable } from "./simple-tvuk-nursing-pay";
import { getTvlKrRulePackage } from "./simple-tvl-kr-pay";
import { getTvalPflegeRulePackage } from "./simple-tval-pflege-pay";
import { selectPayrollTable } from "./simple-tariff-table-overlay";
import { employmentWorkPatternAt, employmentProfileAt } from "@/domain/employment-history";
import {
  calculateTvalPflegeAssessment,
  calculateTvalPflegeProfileMonth,
  calculateTvalPflegeProfileShift,
} from "./simple-tval-pflege-profile-pay";
import { createSimpleMonthlyPayCache } from "./simple-monthly-pay-cache";
import {
  calculateTvhKrAssessment,
  calculateTvhKrProfileMonth,
  calculateTvhKrProfileShift,
} from "./simple-tvh-kr-profile-pay";
import {
  calculateTvUkNursingAssessment,
  calculateTvUkNursingProfileMonth,
  calculateTvUkNursingProfileShift,
} from "./simple-tvuk-nursing-profile-pay";
import {
  calculateTvlKrAssessment,
  calculateTvlKrProfileMonth,
  calculateTvlKrProfileShift,
} from "./simple-tvl-kr-profile-pay";
import {
  calculateVkaEShift,
  calculateVkaEMonth,
  calculateVkaEAssessment,
} from "./simple-vka-e-pay";
import {
  calculateNursingTrainingMonth,
  calculateNursingTrainingShift,
  calculateNursingTrainingAssessment,
} from "./simple-nursing-training-pay";
// Restored Build-31 calculator. Dated tariff engines remain separate.
import { Temporal } from "@js-temporal/polyfill";
import type { SfnTimeRange } from "@/domain/net-pay-sfn";

import type {
  MonthlyPayEstimate,
  MonthlyTariffDecision,
  PremiumLine,
  ShiftEntry,
  ShiftPremiumBreakdown,
  TvoedWorkPatternSettings,
  TvoedAssessment,
  UserProfile,
} from "@/domain/types";
import { getPublicHolidays } from "@/engine/holidays";
import { calculateMonthlyAllowanceAmounts } from "@/engine/pay-allowances";
import { assessTvoedKCalendarMonth } from "@/engine/tvoed-k-calendar-assessment";
import type { NightSequenceExplanation } from "@/engine/tvoed-k-calendar-nights";
import { conditionsMatch } from "@/engine/pay-conditions";
import { createManualMonthlyPayEstimate } from "@/engine/pay-fallback";
import {
  getHourlyTableAmountForStep,
  getIndividualHourlyRate,
  getMonthlyTableAmount,
  getOvertimeBaseHourlyRate,
  getTariffFullTimeWeeklyMinutes,
  getTariffRulePackage,
  getTariffVersion,
} from "@/engine/tariff";
import {
  assessTvoedPattern,
  DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  isPayWorkShift as isWorkShift,
} from "@/engine/tvoed-pattern";
import { calculateTimedShiftMinutes } from "@/engine/working-time";
import { getTariffAssessmentLookbackMonths } from "@/rules/calculation-windows";
import type {
  RulePremiumRule,
  RuleTariffPackage,
  RuleTimeWindow,
} from "@/rules/contracts.generated";
import { bundledRuleResolver, type RuleResolver } from "@/rules/rule-resolver";

const HOLIDAY_DATE_CACHE = new WeakMap<RuleResolver, Map<string, ReadonlySet<string>>>();

export { assessTvoedPattern, DEFAULT_TVOED_WORK_PATTERN_SETTINGS };

export interface MonthlyTvoedAssessmentResult {
  readonly nightSequence?: NightSequenceExplanation;
  readonly assessment: TvoedAssessment | null;
  readonly available: boolean;
  readonly tariffLabel: string | null;
}

interface PremiumMinuteBuckets {
  readonly byRuleId: Map<string, number>;
  readonly periodsByRuleId?: Map<string, [number, number][]>;
}

export interface TvoedShiftPremiumTrace extends SfnTimeRange {
  readonly breakdown: ShiftPremiumBreakdown;
  readonly unpaidBreaks: readonly SfnTimeRange[];
  readonly premiums: readonly {
    readonly ruleId: string;
    readonly premiumType: RulePremiumRule["premiumType"];
    readonly line: PremiumLine;
    readonly periods: readonly SfnTimeRange[];
  }[];
}

function premiumTimestamp(time: Temporal.ZonedDateTime): string {
  return time.toString({ smallestUnit: "minute", timeZoneName: "never" });
}

interface PremiumDayContext {
  readonly holiday: boolean;
  readonly sunday: boolean;
  readonly saturday: boolean;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function zonedStart(shift: ShiftEntry, timeZone: string): Temporal.ZonedDateTime {
  const date = Temporal.PlainDate.from(shift.date);
  const time = Temporal.PlainTime.from(shift.startTime!);
  return Temporal.ZonedDateTime.from(
    {
      timeZone,
      year: date.year,
      month: date.month,
      day: date.day,
      hour: time.hour,
      minute: time.minute,
    },
    { disambiguation: "earlier" },
  );
}

function grossMinutes(shift: ShiftEntry, timeZone: string): number {
  return calculateTimedShiftMinutes({ ...shift, breakMinutes: 0 }, timeZone);
}

function holidayDates(
  year: number,
  federalState: UserProfile["federalState"],
  holidayRegion: UserProfile["holidayRegion"],
  ruleResolver: RuleResolver,
): ReadonlySet<string> {
  const key = `${federalState}-${holidayRegion}-${year}`;
  const resolverCache = HOLIDAY_DATE_CACHE.get(ruleResolver);
  const cached = resolverCache?.get(key);
  if (cached) return cached;
  const dates = new Set(
    getPublicHolidays(year, federalState, ruleResolver, holidayRegion).map(
      (holiday) => holiday.date,
    ),
  );
  const nextCache = resolverCache ?? new Map<string, ReadonlySet<string>>();
  nextCache.set(key, dates);
  if (!resolverCache) HOLIDAY_DATE_CACHE.set(ruleResolver, nextCache);
  return dates;
}

function premiumDayContext(
  date: Temporal.PlainDate,
  federalState: UserProfile["federalState"],
  holidayRegion: UserProfile["holidayRegion"],
  ruleResolver: RuleResolver,
): PremiumDayContext {
  return {
    holiday: holidayDates(date.year, federalState, holidayRegion, ruleResolver).has(
      date.toString(),
    ),
    sunday: date.dayOfWeek === 7,
    saturday: date.dayOfWeek === 6,
  };
}

function timeWindowContains(window: RuleTimeWindow | null, minuteOfDay: number): boolean {
  if (window === null) return true;
  if (window.startMinute < window.endMinute) {
    return minuteOfDay >= window.startMinute && minuteOfDay < window.endMinute;
  }
  return minuteOfDay >= window.startMinute || minuteOfDay < window.endMinute;
}

function premiumAppliesOnDay(rule: RulePremiumRule, day: PremiumDayContext): boolean {
  switch (rule.premiumType) {
    case "NIGHT":
      return true;
    case "SUNDAY":
      return day.sunday;
    case "HOLIDAY_WITH_TIME_OFF":
    case "HOLIDAY_WITHOUT_TIME_OFF":
      return day.holiday;
    case "SATURDAY":
      return day.saturday;
    case "PRE_HOLIDAY":
      return true;
    case "OVERTIME":
      return false;
  }
}

function applyCombinationRules(
  candidates: readonly RulePremiumRule[],
  rulePackage: RuleTariffPackage,
): readonly RulePremiumRule[] {
  const selected = new Map(candidates.map((rule) => [rule.id, rule]));
  for (const combination of rulePackage.rules.combinationRules) {
    const members = combination.memberRuleIds
      .map((ruleId) => selected.get(ruleId))
      .filter((rule): rule is RulePremiumRule => rule !== undefined);
    if (members.length <= 1 || combination.mode === "STACK") continue;
    const winner =
      combination.mode === "PRIORITY"
        ? combination.priorityRuleIds
            .map((ruleId) => selected.get(ruleId))
            .find((rule): rule is RulePremiumRule => rule !== undefined)
        : members.reduce((left, right) =>
            left.percentageBasisPoints >= right.percentageBasisPoints ? left : right,
          );
    if (!winner) {
      throw new Error(`Combination rule ${combination.id} has no active priority winner.`);
    }
    for (const member of members) {
      if (member !== winner) selected.delete(member.id);
    }
  }
  return [...selected.values()];
}

function countPremiumMinute(
  buckets: PremiumMinuteBuckets,
  day: PremiumDayContext,
  date: string,
  minuteOfDay: number,
  shift: ShiftEntry,
  profile: UserProfile,
  rulePackage: RuleTariffPackage,
  cursor?: number,
): void {
  const candidates = rulePackage.rules.premiumRules.filter(
    (rule) =>
      premiumAppliesOnDay(rule, day) &&
      timeWindowContains(rule.timeWindow, minuteOfDay) &&
      conditionsMatch(rule.conditions, profile, date, shift, null),
  );
  for (const rule of applyCombinationRules(candidates, rulePackage)) {
    buckets.byRuleId.set(rule.id, (buckets.byRuleId.get(rule.id) ?? 0) + 1);
    if (buckets.periodsByRuleId && cursor !== undefined) {
      const periods = buckets.periodsByRuleId.get(rule.id) ?? [];
      const previous = periods.at(-1);
      if (previous?.[1] === cursor) previous[1] = cursor + 1;
      else periods.push([cursor, cursor + 1]);
      buckets.periodsByRuleId.set(rule.id, periods);
    }
  }
}

function countPremiumMinutes(
  shift: ShiftEntry,
  profile: UserProfile,
  gross: number,
  breakStart: number,
  breakEnd: number,
  rulePackage: RuleTariffPackage,
  ruleResolver: RuleResolver,
  includeTrace = false,
  from = 0,
  until = gross,
): {
  byRuleId: ReadonlyMap<string, number>;
  periodsByRuleId?: ReadonlyMap<string, SfnTimeRange[]>;
} {
  const buckets: PremiumMinuteBuckets = {
    byRuleId: new Map(),
    periodsByRuleId: includeTrace ? new Map() : undefined,
  };
  if (until <= from) return { byRuleId: buckets.byRuleId };

  // Collect minute intervals numerically; format only their boundaries, not every minute.
  const finish = () => {
    const timestamp = (minute: number) =>
      premiumTimestamp(
        Temporal.Instant.fromEpochMilliseconds(minute * 60_000).toZonedDateTimeISO(
          profile.timeZone,
        ),
      );
    return {
      byRuleId: buckets.byRuleId,
      periodsByRuleId:
        buckets.periodsByRuleId &&
        new Map(
          [...buckets.periodsByRuleId].map(([id, periods]) => [
            id,
            periods.map(([from, until]) => ({ start: timestamp(from), end: timestamp(until) })),
          ]),
        ),
    };
  };

  const start = zonedStart(shift, profile.timeZone);
  const lastMinute = start.add({ minutes: until - 1 });
  const crossesOffsetTransition = start.offsetNanoseconds !== lastMinute.offsetNanoseconds;

  if (crossesOffsetTransition) {
    const dayContexts = new Map<string, PremiumDayContext>();
    for (let index = from; index < until; index++) {
      if (index >= breakStart && index < breakEnd) continue;
      const cursor = start.add({ minutes: index });
      const date = cursor.toPlainDate();
      const dateKey = date.toString();
      let day = dayContexts.get(dateKey);
      if (!day) {
        day = premiumDayContext(date, profile.federalState, profile.holidayRegion, ruleResolver);
        dayContexts.set(dateKey, day);
      }
      countPremiumMinute(
        buckets,
        day,
        dateKey,
        cursor.hour * 60 + cursor.minute,
        shift,
        profile,
        rulePackage,
        includeTrace ? cursor.epochMilliseconds / 60_000 : undefined,
      );
    }
    return finish();
  }

  const startDate = start.toPlainDate();
  const startMinuteOfDay = start.hour * 60 + start.minute;
  const startEpochMinute = start.epochMilliseconds / 60_000;
  let cachedDayOffset = 0;
  let cachedDate = startDate;
  let cachedDay = premiumDayContext(
    startDate,
    profile.federalState,
    profile.holidayRegion,
    ruleResolver,
  );

  for (let index = from; index < until; index++) {
    if (index >= breakStart && index < breakEnd) continue;
    const localMinute = startMinuteOfDay + index;
    const dayOffset = Math.floor(localMinute / (24 * 60));
    if (dayOffset !== cachedDayOffset) {
      cachedDayOffset = dayOffset;
      cachedDate = dayOffset === 0 ? startDate : startDate.add({ days: dayOffset });
      cachedDay = premiumDayContext(
        cachedDate,
        profile.federalState,
        profile.holidayRegion,
        ruleResolver,
      );
    }
    countPremiumMinute(
      buckets,
      cachedDay,
      cachedDate.toString(),
      localMinute % (24 * 60),
      shift,
      profile,
      rulePackage,
      includeTrace ? startEpochMinute + index : undefined,
    );
  }
  return finish();
}

function premiumLine(
  key: string,
  label: string,
  minutes: number,
  percentage: number,
  hourlyRate: number,
): PremiumLine | null {
  if (minutes <= 0) return null;
  return {
    key,
    label,
    minutes,
    percentage,
    hourlyRate,
    amount: roundMoney((minutes / 60) * hourlyRate * (percentage / 100)),
  };
}

const SHIFT_PREMIUM_CACHE = new WeakMap<
  ShiftEntry,
  WeakMap<RuleResolver, Map<string, ShiftPremiumBreakdown>>
>();

function premiumCacheKey(shift: ShiftEntry, profile: UserProfile): string {
  const tariff = profile.tariff;
  return [
    shift.revision,
    shift.date,
    shift.type,
    shift.startTime,
    shift.endTime,
    shift.breakMinutes,
    shift.overtimeMinutes,
    shift.tariffOvertimeConfirmed,
    shift.holidayPremiumMode,
    shift.deletedAt,
    profile.updatedAt,
    profile.federalState,
    profile.holidayRegion,
    profile.weeklyMinutes,
    profile.timeZone,
    tariff?.payGroup,
    tariff?.payLevel,
    tariff?.sector,
    tariff?.tariffRegion,
    tariff?.fullTimeWeeklyMinutes,
  ].join("|");
}

function calculateShiftPremiumBreakdownUncached(
  shift: ShiftEntry,
  profile: UserProfile,
  ruleResolver: RuleResolver,
  trace?: TvoedShiftPremiumTrace["premiums"][number][],
): ShiftPremiumBreakdown {
  const tariff = profile.tariff;
  const rulePackage = getTariffRulePackage(shift.date, ruleResolver);
  if (!isWorkShift(shift) || tariff === null || rulePackage === null) {
    return {
      shiftId: shift.id,
      date: shift.date,
      netMinutes: isWorkShift(shift) ? calculateTimedShiftMinutes(shift, profile.timeZone) : 0,
      premiumLines: [],
      overtimeBaseAmount: 0,
      overtimePremiumAmount: 0,
      totalAmount: 0,
    };
  }

  const gross = grossMinutes(shift, profile.timeZone);
  const breakStart = Math.floor((gross - Math.min(gross, shift.breakMinutes)) / 2);
  const breakEnd = breakStart + Math.min(gross, shift.breakMinutes);
  const netMinutes = calculateTimedShiftMinutes(shift, profile.timeZone);
  const confirmedOvertime = shift.tariffOvertimeConfirmed
    ? Math.min(shift.overtimeMinutes, netMinutes)
    : 0;
  const segments = [{ from: 0, until: gross, date: shift.date, rulePackage }];
  if (gross > 0) {
    const start = zonedStart(shift, profile.timeZone);
    const nextDay = start.add({ days: 1 }).startOfDay();
    const nextDate = nextDay.toPlainDate().toString();
    const midnight = (nextDay.epochMilliseconds - start.epochMilliseconds) / 60_000;
    if (midnight < gross) {
      const next = getTariffRulePackage(nextDate, ruleResolver);
      if (next && next.versionId !== rulePackage.versionId) {
        segments[0].until = midnight;
        segments.push({ from: midnight, until: gross, date: nextDate, rulePackage: next });
      }
    }
  }
  const premiumKey = (rule: RulePremiumRule): string => {
    switch (rule.premiumType) {
      case "HOLIDAY_WITH_TIME_OFF":
      case "HOLIDAY_WITHOUT_TIME_OFF":
        return "holiday";
      case "PRE_HOLIDAY":
        return "preholiday";
      default:
        return rule.premiumType.toLowerCase();
    }
  };
  const lines: PremiumLine[] = [];
  let overtimeBaseAmount = 0;
  let overtimePremiumAmount = 0;
  for (const { from, until, date, rulePackage } of segments) {
    const individualRate = getIndividualHourlyRate(tariff, date, ruleResolver) ?? 0;
    const hourlyRateFor = (rule: RulePremiumRule): number => {
      if (rule.rateBasis === "INDIVIDUAL_HOURLY") return individualRate;
      if (rule.referenceStepId === null)
        throw new Error(`Premium rule ${rule.id} requires a reference step.`);
      return getHourlyTableAmountForStep(tariff, date, rule.referenceStepId, ruleResolver) ?? 0;
    };
    const buckets = countPremiumMinutes(
      shift,
      profile,
      gross,
      breakStart,
      breakEnd,
      rulePackage,
      ruleResolver,
      trace !== undefined,
      from,
      until,
    );
    for (const rule of rulePackage.rules.premiumRules) {
      if (rule.premiumType === "OVERTIME") continue;
      const line = premiumLine(
        premiumKey(rule),
        rule.label,
        buckets.byRuleId.get(rule.id) ?? 0,
        rule.percentageBasisPoints / 100,
        hourlyRateFor(rule),
      );
      if (!line) continue;
      lines.push(line);
      if (trace)
        trace.push({
          ruleId: segments.length > 1 ? rule.id + ":" + date : rule.id,
          premiumType: rule.premiumType,
          line,
          periods: buckets.periodsByRuleId!.get(rule.id)!,
        });
    }
    const overtimeRules = rulePackage.rules.premiumRules.filter(
      (rule) =>
        rule.premiumType === "OVERTIME" &&
        conditionsMatch(rule.conditions, profile, date, shift, null),
    );
    if (overtimeRules.length !== 1)
      throw new Error(
        `Expected one overtime rule for ${tariff.payGroup} on ${date}, found ${overtimeRules.length}.`,
      );
    const overtimeRule = overtimeRules[0];
    const workedMinutes = (start: number, end: number) =>
      end - start - Math.max(0, Math.min(end, breakEnd) - Math.max(start, breakStart));
    const overtimeMinutes = Math.min(
      workedMinutes(from, until),
      Math.max(0, confirmedOvertime - workedMinutes(until, gross)),
    );
    const overtimeRate = hourlyRateFor(overtimeRule);
    const overtimeBaseRate = getOvertimeBaseHourlyRate(rulePackage, tariff, individualRate);
    overtimeBaseAmount += roundMoney((overtimeMinutes / 60) * overtimeBaseRate);
    overtimePremiumAmount += roundMoney(
      (overtimeMinutes / 60) * overtimeRate * (overtimeRule.percentageBasisPoints / 10_000),
    );
  }
  overtimeBaseAmount = roundMoney(overtimeBaseAmount);
  overtimePremiumAmount = roundMoney(overtimePremiumAmount);
  const totalAmount = roundMoney(
    lines.reduce((sum, line) => sum + line.amount, 0) + overtimeBaseAmount + overtimePremiumAmount,
  );
  return {
    shiftId: shift.id,
    date: shift.date,
    netMinutes,
    premiumLines: lines,
    overtimeBaseAmount,
    overtimePremiumAmount,
    totalAmount,
  };
}

/** Exact rule-selected intervals using the same midpoint-pause forecast as the salary card. */
export function calculateTvoedShiftPremiumTrace(
  shift: ShiftEntry,
  profile: UserProfile,
  ruleResolver: RuleResolver = bundledRuleResolver,
): TvoedShiftPremiumTrace {
  const premiums: TvoedShiftPremiumTrace["premiums"][number][] = [];
  const month = shift.date.slice(0, 7);
  const payrollResolver = isPayrollTariffContinuation(ruleResolver)
    ? ruleResolver
    : payrollTariffContinuation(ruleResolver, month).resolver;
  const breakdown = calculateShiftPremiumBreakdownUncached(
    shift,
    profile,
    payrollResolver,
    premiums,
  );
  const start = zonedStart(shift, profile.timeZone);
  const gross = grossMinutes(shift, profile.timeZone);
  const pauseMinutes = Math.min(gross, shift.breakMinutes);
  const pauseStart = start.add({ minutes: Math.floor((gross - pauseMinutes) / 2) });
  return {
    start: premiumTimestamp(start),
    end: premiumTimestamp(start.add({ minutes: gross })),
    unpaidBreaks: pauseMinutes
      ? [
          {
            start: premiumTimestamp(pauseStart),
            end: premiumTimestamp(pauseStart.add({ minutes: pauseMinutes })),
          },
        ]
      : [],
    breakdown,
    premiums,
  };
}

export function calculateShiftPremiumBreakdown(
  shift: ShiftEntry,
  profile: UserProfile,
  ruleResolver: RuleResolver = bundledRuleResolver,
  tvlSaturdayShiftWork = false,
): ShiftPremiumBreakdown {
  profile = employmentProfileAt(profile, shift.date);
  if (profile.tvalPflegeTariff)
    return calculateTvalPflegeProfileShift(shift, profile, ruleResolver, tvlSaturdayShiftWork);
  if (profile.tvhKrTariff)
    return calculateTvhKrProfileShift(shift, profile, ruleResolver, tvlSaturdayShiftWork);
  if (profile.tvUkNursingTariff)
    return calculateTvUkNursingProfileShift(shift, profile, ruleResolver, tvlSaturdayShiftWork);
  if (profile.tvlKrTariff)
    return calculateTvlKrProfileShift(shift, profile, ruleResolver, tvlSaturdayShiftWork);
  if (profile.vkaETariff) return calculateVkaEShift(shift, profile, ruleResolver);
  if (profile.nursingTrainingTariff)
    return calculateNursingTrainingShift(shift, profile, ruleResolver);
  const key = premiumCacheKey(shift, profile);
  const cachedByResolver = SHIFT_PREMIUM_CACHE.get(shift);
  const cachedByInput = cachedByResolver?.get(ruleResolver);
  const cached = cachedByInput?.get(key);
  if (cached) return cached;

  const result = Object.freeze(
    calculateShiftPremiumBreakdownUncached(shift, profile, ruleResolver),
  );
  const nextCache = cachedByInput ?? new Map<string, ShiftPremiumBreakdown>();
  nextCache.set(key, result);
  const nextResolverCache =
    cachedByResolver ?? new WeakMap<RuleResolver, Map<string, ShiftPremiumBreakdown>>();
  if (!cachedByInput) nextResolverCache.set(ruleResolver, nextCache);
  if (!cachedByResolver) SHIFT_PREMIUM_CACHE.set(shift, nextResolverCache);
  return result;
}

const cachedMonthlyPay = createSimpleMonthlyPayCache();

function hasPayrollTariff(profile: UserProfile): boolean {
  return (
    payrollTariffPackageIds(profile).length > 0 ||
    !!profile.tvhKrTariff ||
    !!profile.tvUkNursingTariff
  );
}

export function calculateMonthlyPayEstimate(
  month: string,
  shifts: readonly ShiftEntry[],
  profile: UserProfile,
  decision: MonthlyTariffDecision | null,
  assessmentShifts: readonly ShiftEntry[] = shifts,
  workPatternSettings: TvoedWorkPatternSettings = DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  ruleResolver: RuleResolver = bundledRuleResolver,
): MonthlyPayEstimate {
  return cachedMonthlyPay(
    { month, shifts, profile, decision, assessmentShifts, workPatternSettings, ruleResolver },
    () => {
      let tariffApplies = hasPayrollTariff(profile);
      if (profile.employmentTimeline?.length) {
        const first = Temporal.PlainDate.from(month + "-01");
        const last = first.with({ day: first.daysInMonth }).toString();
        tariffApplies = payrollEmploymentPeriods(profile, month, last).some(({ profile }) =>
          hasPayrollTariff(profile),
        );
      }
      const continuation = tariffApplies ? payrollTariffContinuation(ruleResolver, month) : null;
      const pay = calculateMonthlyPay(
        month,
        shifts,
        profile,
        decision,
        assessmentShifts,
        workPatternSettings,
        continuation?.resolver ?? ruleResolver,
      );
      return continuation?.referenceMonths.size
        ? { ...pay, provisionalTariffMonths: [...continuation.referenceMonths].sort() }
        : pay;
    },
  );
}

function calculateMonthlyPay(
  month: string,
  shifts: readonly ShiftEntry[],
  profile: UserProfile,
  decision: MonthlyTariffDecision | null,
  assessmentShifts: readonly ShiftEntry[],
  workPatternSettings: TvoedWorkPatternSettings,
  ruleResolver: RuleResolver,
): MonthlyPayEstimate {
  if (
    !shifts.some((shift) => shift.specialDuty) &&
    !assessmentShifts.some((shift) => shift.specialDuty)
  )
    return calculateRegularMonthlyPayEstimate(
      month,
      shifts,
      profile,
      decision,
      assessmentShifts,
      workPatternSettings,
      ruleResolver,
    );
  const specialDutyBreakdowns = calculateSpecialDutyPay(month, shifts, profile, ruleResolver);
  const notes = [...new Set(specialDutyBreakdowns.flatMap((line) => line.notes))];
  const estimate = calculateRegularMonthlyPayEstimate(
    month,
    projectRegularPayShifts(shifts),
    profile,
    decision,
    assessmentShifts.filter((shift) => !shift.specialDuty),
    workPatternSettings,
    ruleResolver,
  );
  if (!specialDutyBreakdowns.length) return estimate;
  const specialDutyAmount =
    specialDutyBreakdowns
      .filter((line) => line.complete)
      .reduce(
        (sum, line) =>
          sum +
          (line.baseAmountCents ?? 0) +
          (line.calloutPay?.baseAmountCents ?? 0) +
          (line.calloutPay?.overtimePremiumCents ?? 0) +
          (line.calloutPay?.timePremiumCents ?? 0),
        0,
      ) / 100;
  const result = { ...estimate, specialDutyBreakdowns, specialDutyAmount };
  return specialDutyBreakdowns.some((line) => !line.complete)
    ? {
        ...result,
        available: false,
        estimatedGrossAmount: null,
        ...(estimate.available && estimate.estimatedGrossAmount !== null
          ? { knownGrossAmount: roundMoney(estimate.estimatedGrossAmount + specialDutyAmount) }
          : {}),
        specialDutyNotes: notes,
      }
    : {
        ...result,
        estimatedGrossAmount:
          estimate.estimatedGrossAmount === null
            ? null
            : roundMoney(estimate.estimatedGrossAmount + specialDutyAmount),
      };
}

function payrollVersionKey(profile: UserProfile, date: string, resolver: RuleResolver): string {
  const dated = (value?: DatedPayrollValue | null) =>
    value
      ? [value.validFrom, value.validTo, value.validTo !== null && value.validTo < date].join("/")
      : "";
  if (profile.tvhKrTariff) return dated(getTvhKrTable(date, resolver));
  if (profile.tvUkNursingTariff) return dated(getTvUkNursingTable(date, resolver));
  if (profile.tvlKrTariff) return dated(getTvlKrRulePackage(date, resolver));
  if (profile.tvalPflegeTariff) return dated(getTvalPflegeRulePackage(date, resolver));
  const resolutions = payrollTariffPackageIds(profile).map((id) =>
    resolver.resolveTariff(date, id),
  );
  const packages = resolutions.map((result) => {
    return result.ok
      ? result.value.versionId + "/" + (result.provisionalReferenceDate ?? "")
      : result.error.code;
  });
  const family = profile.vkaETariff
    ? "TVOED_VKA_E"
    : profile.nursingTrainingTariff
      ? "TVAOED_PFLEGE"
      : null;
  if (family)
    packages.push(
      dated(
        selectPayrollTable(
          resolver,
          family,
          date,
          resolutions[0]?.ok ? resolutions[0].value : null,
        ),
      ),
    );
  return packages.join("|");
}

function splitAtTariffChanges(
  periods: ReturnType<typeof payrollEmploymentPeriods>,
  endOfMonth: string,
  resolver: RuleResolver,
): ReturnType<typeof payrollEmploymentPeriods> {
  return periods.flatMap((period) => {
    if (!hasPayrollTariff(period.profile)) return [period];
    const versionAt = (date: string) => payrollVersionKey(period.profile, date, resolver);
    const result = [];
    let from = period.from;
    let version = versionAt(from);
    const until = period.until ?? endOfMonth;
    for (
      let cursor = Temporal.PlainDate.from(from).add({ days: 1 });
      cursor.toString() < until;
      cursor = cursor.add({ days: 1 })
    ) {
      const date = cursor.toString();
      const nextVersion = versionAt(date);
      if (nextVersion !== version) {
        result.push({ ...period, from, until: date });
        from = date;
        version = nextVersion;
      }
    }
    result.push({ ...period, from });
    return result;
  });
}

export function hasProvisionalPayrollTariff(
  month: string,
  profile: UserProfile,
  ruleResolver: RuleResolver,
): boolean {
  const first = Temporal.PlainDate.from(month + "-01");
  const last = first.with({ day: first.daysInMonth }).toString();
  const periods = payrollEmploymentPeriods(profile, month, last);
  if (!periods.some(({ profile }) => hasPayrollTariff(profile))) return false;
  const continuation = payrollTariffContinuation(ruleResolver, month);
  splitAtTariffChanges(periods, first.add({ months: 1 }).toString(), continuation.resolver);
  return continuation.referenceMonths.size > 0;
}

function calculateRegularMonthlyPayEstimate(
  month: string,
  shifts: readonly ShiftEntry[],
  profile: UserProfile,
  decision: MonthlyTariffDecision | null,
  assessmentShifts: readonly ShiftEntry[],
  workPatternSettings: TvoedWorkPatternSettings,
  ruleResolver: RuleResolver,
): MonthlyPayEstimate {
  const first = Temporal.PlainDate.from(month + "-01");
  const last = first.with({ day: first.daysInMonth }).toString();
  const endOfMonth = first.add({ months: 1 }).toString();
  const periods = splitAtTariffChanges(
    payrollEmploymentPeriods(profile, month, last),
    endOfMonth,
    ruleResolver,
  );
  if (periods.length > 1) {
    const parts = periods.map((period) => {
      const selected = { ...period.profile, employmentTimeline: undefined };
      const days = Temporal.PlainDate.from(period.until ?? endOfMonth).since(
        Temporal.PlainDate.from(period.from),
      ).days;
      const inPeriod = shifts.filter(
        (shift) => shift.date >= period.from && (!period.until || shift.date < period.until),
      );
      const estimate = calculateMonthlyPayEstimateUncached(
        month,
        inPeriod,
        selected,
        decision,
        assessmentShifts,
        employmentWorkPatternAt(period.profile, workPatternSettings, period.from),
        ruleResolver,
        period.from,
      );
      const fixed = calculateMonthlyPayEstimateUncached(
        month,
        [],
        selected,
        decision,
        assessmentShifts,
        employmentWorkPatternAt(period.profile, workPatternSettings, period.from),
        ruleResolver,
        period.from,
      );
      return { estimate, fixed, days };
    });
    const anchor = parts[0].estimate;
    const available = parts.every((p) => p.estimate.available && p.fixed.available);
    const fixedAmount = (
      key:
        "personalBaseAmount" | "allowanceAmount" | "tvoedAllowanceAmount" | "careAllowanceAmount",
    ) => {
      const groups = new Map<number, number>();
      let variable = 0;
      for (const p of parts) {
        const cents = Math.round((p.fixed[key] ?? 0) * 100);
        groups.set(cents, (groups.get(cents) ?? 0) + p.days);
        if (key !== "personalBaseAmount") variable += (p.estimate[key] ?? 0) - (p.fixed[key] ?? 0);
      }
      return roundMoney(
        [...groups].reduce(
          (sum, [cents, days]) => sum + Math.round((cents * days) / first.daysInMonth) / 100,
          variable,
        ),
      );
    };
    const personalBaseAmount = available ? fixedAmount("personalBaseAmount") : null;
    const allowanceAmount = fixedAmount("allowanceAmount"),
      tvoedAllowanceAmount = fixedAmount("tvoedAllowanceAmount"),
      careAllowanceAmount = fixedAmount("careAllowanceAmount");
    const timePremiumAmount = roundMoney(
      parts.reduce((sum, p) => sum + p.estimate.timePremiumAmount, 0),
    );
    const overtimeAmount = roundMoney(parts.reduce((sum, p) => sum + p.estimate.overtimeAmount, 0));
    return {
      ...anchor,
      available,
      fullTimeTableAmount: null,
      personalBaseAmount,
      tariffLabel: [...new Set(parts.map((p) => p.estimate.tariffLabel))]
        .filter(Boolean)
        .join(" / "),
      shiftBreakdowns: parts.flatMap((p) => p.estimate.shiftBreakdowns),
      timePremiumAmount,
      overtimeAmount,
      allowanceAmount,
      tvoedAllowanceAmount,
      careAllowanceAmount,
      estimatedGrossAmount:
        personalBaseAmount === null
          ? null
          : roundMoney(
              personalBaseAmount +
                timePremiumAmount +
                overtimeAmount +
                allowanceAmount +
                tvoedAllowanceAmount +
                careAllowanceAmount,
            ),
    };
  }
  profile = periods[0].profile;
  workPatternSettings = employmentWorkPatternAt(profile, workPatternSettings, first.toString());
  return calculateMonthlyPayEstimateUncached(
    month,
    shifts,
    profile,
    decision,
    assessmentShifts,
    workPatternSettings,
    ruleResolver,
  );
}

function calculateMonthlyPayEstimateUncached(
  month: string,
  shifts: readonly ShiftEntry[],
  profile: UserProfile,
  decision: MonthlyTariffDecision | null,
  assessmentShifts: readonly ShiftEntry[] = shifts,
  workPatternSettings: TvoedWorkPatternSettings = DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  ruleResolver: RuleResolver = bundledRuleResolver,
  pricingDate = month + "-01",
): MonthlyPayEstimate {
  if (profile.tvalPflegeTariff)
    return calculateTvalPflegeProfileMonth(
      month,
      shifts,
      profile,
      decision,
      assessmentShifts,
      workPatternSettings,
      ruleResolver,
      pricingDate,
    );
  if (profile.tvhKrTariff)
    return calculateTvhKrProfileMonth(
      month,
      shifts,
      profile,
      decision,
      assessmentShifts,
      workPatternSettings,
      ruleResolver,
      pricingDate,
    );
  if (profile.tvUkNursingTariff)
    return calculateTvUkNursingProfileMonth(
      month,
      shifts,
      profile,
      assessmentShifts,
      ruleResolver,
      pricingDate,
    );
  if (profile.tvlKrTariff)
    return calculateTvlKrProfileMonth(
      month,
      shifts,
      profile,
      decision,
      assessmentShifts,
      workPatternSettings,
      ruleResolver,
      pricingDate,
    );
  if (profile.vkaETariff)
    return calculateVkaEMonth(
      month,
      shifts,
      profile,
      decision,
      assessmentShifts,
      workPatternSettings,
      ruleResolver,
      pricingDate,
    );
  if (profile.nursingTrainingTariff)
    return calculateNursingTrainingMonth(
      month,
      shifts,
      profile,
      decision,
      assessmentShifts,
      workPatternSettings,
      ruleResolver,
      pricingDate,
    );
  if (profile.tariff === null && profile.manualMonthlyGrossCents != null) {
    return createManualMonthlyPayEstimate(month, profile.manualMonthlyGrossCents);
  }

  const monthShifts = shifts.filter(
    (shift) => shift.deletedAt === null && shift.date.startsWith(`${month}-`) && isWorkShift(shift),
  );
  const dateKey = pricingDate;
  const rulePackage = getTariffRulePackage(dateKey, ruleResolver);
  const assessmentResult = calculateMonthlyTvoedAssessment(
    month,
    monthShifts,
    assessmentShifts,
    workPatternSettings,
    ruleResolver,
    profile,
  );
  const assessment =
    assessmentResult.assessment ??
    assessTvoedPattern([], workPatternSettings, ruleResolver, dateKey);
  const version = getTariffVersion(dateKey, ruleResolver);
  const tariff = profile.tariff;
  if (
    version === null ||
    tariff === null ||
    rulePackage === null ||
    getMonthlyTableAmount(tariff, dateKey, ruleResolver) === null
  ) {
    return {
      month,
      tariffLabel: version?.label ?? null,
      available: false,
      fullTimeTableAmount: null,
      personalBaseAmount: null,
      shiftBreakdowns: [],
      timePremiumAmount: 0,
      overtimeAmount: 0,
      allowanceAmount: 0,
      tvoedAllowanceAmount: 0,
      careAllowanceAmount: 0,
      estimatedGrossAmount: null,
      assessment,
      confirmedAllowance: decision?.allowanceStatus ?? null,
    };
  }
  const shiftBreakdowns = monthShifts.map((shift) =>
    calculateShiftPremiumBreakdown(shift, profile, ruleResolver),
  );
  const fullTimeWeeklyMinutes = getTariffFullTimeWeeklyMinutes(tariff, dateKey, ruleResolver);
  if (fullTimeWeeklyMinutes === null) {
    throw new Error(`No tariff weekly working time is available for ${dateKey}.`);
  }
  const fullTimeTableAmount = getMonthlyTableAmount(tariff, dateKey, ruleResolver)!;
  const personalBaseAmount = roundMoney(
    fullTimeTableAmount * (profile.weeklyMinutes / fullTimeWeeklyMinutes),
  );
  const timePremiumAmount = roundMoney(
    shiftBreakdowns.reduce(
      (sum, item) => sum + item.premiumLines.reduce((lineSum, line) => lineSum + line.amount, 0),
      0,
    ),
  );
  const overtimeAmount = roundMoney(
    shiftBreakdowns.reduce(
      (sum, item) => sum + item.overtimeBaseAmount + item.overtimePremiumAmount,
      0,
    ),
  );
  const workMinutes = shiftBreakdowns.reduce((sum, item) => sum + item.netMinutes, 0);
  const confirmedAllowance = decision?.allowanceStatus ?? null;
  const effectiveAllowance = confirmedAllowance ?? assessment.suggestedAllowance;
  const {
    allowanceAmount: monthlyAllowanceAmount,
    careAllowanceAmount: monthlyCareAllowanceAmount,
    tvoedAllowanceAmount: monthlyTvoedAllowanceAmount,
  } = calculateMonthlyAllowanceAmounts({
    date: dateKey,
    fullTimeWeeklyMinutes,
    profile,
    rulePackage,
    status: effectiveAllowance,
    workMinutes,
    allowExpiredAllowances: isContinuedPayrollPackage(rulePackage),
  });
  return {
    month,
    tariffLabel: version.label,
    available: true,
    fullTimeTableAmount,
    personalBaseAmount,
    shiftBreakdowns,
    timePremiumAmount,
    overtimeAmount,
    allowanceAmount: monthlyAllowanceAmount,
    tvoedAllowanceAmount: monthlyTvoedAllowanceAmount,
    careAllowanceAmount: monthlyCareAllowanceAmount,
    estimatedGrossAmount: roundMoney(
      personalBaseAmount +
        timePremiumAmount +
        overtimeAmount +
        monthlyAllowanceAmount +
        monthlyTvoedAllowanceAmount +
        monthlyCareAllowanceAmount,
    ),
    assessment,
    confirmedAllowance,
  };
}

export function calculateMonthlyTvoedAssessment(
  month: string,
  monthShifts: readonly ShiftEntry[],
  assessmentShifts: readonly ShiftEntry[],
  workPatternSettings: TvoedWorkPatternSettings = DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  ruleResolver: RuleResolver = bundledRuleResolver,
  profile?: Pick<
    UserProfile,
    | "tariff"
    | "timeZone"
    | "nursingTrainingTariff"
    | "vkaETariff"
    | "tvlKrTariff"
    | "tvUkNursingTariff"
    | "tvhKrTariff"
    | "tvalPflegeTariff"
    | "employmentTimeline"
    | "workPattern"
  >,
): MonthlyTvoedAssessmentResult {
  if (profile)
    workPatternSettings = employmentWorkPatternAt(profile, workPatternSettings, month + "-01");
  if (profile?.tvalPflegeTariff)
    return calculateTvalPflegeAssessment(
      month,
      assessmentShifts,
      workPatternSettings,
      ruleResolver,
    );
  if (profile?.tvhKrTariff)
    return calculateTvhKrAssessment(month, assessmentShifts, workPatternSettings, profile.timeZone);
  if (profile?.tvUkNursingTariff) return calculateTvUkNursingAssessment(month, assessmentShifts);
  if (profile?.tvlKrTariff)
    return calculateTvlKrAssessment(month, assessmentShifts, workPatternSettings, ruleResolver);
  if (profile?.vkaETariff)
    return calculateVkaEAssessment(
      month,
      assessmentShifts,
      workPatternSettings,
      ruleResolver,
      profile,
    );
  if (profile?.nursingTrainingTariff)
    return calculateNursingTrainingAssessment(
      month,
      assessmentShifts,
      workPatternSettings,
      ruleResolver,
      profile,
    );
  const first = Temporal.PlainDate.from(`${month}-01`);
  const dateKey = first.toString();
  const rulePackage = getTariffRulePackage(dateKey, ruleResolver);
  const version = getTariffVersion(dateKey, ruleResolver);
  if (rulePackage === null || version === null) {
    return { assessment: null, available: false, tariffLabel: version?.label ?? null };
  }
  const currentWorkShifts = monthShifts.filter(
    (shift) => shift.deletedAt === null && shift.date.startsWith(`${month}-`) && isWorkShift(shift),
  );
  const assessmentStart = first
    .subtract({ months: getTariffAssessmentLookbackMonths(dateKey, ruleResolver) })
    .toString();
  const assessmentEnd = first.add({ months: 1 }).subtract({ days: 1 }).toString();
  if (profile?.tariff?.sector === "BT_K") {
    const relevant = assessmentShifts.filter(
      (shift) =>
        shift.deletedAt === null && shift.date >= assessmentStart && shift.date <= assessmentEnd,
    );
    return {
      ...assessTvoedKCalendarMonth(
        month,
        relevant,
        workPatternSettings,
        ruleResolver,
        profile.timeZone,
      ),
      available: true,
      tariffLabel: version.label,
    };
  }
  const relevantShifts =
    currentWorkShifts.length === 0
      ? []
      : assessmentShifts.filter(
          (shift) =>
            shift.deletedAt === null &&
            shift.date >= assessmentStart &&
            shift.date <= assessmentEnd &&
            isWorkShift(shift),
        );
  return {
    assessment: assessTvoedPattern(relevantShifts, workPatternSettings, ruleResolver, dateKey),
    available: true,
    tariffLabel: version.label,
  };
}
