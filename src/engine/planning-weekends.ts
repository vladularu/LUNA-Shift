import { Temporal } from "@js-temporal/polyfill";
import { clockMinute, dutyInstant } from "@/domain/special-duty";
import {
  PLANNING_WEEKEND_POLICY,
  planningWeekendWindowEnds,
  type PlanningWeekendAssessment,
  type PlanningWeekend,
  type PlanningWeekendReason,
  type PlanningWeekendWindow,
} from "@/domain/planning-weekend-policy";
import { employmentProfileAt } from "@/domain/employment-history";
import type { ComplianceIssue, ShiftEntry, UserProfile } from "@/domain/types";

interface DutyInterval {
  readonly start: Temporal.ZonedDateTime;
  readonly end: Temporal.ZonedDateTime;
  readonly breakMinutes: number;
  readonly unresolved?: boolean;
  readonly knownPause?: {
    readonly start: Temporal.ZonedDateTime;
    readonly end: Temporal.ZonedDateTime;
  };
}

type Evidence = { readonly status: "OCCUPIED" | "UNKNOWN"; readonly reason: PlanningWeekendReason };

function uncertainWeekends(
  shift: ShiftEntry,
  reason: PlanningWeekendReason,
): Map<string, Evidence> {
  const result = new Map<string, Evidence>();
  try {
    const from = Temporal.PlainDate.from(shift.date).subtract({ days: shift.specialDuty ? 1 : 0 });
    const until = Temporal.PlainDate.from(shift.date).add({
      days: (shift.specialDuty?.endDay ?? 1) + (shift.specialDuty ? 1 : 0),
    });
    for (let day = from; day.toString() <= until.toString(); day = day.add({ days: 1 }))
      if (day.dayOfWeek >= 6)
        result.set(day.subtract({ days: day.dayOfWeek === 7 ? 1 : 0 }).toString(), {
          status: "UNKNOWN",
          reason,
        });
  } catch {
    /* Invalid dates are rejected at the entry boundary. */
  }
  return result;
}

const dutyEvidence = new WeakMap<
  ShiftEntry,
  Map<string, { readonly signature: string; readonly value: Map<string, Evidence> }>
>();
function weekendEvidence(shift: ShiftEntry, timeZone: string): Map<string, Evidence> {
  let signature: string;
  try {
    signature = JSON.stringify([
      shift.date,
      shift.type,
      shift.allDay,
      shift.startTime,
      shift.endTime,
      shift.breakMinutes,
      shift.deletedAt,
      shift.specialDuty,
    ]);
  } catch {
    return computeWeekendEvidence(shift, timeZone);
  }
  const zones = dutyEvidence.get(shift) ?? new Map();
  const previous = zones.get(timeZone);
  if (previous?.signature === signature) return previous.value;
  const value = computeWeekendEvidence(shift, timeZone);
  zones.delete(timeZone);
  zones.set(timeZone, { signature, value });
  if (zones.size > 4) zones.delete(zones.keys().next().value!);
  dutyEvidence.set(shift, zones);
  return value;
}

