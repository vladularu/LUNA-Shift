import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEntry, ShiftEntry, UserProfile } from "./types";
import { employmentProfileAt } from "./employment-history";
import { UserFacingError } from "./errors";

export function isTariffAbsence(entry: CalendarEntry, profile: UserProfile) {
  if (
    entry.kind !== "SHIFT" ||
    entry.deletedAt != null ||
    (entry.type !== "VACATION" && entry.type !== "SICK")
  )
    return false;
  return absencePayTariffAt(profile, entry.date) !== null;
}

export function hasTariffAbsenceInMonth(
  month: string,
  entries: readonly CalendarEntry[],
  profile: UserProfile,
) {
  return entries.some((entry) => entry.date.startsWith(month) && isTariffAbsence(entry, profile));
}

/** Salary preparation includes the annual proposal and variable pay from the prior two months. */
export function hasTariffAbsenceInPayrollYear(
  year: number,
  entries: readonly CalendarEntry[],
  profile: UserProfile,
) {
  const from = String(year - 1) + "-11-01",
    through = String(year) + "-12-31";
  return entries.some((e) => e.date >= from && e.date <= through && isTariffAbsence(e, profile));
}

export function absencePayTariffAt(profile: UserProfile, date: string) {
  const dated = employmentProfileAt(profile, date);
  if (dated.salaryBasisConflict || dated.manualMonthlyGrossCents != null) return null;
  const families = [
    dated.tariff && "VKA",
    dated.vkaETariff && "VKA",
    dated.tvlKrTariff && "TVL",
    dated.tvhKrTariff && "TVH",
    dated.tvUkNursingTariff && "TVUK",
    dated.nursingTrainingTariff && "TVAOED",
    dated.tvalPflegeTariff && "TVAL",
  ] as const;
  const selected = families.filter((family) => family != null);
  return selected.length === 1 ? selected[0] : null;
}
export function plannedAbsence(
  prior: ShiftEntry | null,
  oldType: string,
  nextType: string,
  timed: boolean,
): AbsencePayFacts | null {
  if (
    !prior ||
    prior.type !== oldType ||
    !timed ||
    prior.allDay ||
    prior.specialDuty ||
    prior.type === "TRAINING" ||
    !prior.startTime ||
    !prior.endTime ||
    (nextType !== "SICK" && nextType !== "VACATION")
  )
    return null;
  return {
    ...EMPTY_ABSENCE_PAY,
    day: "PAID",
    plannedShift: {
      type: prior.type,
      startTime: prior.startTime,
      endTime: prior.endTime,
      breakMinutes: prior.breakMinutes,
    },
  };
}
export interface AbsencePayFacts {
  readonly day: "AUTO" | "PAID" | "FREE" | "UNPAID" | "EXCUSED_UNPAID";
  readonly dailyRateCents: number | null;
  readonly workdaysPerWeek: number | null;
  readonly referenceCents?: number | null;
  readonly referenceDays?: number | null;
  readonly plannedShift?: {
    readonly type: string;
    readonly startTime: string;
    readonly endTime: string;
    readonly breakMinutes: number;
  } | null;
  readonly historyComplete: boolean;
  /** First day of this continuous absence, including intervening roster days off. */
  readonly eventStart: string | null;
}

export const EMPTY_ABSENCE_PAY: AbsencePayFacts = {
  day: "AUTO",
  dailyRateCents: null,
  workdaysPerWeek: null,
  historyComplete: false,
  eventStart: null,
};

export function validateAbsencePay(
  value: unknown,
  type: string,
  date: string,
): AbsencePayFacts | null {
  if (value == null) return null;
  const fail = () => {
    throw new UserFacingError("Bitte die Angaben zum Abwesenheitsaufschlag prüfen.");
  };
  if ((type !== "VACATION" && type !== "SICK") || typeof value !== "object" || Array.isArray(value))
    return fail();
  const item = value as Record<string, unknown>;
  const optional = ["referenceCents", "referenceDays", "plannedShift"];
  if (
    Object.keys(item).some((k) => !Object.hasOwn(EMPTY_ABSENCE_PAY, k) && !optional.includes(k)) ||
    !Object.keys(EMPTY_ABSENCE_PAY).every((key) => Object.hasOwn(item, key))
  )
    return fail();
  const { referenceCents, referenceDays, plannedShift } = item;
  if (
    referenceCents != null &&
    (typeof referenceCents !== "number" ||
      !Number.isSafeInteger(referenceCents) ||
      referenceCents < 0 ||
      referenceCents > 100000000)
  )
    return fail();
  if (
    referenceDays != null &&
    (typeof referenceDays !== "number" ||
      referenceDays < 1 ||
      referenceDays > 93 ||
      !Number.isFinite(referenceDays))
  )
    return fail();
  if (plannedShift != null) {
    if (typeof plannedShift !== "object" || Array.isArray(plannedShift)) return fail();
    const p = plannedShift as Record<string, unknown>;
    if (
      Object.keys(p).length !== 4 ||
      !["EARLY", "LATE", "NIGHT", "DAY", "CUSTOM"].includes(String(p.type)) ||
      ![p.startTime, p.endTime].every(
        (t) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t),
      ) ||
      p.startTime === p.endTime ||
      typeof p.breakMinutes !== "number" ||
      !Number.isInteger(p.breakMinutes) ||
      p.breakMinutes < 0 ||
      p.breakMinutes > 1440
    )
      return fail();
  }
  const { day, dailyRateCents, workdaysPerWeek, historyComplete, eventStart } = item;
  if (
    !["AUTO", "PAID", "FREE", "UNPAID", "EXCUSED_UNPAID"].includes(day as string) ||
    typeof historyComplete !== "boolean"
  )
    return fail();
  if (
    dailyRateCents !== null &&
    (typeof dailyRateCents !== "number" ||
      !Number.isSafeInteger(dailyRateCents) ||
      dailyRateCents < 0 ||
      dailyRateCents > 1000000)
  )
    return fail();
  if (
    workdaysPerWeek !== null &&
    (typeof workdaysPerWeek !== "number" ||
      !Number.isFinite(workdaysPerWeek) ||
      workdaysPerWeek < 0.1 ||
      workdaysPerWeek > 7)
  )
    return fail();
  if (eventStart !== null) {
    if (typeof eventStart !== "string" || eventStart.length !== 10 || eventStart > date)
      return fail();
    try {
      if (Temporal.PlainDate.from(eventStart).toString() !== eventStart) return fail();
    } catch {
      return fail();
    }
  }
  return {
    ...(referenceCents == null ? {} : { referenceCents }),
    ...(referenceDays == null ? {} : { referenceDays }),
    ...(plannedShift == null
      ? {}
      : { plannedShift: plannedShift as AbsencePayFacts["plannedShift"] }),
    day: day as AbsencePayFacts["day"],
    dailyRateCents,
    workdaysPerWeek,
    historyComplete,
    eventStart,
  };
}
