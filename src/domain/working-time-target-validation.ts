import { Temporal } from "@js-temporal/polyfill";

import { UserFacingError } from "@/domain/errors";
import { isHolidayRegionCompatible } from "@/domain/employment-profile";
import { FEDERAL_STATES } from "@/domain/types";
import type {
  WorkingTimeTargetContext,
  WorkingTimeTargetProfile,
} from "@/domain/working-time-target";

export class WorkingTimeTargetError extends UserFacingError {
  constructor(
    message = "Die Angaben zur Sollarbeitszeit sind unvollständig oder widersprüchlich.",
  ) {
    super(message);
    this.name = "WorkingTimeTargetError";
  }
}

function date(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new WorkingTimeTargetError();
  try {
    if (Temporal.PlainDate.from(value).toString() !== value) throw new WorkingTimeTargetError();
  } catch {
    throw new WorkingTimeTargetError();
  }
}

function minutes(value: number, max = 10080): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new WorkingTimeTargetError();
}

export function validateTargetInputs(
  month: string,
  profile: WorkingTimeTargetProfile,
  context?: WorkingTimeTargetContext,
): void {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new WorkingTimeTargetError();
  try {
    Temporal.PlainYearMonth.from(month);
  } catch {
    throw new WorkingTimeTargetError();
  }
  minutes(profile.weeklyMinutes);
  if (!FEDERAL_STATES.includes(profile.federalState)) throw new WorkingTimeTargetError();
  if (!context) return;
  if (context.employment) {
    date(context.employment.from);
    if (context.employment.to !== null) {
      date(context.employment.to);
      if (context.employment.to < context.employment.from) throw new WorkingTimeTargetError();
    }
  }
  let previousEnd = "";
  for (const period of [...context.periods].sort((a, b) =>
    a.validFrom.localeCompare(b.validFrom),
  )) {
    date(period.validFrom);
    if (period.validTo !== null) date(period.validTo);
    if (
      period.validFrom <= previousEnd ||
      (period.validTo !== null && period.validTo < period.validFrom)
    )
      throw new WorkingTimeTargetError();
    previousEnd = period.validTo ?? "9999-12-31";
    minutes(period.weeklyMinutes);
    if (
      !FEDERAL_STATES.includes(period.federalState) ||
      !isHolidayRegionCompatible(period.federalState, period.holidayRegion)
    )
      throw new WorkingTimeTargetError();
    if (period.model.kind === "FIXED_WEEK") {
      if (period.model.weekdayMinutes.length !== 7) throw new WorkingTimeTargetError();
      for (const value of period.model.weekdayMinutes) minutes(value, 1440);
      if (
        period.model.weekdayMinutes.reduce((sum, value) => sum + value, 0) !== period.weeklyMinutes
      )
        throw new WorkingTimeTargetError();
    } else if (period.model.kind === "ROTATING_FIVE_IN_SEVEN") {
      if (
        period.model.monthlyReference !== "WEEKDAYS_ONE_FIFTH" ||
        ![true, false, null].includes(period.model.sevenDayShiftPlanConfirmed)
      )
        throw new WorkingTimeTargetError();
    } else if (period.model.kind !== "UNKNOWN") throw new WorkingTimeTargetError();
    if (
      period.tariff.kind === "TVOED_K" ||
      period.tariff.kind === "TVOED_B" ||
      period.tariff.kind === "TVL_KR" ||
      period.tariff.kind === "TVH_KR" ||
      period.tariff.kind === "TVUK_NURSING"
    ) {
      if (
        typeof period.tariff.version !== "string" ||
        ![true, false, null].includes(period.tariff.scopeConfirmed)
      )
        throw new WorkingTimeTargetError();
      if (period.tariff.kind === "TVUK_NURSING") {
        if (![true, false, null].includes(period.tariff.accountRuleConfirmed))
          throw new WorkingTimeTargetError();
        if (
          period.tariff.scopeConfirmed === true &&
          period.tariff.accountRuleConfirmed === false &&
          period.model.kind === "ROTATING_FIVE_IN_SEVEN" &&
          period.model.sevenDayShiftPlanConfirmed === true
        )
          throw new WorkingTimeTargetError(
            "TV-UK: Bestätigte Schichtarbeit erfordert die Kontenregel nach § 13 Abs. 1.",
          );
      }
    } else if (period.tariff.kind === "UNVERIFIED") {
      if (!period.tariff.id) throw new WorkingTimeTargetError();
    } else if (period.tariff.kind !== "CUSTOM") throw new WorkingTimeTargetError();
  }
  const dates = new Set<string>();
  for (const day of context.days) {
    date(day.date);
    if (
      dates.has(day.date) ||
      !["FINAL", "DRAFT"].includes(day.rosterStatus) ||
      !["WORK_REQUIRED", "ROSTER_FREE", "RELEASED", "UNKNOWN"].includes(day.disposition)
    )
      throw new WorkingTimeTargetError();
    dates.add(day.date);
    if (day.lostMinutes != null) minutes(day.lostMinutes, 1440);
    if (day.mustWorkElsewhere !== undefined && ![true, false, null].includes(day.mustWorkElsewhere))
      throw new WorkingTimeTargetError();
  }
}