/** Scheduled binding is broader than statutory working time; uncertainty is preserved. */
function computeWeekendEvidence(shift: ShiftEntry, timeZone: string): Map<string, Evidence> {
  if (shift.deletedAt !== null || ["FREE", "VACATION", "SICK"].includes(shift.type))
    return new Map();
  if (shift.allDay || !shift.startTime || !shift.endTime)
    return uncertainWeekends(shift, "UNRESOLVED_DUTY");
  try {
    const day = Temporal.PlainDate.from(shift.date);
    // An ordinary duty lasts at most overnight: Monday–Thursday cannot touch a weekend.
    if (!shift.specialDuty && day.dayOfWeek <= 4) return new Map();
    const duty = shift.specialDuty;
    const intervals: readonly DutyInterval[] = duty
      ? [
          {
            start: clockMinute(shift.startTime),
            end: duty.endDay * 1440 + clockMinute(shift.endTime),
            breakMinutes: shift.breakMinutes,
          },
          ...duty.parts,
          // Travel/service can be recorded on either side of a local date boundary.
          ...(duty.kind === "ON_CALL"
            ? duty.callouts.map((call) => ({
                start: call.departure,
                end: call.returned,
                breakMinutes: call.breakMinutes,
              }))
            : []),
        ].map((part, index) => {
          const start = dutyInstant(shift.date, part.start, duty.timeZone).withTimeZone(timeZone);
          const end = dutyInstant(shift.date, part.end, duty.timeZone).withTimeZone(timeZone);
          let knownPause: DutyInterval["knownPause"];
          if (index === 0 && duty.breakStart != null && part.breakMinutes > 0) {
            const pauseStart = dutyInstant(shift.date, duty.breakStart, duty.timeZone).withTimeZone(
              timeZone,
            );
            const pauseEnd = pauseStart.add({ minutes: part.breakMinutes });
            if (
              Temporal.ZonedDateTime.compare(pauseStart, start) >= 0 &&
              Temporal.ZonedDateTime.compare(pauseEnd, end) <= 0
            )
              knownPause = { start: pauseStart, end: pauseEnd };
          }
          return {
            start,
            end,
            breakMinutes: part.breakMinutes,
            unresolved: index === 0 && duty.kind === "ON_CALL" && !duty.calloutsComplete,
            ...(knownPause ? { knownPause } : {}),
          };
        })
      : [
          {
            start: day
              .toPlainDateTime(shift.startTime)
              .toZonedDateTime(timeZone, { disambiguation: "reject" }),
            end: day
              .add({ days: shift.endTime <= shift.startTime ? 1 : 0 })
              .toPlainDateTime(shift.endTime)
              .toZonedDateTime(timeZone, { disambiguation: "reject" }),
            breakMinutes: shift.breakMinutes,
          },
        ];
    const weekends = new Map<string, Evidence>();
    for (const { start, end, breakMinutes, knownPause, unresolved } of intervals) {
      if (Temporal.ZonedDateTime.compare(end, start) <= 0)
        throw new RangeError("Dienstende muss nach dem Dienstbeginn liegen.");
      const first = start.toPlainDate();
      let saturday = first.add({ days: first.dayOfWeek === 7 ? -1 : 6 - first.dayOfWeek });
      const last = end.subtract({ nanoseconds: 1 }).toPlainDate();
      for (
        let n = 0;
        n < 4 && Temporal.PlainDate.compare(saturday, last) <= 0;
        n++, saturday = saturday.add({ days: 7 })
      ) {
        const lower = saturday.toZonedDateTime(timeZone);
        const upper = saturday.add({ days: 2 }).toZonedDateTime(timeZone);
        const overlapStart = Temporal.ZonedDateTime.compare(start, lower) > 0 ? start : lower;
        const overlapEnd = Temporal.ZonedDateTime.compare(end, upper) < 0 ? end : upper;
        const overlapMinutes =
          Number(overlapEnd.epochMilliseconds - overlapStart.epochMilliseconds) / 60000;
        // A known pause only removes its actual intersection. An unlocated pause
        // may still cover a tiny boundary slice entirely.
        let overlappingPauseMinutes = breakMinutes;
        if (knownPause) {
          const pauseStart =
            Temporal.ZonedDateTime.compare(knownPause.start, overlapStart) > 0
              ? knownPause.start
              : overlapStart;
          const pauseEnd =
            Temporal.ZonedDateTime.compare(knownPause.end, overlapEnd) < 0
              ? knownPause.end
              : overlapEnd;
          overlappingPauseMinutes = Math.max(
            0,
            Number(pauseEnd.epochMilliseconds - pauseStart.epochMilliseconds) / 60000,
          );
        }
        if (overlapMinutes <= 0) continue;
        const evidence: Evidence | null =
          overlapMinutes > overlappingPauseMinutes
            ? unresolved
              ? { status: "UNKNOWN", reason: "UNRESOLVED_DUTY" }
              : { status: "OCCUPIED", reason: "WORK_RECORDED" }
            : !knownPause && breakMinutes > 0
              ? { status: "UNKNOWN", reason: "UNRESOLVED_DUTY" }
              : null;
        if (evidence && weekends.get(saturday.toString())?.status !== "OCCUPIED")
          weekends.set(saturday.toString(), evidence);
      }
    }
    return weekends;
  } catch {
    return uncertainWeekends(shift, "INVALID_DUTY");
  }
}

export interface PlanningWeekendOptions {
  readonly allEmploymentWorkRecorded?: boolean | null;
  /** Loaded entry-date horizon: inclusive start, exclusive end. */
  readonly coverageStart?: string;
  readonly coverageEnd?: string;
  readonly employmentProfile?: UserProfile;
}

const counts = (weekends: readonly PlanningWeekend[]) => ({
  freeCount: weekends.filter((weekend) => weekend.status === "FREE").length,
  occupiedCount: weekends.filter((weekend) => weekend.status === "OCCUPIED").length,
  unknownCount: weekends.filter((weekend) => weekend.status === "UNKNOWN").length,
});

