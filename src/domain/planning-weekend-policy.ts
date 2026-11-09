import { Temporal } from "@js-temporal/polyfill";

/** A source-specific planning criterion, never a statutory or tariff limit. */
export const PLANNING_WEEKEND_POLICY = {
  version: "2026-11-09-four-weeks",
  windowWeeks: 4,
  minimumFreeWeekends: 2,
  /** Only for decoding historical observations; no longer emitted. */
  firstOccupiedWeekendHint: 3,
  source: {
    title: "BAuA: Handbuch zur Gefährdungsbeurteilung Arbeitszeit",
    url: "https://www.baua.de/DE/Themen/Arbeitsgestaltung/Arbeitszeit/pdf/handbuch-gfb.pdf?__blob=publicationFile&v=1",
    context:
      "Frage 42, Seite 33; Stand März 2016: mindestens zwei vollständig freie Wochenenden (Samstag und Sonntag) in vier Wochen.",
  },
} as const;

export type PlanningWeekendStatus = "FREE" | "OCCUPIED" | "UNKNOWN";
export type PlanningWeekendReason =
  | "WORK_RECORDED"
  | "WORK_NOT_CONFIRMED_COMPLETE"
  | "OUTSIDE_COVERAGE"
  | "UNRESOLVED_DUTY"
  | "INVALID_DUTY"
  | "EMPLOYMENT_CONTEXT_CHANGED";

export interface PlanningWeekend {
  readonly saturday: string;
  readonly sunday: string;
  readonly status: PlanningWeekendStatus;
  readonly relatedShiftIds: readonly string[];
  readonly reasons: readonly PlanningWeekendReason[];
}

export interface PlanningWeekendWindow {
  /** Required even if recorded duty already proves all four weekends occupied. */
  readonly assessmentComplete: boolean;
  /** Inclusive Monday and Sunday, spanning exactly four complete calendar weeks. */
  readonly from: string;
  readonly until: string;
  readonly weekends: readonly PlanningWeekend[];
  readonly freeCount: number;
  readonly occupiedCount: number;
  readonly unknownCount: number;
}

export interface PlanningWeekendAssessment {
  readonly policyVersion: string;
  readonly month: string;
  /** The Sunday determines the reporting month, including boundary weekends. */
  readonly weekends: readonly PlanningWeekend[];
  readonly totalCount: number;
  readonly freeCount: number;
  readonly occupiedCount: number;
  readonly unknownCount: number;
  /** One four-week window ending on each Sunday of this month. */
  readonly windows: readonly PlanningWeekendWindow[];
}

export function planningWeekendWindowEnds(month: string): readonly string[] {
  const first = Temporal.PlainDate.from(month + "-01");
  const result: string[] = [];
  for (
    let sunday = first.add({ days: (7 - first.dayOfWeek) % 7 });
    sunday.month === first.month;
    sunday = sunday.add({ days: 7 })
  )
    result.push(sunday.toString());
  return result;
}

/** Also load the maximum allowed 14-day special duty carried into the first window. */
export function planningWeekendCoverageStart(month: string): string {
  return Temporal.PlainDate.from(planningWeekendWindowEnds(month)[0]!)
    .subtract({ days: 27 + 14 })
    .toString();
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const date = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return Temporal.PlainDate.from(value).toString() === value;
  } catch {
    return false;
  }
};
const reasons: readonly PlanningWeekendReason[] = [
  "WORK_RECORDED",
  "WORK_NOT_CONFIRMED_COMPLETE",
  "OUTSIDE_COVERAGE",
  "UNRESOLVED_DUTY",
  "INVALID_DUTY",
  "EMPLOYMENT_CONTEXT_CHANGED",
];

