import { projectRegularPayShifts } from "./special-duty";
import { calculateSpecialDutyPay } from "./special-duty-pay";
import { payrollEmploymentPeriods } from "./payroll-employment-periods";
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
  periodsByRuleId?: Map<string, SfnTimeRange[]>,
): PremiumMinuteBuckets {
  const buckets: PremiumMinuteBuckets = {
    byRuleId: new Map(),
    periodsByRuleId: periodsByRuleId ? new Map() : undefined,
  };
  if (gross <= 0) return buckets;

  // Collect minute intervals numerically; format only their boundaries, not every minute.
  const finish = () => {
    const timestamp = (minute: number) =>
      premiumTimestamp(
        Temporal.Instant.fromEpochMilliseconds(minute * 60_000).toZonedDateTimeISO(
          profile.timeZone,
        ),
      );
    for (const [id, periods] of buckets.periodsByRuleId ?? [])
      periodsByRuleId!.set(
        id,
        periods.map(([from, until]) => ({ start: timestamp(from), end: timestamp(until) })),
      );
    return buckets;
  };

  const start = zonedStart(shift, profile.timeZone);
  const lastMinute = start.add({ minutes: gross - 1 });
  const crossesOffsetTransition = start.offsetNanoseconds !== lastMinute.offsetNanoseconds;

  if (crossesOffsetTransition) {
    const dayContexts = new Map<string, PremiumDayContext>();
    for (let index = 0; index < gross; index++) {
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
        periodsByRuleId ? cursor.epochMilliseconds / 60_000 : undefined,
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

  for (let index = 0; index < gross; index++) {
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
      periodsByRuleId ? startEpochMinute + index : undefined,
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
  periodsByRuleId?: Map<string, SfnTimeRange[]>,
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

  const individualRate = getIndividualHourlyRate(tariff, shift.date, ruleResolver) ?? 0;
  const gross = grossMinutes(shift, profile.timeZone);
  const breakStart = Math.floor((gross - Math.min(gross, shift.breakMinutes)) / 2);
  const breakEnd = breakStart + Math.min(gross, shift.breakMinutes);
  const buckets = countPremiumMinutes(
    shift,
    profile,
    gross,
    breakStart,
    breakEnd,
    rulePackage,
    ruleResolver,
    periodsByRuleId,
  );
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
  const hourlyRateFor = (rule: RulePremiumRule): number => {
    if (rule.rateBasis === "INDIVIDUAL_HOURLY") return individualRate;
    if (rule.referenceStepId === null) {
      throw new Error(`Premium rule ${rule.id} requires a reference step.`);
    }
    return getHourlyTableAmountForStep(tariff, shift.date, rule.referenceStepId, ruleResolver) ?? 0;
  };
  const lines = rulePackage.rules.premiumRules
    .filter((rule) => rule.premiumType !== "OVERTIME")
    .map((rule) =>
      premiumLine(
        premiumKey(rule),
        rule.label,
        buckets.byRuleId.get(rule.id) ?? 0,
        rule.percentageBasisPoints / 100,
        hourlyRateFor(rule),
      ),
    )
    .filter((line): line is PremiumLine => line !== null);
  const netMinutes = calculateTimedShiftMinutes(shift, profile.timeZone);
  const overtimeMinutes = shift.tariffOvertimeConfirmed
    ? Math.min(shift.overtimeMinutes, netMinutes)
    : 0;
  const overtimeRules = rulePackage.rules.premiumRules.filter(
    (rule) =>
      rule.premiumType === "OVERTIME" &&
      conditionsMatch(rule.conditions, profile, shift.date, shift, null),
  );
  if (overtimeRules.length !== 1) {
    throw new Error(
      `Expected one overtime rule for ${tariff.payGroup} on ${shift.date}, found ${overtimeRules.length}.`,
    );
  }
  const overtimeRule = overtimeRules[0];
  const overtimeRate = hourlyRateFor(overtimeRule);
  const overtimeBaseRate = getOvertimeBaseHourlyRate(rulePackage, tariff, individualRate);
  const overtimeBaseAmount = roundMoney((overtimeMinutes / 60) * overtimeBaseRate);
  const overtimePremiumAmount = roundMoney(
    (overtimeMinutes / 60) * overtimeRate * (overtimeRule.percentageBasisPoints / 10_000),
  );
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
  const periods = new Map<string, SfnTimeRange[]>();
  const breakdown = calculateShiftPremiumBreakdownUncached(shift, profile, ruleResolver, periods);
  const start = zonedStart(shift, profile.timeZone);
  const gross = grossMinutes(shift, profile.timeZone);
  const pauseMinutes = Math.min(gross, shift.breakMinutes);
  const pauseStart = start.add({ minutes: Math.floor((gross - pauseMinutes) / 2) });
  const rules = getTariffRulePackage(shift.date, ruleResolver)?.rules.premiumRules ?? [];
  let lineIndex = 0;
  const premiums = rules
    .filter((rule) => rule.premiumType !== "OVERTIME" && periods.has(rule.id))
    .map((rule) => ({
      ruleId: rule.id,
      premiumType: rule.premiumType,
      line: breakdown.premiumLines[lineIndex++],
      periods: periods.get(rule.id)!,
    }));
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

export function calculateMonthlyPayEstimate(
  month: string,
  shifts: readonly ShiftEntry[],
  profile: UserProfile,
  decision: MonthlyTariffDecision | null,
  assessmentShifts: readonly ShiftEntry[] = shifts,
  workPatternSettings: TvoedWorkPatternSettings = DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  ruleResolver: RuleResolver = bundledRuleResolver,
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
    specialDutyBreakdowns.reduce(
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
    ? { ...result, available: false, estimatedGrossAmount: null, specialDutyNotes: notes }
    : {
        ...result,
        estimatedGrossAmount:
          estimate.estimatedGrossAmount === null
            ? null
            : roundMoney(estimate.estimatedGrossAmount + specialDutyAmount),
      };
}

function calculateRegularMonthlyPayEstimate(
  month: string,
  shifts: readonly ShiftEntry[],
  profile: UserProfile,
  decision: MonthlyTariffDecision | null,
  assessmentShifts: readonly ShiftEntry[] = shifts,
  workPatternSettings: TvoedWorkPatternSettings = DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  ruleResolver: RuleResolver = bundledRuleResolver,
): MonthlyPayEstimate {
  const first = Temporal.PlainDate.from(month + "-01");
  const last = first.with({ day: first.daysInMonth }).toString();
  const periods = payrollEmploymentPeriods(profile, month, last);
  if (periods.length > 1) {
    const parts = periods.map((period) => {
      const selected = { ...period.profile, employmentTimeline: undefined };
      const days = Temporal.PlainDate.from(
        period.until ?? first.add({ months: 1 }).toString(),
      ).since(Temporal.PlainDate.from(period.from)).days;
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
      );
      const fixed = calculateMonthlyPayEstimateUncached(
        month,
        [],
        selected,
        decision,
        assessmentShifts,
        employmentWorkPatternAt(period.profile, workPatternSettings, period.from),
        ruleResolver,
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
  return cachedMonthlyPay(
    { month, shifts, profile, decision, assessmentShifts, workPatternSettings, ruleResolver },
    () =>
      calculateMonthlyPayEstimateUncached(
        month,
        shifts,
        profile,
        decision,
        assessmentShifts,
        workPatternSettings,
        ruleResolver,
      ),
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
    );
  if (profile.tvUkNursingTariff)
    return calculateTvUkNursingProfileMonth(month, shifts, profile, assessmentShifts, ruleResolver);
  if (profile.tvlKrTariff)
    return calculateTvlKrProfileMonth(
      month,
      shifts,
      profile,
      decision,
      assessmentShifts,
      workPatternSettings,
      ruleResolver,
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
    );
  if (profile.tariff === null && profile.manualMonthlyGrossCents != null) {
    return createManualMonthlyPayEstimate(month, profile.manualMonthlyGrossCents);
  }

  const monthShifts = shifts.filter(
    (shift) => shift.deletedAt === null && shift.date.startsWith(`${month}-`) && isWorkShift(shift),
  );
  const first = Temporal.PlainDate.from(`${month}-01`);
  const dateKey = first.toString();
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