/** One monthly observation retains every independently assessed four-week window. */
export function planningWeekendIssues(assessment: PlanningWeekendAssessment): ComplianceIssue[] {
  const affected = assessment.windows.filter(
    (window) =>
      window.assessmentComplete &&
      window.unknownCount === 0 &&
      window.freeCount < PLANNING_WEEKEND_POLICY.minimumFreeWeekends,
  );
  if (!affected.length) return [];
  const latest = affected.at(-1)!;
  return [
    {
      id: "PLANNING_WEEKEND_RECOVERY:" + assessment.month,
      kind: "PLANNING",
      severity: "info",
      rule: "PLANNING_WEEKEND_RECOVERY",
      date: latest.until,
      title: latest.freeCount + " von 4 Wochenenden frei",
      description:
        "Die BAuA empfiehlt mindestens 2 vollständig freie Wochenenden (Samstag und Sonntag) in 4 Wochen.",
      relatedShiftIds: [
        ...new Set(
          affected.flatMap((window) =>
            window.weekends.flatMap((weekend) => weekend.relatedShiftIds),
          ),
        ),
      ].sort(),
      facts: { rule: "PLANNING_WEEKEND_RECOVERY", assessment },
      assessmentRanges: affected.map((window) => ({ from: window.from, through: window.until })),
    },
  ];
}

export function* checkPlanningWeekendsSteps(
  month: string,
  shifts: readonly ShiftEntry[],
  timeZone: string,
  options: PlanningWeekendOptions = {},
): Generator<
  number,
  { readonly assessment: PlanningWeekendAssessment; readonly issues: ComplianceIssue[] },
  void
