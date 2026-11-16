import { calendarDate, isSundayDay } from "@/engine/compliance-rest-calendar";
import { indexRestIntervals } from "@/engine/compliance-rest-intervals";
import type { ComplianceCalendarContext } from "@/engine/compliance-preparation";
import type {
  HolidayCoverage,
  ObligationMatch,
  PreparedRestKernel,
  ReplacementCandidate,
  RestObligation,
} from "@/engine/compliance-rest-kernel";
import type { ComplianceInterval } from "@/engine/compliance-sequences";
import type { PilotRequest } from "../../../modules/luna-rest-pilot/protocol";

const invalid = () => new Error("Invalid native annual rest result");
export function restRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
export function restArray(value: unknown, maximum = 20_000): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw invalid();
  return value;
}
export function restNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw invalid();
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw invalid();
  return value;
}
function reference<T>(items: readonly T[], value: unknown): T {
  const index = integer(value);
  if (index < 0 || index >= items.length) throw invalid();
  return items[index];
}

/** Check the native boundary before mapping IDs onto the current immutable snapshot. */
export function readRestFacts(
  value: unknown,
  request: PilotRequest,
  context: ComplianceCalendarContext,
  holidayCoverage: HolidayCoverage,
): PreparedRestKernel {
  const raw = restRecord(value);
  const daySet = new Set(request.days.map((d) => d.day));
  const toDate = (value: unknown, covered = false) => {
    const day = integer(value);
    if (covered && !daySet.has(day)) throw invalid();
    if (day < request.days[0].day - 366 || day > request.days.at(-1)!.day + 366) throw invalid();
    return calendarDate(day);
  };
  const shifts = new Map(context.calculationShifts.map((shift) => [shift.id, shift]));
  const intervals = new Map(context.intervals.map((interval) => [interval.shift.id, interval]));
  const ids = <T>(values: unknown, pool: ReadonlyMap<string, T>) =>
    restArray(values, 5000).map((id) => {
      if (typeof id !== "string" || !pool.has(id)) throw invalid();
      return pool.get(id)!;
    });
  const workDates = new Map<string, readonly ComplianceInterval[]>();
  for (const item of restArray(raw.workDates, request.days.length)) {
    const work = restRecord(item),
      date = toDate(work.day, true).value;
    const related = ids(work.shiftIds, intervals);
    if (workDates.has(date) || related.length === 0) throw invalid();
    workDates.set(date, related);
  }
  const obligations: RestObligation[] = restArray(raw.obligations, workDates.size).map((value) => {
    const item = restRecord(value),
      day = integer(item.day),
      date = toDate(day, true);
    const kind = item.kind;
    if (kind !== "SUNDAY" && kind !== "WEEKDAY_HOLIDAY") throw invalid();
    const reach = (kind === "SUNDAY" ? request.sundayPeriodDays : request.holidayPeriodDays) - 1;
    if (
      !workDates.has(date.value) ||
      (kind === "SUNDAY") !== isSundayDay(day) ||
      (kind === "WEEKDAY_HOLIDAY" && !holidayCoverage.dates.has(date.value)) ||
      item.windowStart !== day - reach ||
      item.windowEnd !== day + reach
    )
      throw invalid();
    return {
      kind,
      date: date.date,
      windowStart: toDate(item.windowStart).date,
      windowEnd: toDate(item.windowEnd).date,
      related: ids(item.shiftIds, shifts),
    };
  });
  const candidateDates = new Set<number>();
  for (const value of restArray(raw.candidateDates, request.days.length)) {
    const day = integer(value);
    if (
      day < request.coverageStart ||
      day > request.coverageEnd ||
      isSundayDay(day) ||
      candidateDates.has(day)
    )
      throw invalid();
    candidateDates.add(day);
  }
  const usedDates = new Set<number>();
  const candidates: ReplacementCandidate[] = restArray(raw.candidates, candidateDates.size).map(
    (value) => {
      const item = restRecord(value),
        day = integer(item.day),
        date = toDate(day, true);
      if (
        !candidateDates.has(day) ||
        usedDates.has(day) ||
        workDates.has(date.value) ||
        holidayCoverage.dates.has(date.value)
      )
        throw invalid();
      usedDates.add(day);
      const evidence = ids(item.evidenceShiftIds, shifts);
      if (
        evidence.some(
          (s) => s.type !== request.evidenceShiftType || s.startTime !== null || s.endTime !== null,
        )
      )
        throw invalid();
      const observed = item.observedRestMinutes === null ? null : integer(item.observedRestMinutes);
      if (observed !== null && observed < 0) throw invalid();
      return { date: date.date, evidence, observedRestMinutes: observed };
    },
  );
  const usedObligations = new Set<number>(),
    usedCandidates = new Set<number>();
  const matched: ObligationMatch[] = restArray(raw.matched, obligations.length).map((value) => {
    const item = restRecord(value),
      obligation = reference(obligations, item.obligationIndex),
      candidate = reference(candidates, item.candidateIndex);
    const oi = integer(item.obligationIndex),
      ci = integer(item.candidateIndex);
    if (
      usedObligations.has(oi) ||
      usedCandidates.has(ci) ||
      candidate.date.toString() < obligation.windowStart.toString() ||
      candidate.date.toString() > obligation.windowEnd.toString()
    )
      throw invalid();
    usedObligations.add(oi);
    usedCandidates.add(ci);
    return { obligation, candidate };
  });
  const unmatched = restArray(raw.unmatched, obligations.length).map((value) => {
    const index = integer(value),
      obligation = reference(obligations, index);
    if (usedObligations.has(index)) throw invalid();
    usedObligations.add(index);
    return obligation;
  });
  if (usedObligations.size !== obligations.length) throw invalid();
  return {
    workDates,
    holidayCoverage,
    obligations,
    matches: { matched, unmatched },
    restIntervals: indexRestIntervals(
      context.intervals.map((i) => ({
        start: i.start.epochMilliseconds,
        end: i.end.epochMilliseconds,
      })),
    ),
  };
}