function validWeekend(value: unknown): value is PlanningWeekend {
  if (!record(value) || !date(value.saturday) || !date(value.sunday)) return false;
  const saturday = Temporal.PlainDate.from(value.saturday);
  if (saturday.dayOfWeek !== 6 || saturday.add({ days: 1 }).toString() !== value.sunday)
    return false;
  if (
    !Array.isArray(value.relatedShiftIds) ||
    !value.relatedShiftIds.every((id) => typeof id === "string" && id.length > 0) ||
    new Set(value.relatedShiftIds).size !== value.relatedShiftIds.length
  )
    return false;
  if (
    !Array.isArray(value.reasons) ||
    !value.reasons.every((reason) => reasons.includes(reason)) ||
    new Set(value.reasons).size !== value.reasons.length
  )
    return false;
  return value.status === "FREE"
    ? value.relatedShiftIds.length === 0 && value.reasons.length === 0
    : value.status === "OCCUPIED"
      ? value.relatedShiftIds.length > 0 && value.reasons.includes("WORK_RECORDED")
      : value.status === "UNKNOWN" && value.reasons.length > 0;
}

function validCounts(
  value: Record<string, unknown>,
  weekends: readonly PlanningWeekend[],
): boolean {
  return (
    value.freeCount === weekends.filter((weekend) => weekend.status === "FREE").length &&
    value.occupiedCount === weekends.filter((weekend) => weekend.status === "OCCUPIED").length &&
    value.unknownCount === weekends.filter((weekend) => weekend.status === "UNKNOWN").length
  );
}

/** Shared runtime boundary for cached results and per-finding facts. */
export function validPlanningWeekendAssessment(value: unknown): value is PlanningWeekendAssessment {
  if (
    !record(value) ||
    value.policyVersion !== PLANNING_WEEKEND_POLICY.version ||
    typeof value.month !== "string" ||
    !/^\d{4}-\d{2}$/.test(value.month)
  )
    return false;
  try {
    const ends = planningWeekendWindowEnds(value.month);
    if (
      !Array.isArray(value.weekends) ||
      value.weekends.length !== ends.length ||
      !value.weekends.every(validWeekend) ||
      value.totalCount !== ends.length ||
      !validCounts(value, value.weekends)
    )
      return false;
    if (value.weekends.some((weekend, index) => weekend.sunday !== ends[index])) return false;
    if (!Array.isArray(value.windows) || value.windows.length !== ends.length) return false;
    const known = new Map<string, string>();
    const consistent = (weekend: PlanningWeekend) => {
      const key = JSON.stringify([
        weekend.saturday,
        weekend.sunday,
        weekend.status,
        weekend.relatedShiftIds,
        weekend.reasons,
      ]);
      const previous = known.get(weekend.saturday);
      known.set(weekend.saturday, key);
      return previous === undefined || previous === key;
    };
    if (!value.weekends.every(consistent)) return false;
    return value.windows.every((window, index) => {
      if (
        !record(window) ||
        typeof window.assessmentComplete !== "boolean" ||
        window.until !== ends[index] ||
        window.from !== Temporal.PlainDate.from(ends[index]!).subtract({ days: 27 }).toString() ||
        !Array.isArray(window.weekends) ||
        window.weekends.length !== 4 ||
        !window.weekends.every(validWeekend) ||
        !validCounts(window, window.weekends) ||
        (window.assessmentComplete &&
          (window.unknownCount !== 0 ||
            window.weekends.some((weekend) =>
              weekend.reasons.some((reason) =>
                [
                  "WORK_NOT_CONFIRMED_COMPLETE",
                  "OUTSIDE_COVERAGE",
                  "EMPLOYMENT_CONTEXT_CHANGED",
                ].includes(reason),
              ),
            )))
      )
        return false;
      return window.weekends.every(
        (weekend, week) =>
          weekend.sunday ===
            Temporal.PlainDate.from(ends[index]!)
              .subtract({ days: (3 - week) * 7 })
              .toString() && consistent(weekend),
      );
    });
  } catch {
    return false;
  }
}

/** Historical metadata; the old three-weekend trigger is retired. */
export interface PlanningWeekendSequence {
  readonly policyVersion: string;
  readonly firstSaturday: string;
  readonly lastSunday: string;
}