> {
  const ends = planningWeekendWindowEnds(month);
  let checkpoint = 0;
  yield checkpoint;
  const latest = new Map<string, ShiftEntry>();
  const ambiguous = new Map<string, ShiftEntry[]>();
  const signature = (shift: ShiftEntry) =>
    JSON.stringify([
      shift.date,
      shift.type,
      shift.allDay,
      shift.startTime,
      shift.endTime,
      shift.breakMinutes,
      shift.specialDuty,
    ]);
  for (const shift of shifts) {
    const old = latest.get(shift.id);
    if (
      !old ||
      shift.revision > old.revision ||
      (shift.revision === old.revision &&
        (shift.updatedAt > old.updatedAt ||
          (shift.updatedAt === old.updatedAt && shift.deletedAt !== null)))
    ) {
      latest.set(shift.id, shift);
      ambiguous.delete(shift.id);
    } else if (
      old &&
      old.revision === shift.revision &&
      old.updatedAt === shift.updatedAt &&
      old.deletedAt === null &&
      shift.deletedAt === null &&
      signature(old) !== signature(shift)
    ) {
      ambiguous.set(shift.id, [...(ambiguous.get(shift.id) ?? [old]), shift]);
    }
    if (++checkpoint % 8 === 0) yield checkpoint;
  }
  const contexts = new Map<string, { readonly timeZone: string; readonly complete: boolean }>();
  const context = (date: string) => {
    const cached = contexts.get(date);
    if (cached) return cached;
    const profile = options.employmentProfile
      ? employmentProfileAt(options.employmentProfile, date)
      : null;
    const result = {
      timeZone: profile?.timeZone ?? timeZone,
      complete: profile
        ? profile.allEmploymentWorkRecorded === true
        : options.allEmploymentWorkRecorded === true,
    };
    contexts.set(date, result);
    return result;
  };
  const first = Temporal.PlainDate.from(ends[0]!).subtract({ days: 27 });
  for (let day = first; day.toString() <= ends.at(-1)!; day = day.add({ days: 1 }))
    context(day.toString());
  const evidenceByZone = new Map<
    string,
    Map<
      string,
      { occupied: Set<string>; unknown: Set<string>; reasons: Set<PlanningWeekendReason> }
    >
  >();
  for (const zone of [...new Set([...contexts.values()].map((value) => value.timeZone))].sort()) {
    const evidence = new Map<
      string,
      { occupied: Set<string>; unknown: Set<string>; reasons: Set<PlanningWeekendReason> }
    >();
    for (const shift of latest.values()) {
      const alternatives = ambiguous.get(shift.id);
      const evidenceForShift = alternatives
        ? new Map(alternatives.flatMap((item) => [...uncertainWeekends(item, "INVALID_DUTY")]))
        : weekendEvidence(shift, zone);
      for (const [saturday, item] of evidenceForShift) {
        const value = evidence.get(saturday) ?? {
          occupied: new Set<string>(),
          unknown: new Set<string>(),
          reasons: new Set<PlanningWeekendReason>(),
        };
        (item.status === "OCCUPIED" ? value.occupied : value.unknown).add(shift.id);
        value.reasons.add(item.reason);
        evidence.set(saturday, value);
      }
      if (++checkpoint % 4 === 0) yield checkpoint;
    }
    evidenceByZone.set(zone, evidence);
  }
  const weekends = new Map<string, PlanningWeekend>();
  const weekend = (sunday: string): PlanningWeekend => {
    const cached = weekends.get(sunday);
    if (cached) return cached;
    const saturday = Temporal.PlainDate.from(sunday).subtract({ days: 1 }).toString();
    const monday = Temporal.PlainDate.from(sunday).add({ days: 1 }).toString();
    const a = context(saturday),
      b = context(sunday);
    // Coverage describes loaded entry dates, not elapsed duty time. A saved
    // special duty may begin up to fourteen local dates before its end. The
    // extreme supported civil offsets also allow an adjacent stored date to
    // overlap this weekend (including Monday entries spilling back to Sunday).
    const sourceFrom = Temporal.PlainDate.from(saturday)
      .toZonedDateTime(a.timeZone)
      .withTimeZone("-12:00")
      .toPlainDate()
      .subtract({ days: 14 })
      .toString();
    const sourceUntil = Temporal.PlainDate.from(monday)
      .toZonedDateTime(a.timeZone)
      .subtract({ nanoseconds: 1 })
      .withTimeZone("+14:00")
      .toPlainDate()
      .add({ days: 1 })
      .toString();
    const value = evidenceByZone.get(a.timeZone)?.get(saturday);
    const reasons = new Set<PlanningWeekendReason>(value?.reasons);
    if (!a.complete || !b.complete) reasons.add("WORK_NOT_CONFIRMED_COMPLETE");
    if (a.timeZone !== b.timeZone || a.complete !== b.complete)
      reasons.add("EMPLOYMENT_CONTEXT_CHANGED");
    if (
      !options.coverageStart ||
      !options.coverageEnd ||
      sourceFrom < options.coverageStart ||
      sourceUntil > options.coverageEnd
    )
      reasons.add("OUTSIDE_COVERAGE");
    const occupied = (value?.occupied.size ?? 0) > 0;
    const ids = [...new Set([...(value?.occupied ?? []), ...(value?.unknown ?? [])])].sort();
    const result: PlanningWeekend = {
      saturday,
      sunday,
      status: occupied ? "OCCUPIED" : reasons.size ? "UNKNOWN" : "FREE",
      relatedShiftIds: ids,
      reasons: [...reasons].sort(),
    };
    weekends.set(sunday, result);
    return result;
  };
  const windows: PlanningWeekendWindow[] = ends.map((until) => {
    const end = Temporal.PlainDate.from(until);
    const from = end.subtract({ days: 27 }).toString();
    const items = Array.from({ length: 4 }, (_, index) =>
      weekend(end.subtract({ days: (3 - index) * 7 }).toString()),
    );
    const signatures = new Set<string>();
    let confirmed = true;
    for (
      let day = Temporal.PlainDate.from(from);
      day.toString() <= until;
      day = day.add({ days: 1 })
    ) {
      const value = context(day.toString());
      signatures.add(value.timeZone + "|" + value.complete);
      if (!value.complete) confirmed = false;
    }
    return {
      from,
      until,
      weekends: items,
      ...counts(items),
      assessmentComplete:
        confirmed &&
        signatures.size === 1 &&
        !!options.coverageStart &&
        !!options.coverageEnd &&
        from >= options.coverageStart &&
        end.add({ days: 1 }).toString() <= options.coverageEnd &&
        items.every(
          (item) => item.status !== "UNKNOWN" && !item.reasons.includes("OUTSIDE_COVERAGE"),
        ),
    };
  });
  const items = ends.map(weekend);
  const assessment: PlanningWeekendAssessment = {
    policyVersion: PLANNING_WEEKEND_POLICY.version,
    month,
    weekends: items,
    totalCount: items.length,
    ...counts(items),
    windows,
  };
  return { assessment, issues: planningWeekendIssues(assessment) };
}
