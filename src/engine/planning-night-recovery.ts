import { Temporal } from "@js-temporal/polyfill";
import type { ComplianceIssue, ShiftEntry } from "@/domain/types";
import {
  PLANNING_NIGHT_POLICY as policy,
  planningNightExplanation,
  type PlanningNightSequence,
} from "@/domain/planning-night-policy";
import type { ComplianceInterval } from "./compliance-sequences";
import { createComplianceIssue } from "./compliance-issue";

const WORK_TYPES = new Set(["EARLY", "LATE", "NIGHT", "DAY", "TRAINING", "CUSTOM"]);
const minute = (value: Temporal.ZonedDateTime) => Number(value.epochMilliseconds) / 60_000;

interface Night {
  readonly date: string;
  readonly work: ComplianceInterval[];
}

interface PlanningOptions {
  readonly allEmploymentWorkRecorded?: boolean | null;
  readonly coverageStart: string;
  readonly coverageEnd: string;
}

function window(date: string, timeZone: string) {
  const day = Temporal.PlainDate.from(date);
  return {
    start: minute(day.toZonedDateTime({ timeZone, plainTime: policy.nightStart })),
    end: minute(day.add({ days: 1 }).toZonedDateTime({ timeZone, plainTime: policy.nightEnd })),
  };
}

function mergedMinutes(ranges: readonly { start: number; end: number }[]) {
  let through = -Infinity;
  let total = 0;
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    total += Math.max(0, range.end - Math.max(range.start, through));
    through = Math.max(through, range.end);
  }
  return total;
}

function deduplicate(intervals: readonly ComplianceInterval[]) {
  const work = new Map<string, ComplianceInterval>();
  for (const item of intervals) {
    const key = `${minute(item.start)}:${minute(item.end)}`;
    const previous = work.get(key);
    // Conflicting duplicates cannot increase the proven amount of night work.
    if (!previous || item.netMinutes < previous.netMinutes) work.set(key, item);
  }
  return [...work.values()].sort((a, b) => minute(a.start) - minute(b.start));
}

function hasUnambiguousClocks(item: ComplianceInterval): boolean {
  try {
    for (const [clock, zoned] of [
      [item.shift.startTime, item.start],
      [item.shift.endTime, item.end],
    ] as const) {
      if (!clock) return false;
      const recorded = Temporal.PlainTime.from(clock);
      if (recorded.hour !== zoned.hour || recorded.minute !== zoned.minute) return false;
      zoned.toPlainDateTime().toZonedDateTime(zoned.timeZoneId, { disambiguation: "reject" });
    }
    return true;
  } catch {
    // Legal checks retain their existing conservative interpretation. Guidance
    // must not present a guessed instant as a measured recovery duration.
    return false;
  }
}

function* nightEvidence(
  intervals: readonly ComplianceInterval[],
  getWindow: (date: string) => ReturnType<typeof window>,
  ambiguous: Set<ComplianceInterval>,
) {
  const byDate = new Map<string, Night>();
  const uncertain = new Set<string>();
  let prepared = 0;
  for (const item of intervals) {
    const clocksKnown = hasUnambiguousClocks(item);
    if (!clocksKnown) ambiguous.add(item);
    let day = item.start.toPlainDate().subtract({ days: 1 });
    const last = item.end.toPlainDate();
    while (Temporal.PlainDate.compare(day, last) <= 0) {
      const date = day.toString();
      const bounds = getWindow(date);
      if (minute(item.start) < bounds.end && minute(item.end) > bounds.start) {
        const night = byDate.get(date) ?? { date, work: [] };
        if (clocksKnown) night.work.push(item);
        else uncertain.add(date);
        byDate.set(date, night);
      }
      day = day.add({ days: 1 });
    }
    if (++prepared % 4 === 0) yield 1;
  }
  const qualified = new Map<string, Night>();
  for (const night of byDate.values()) {
    const bounds = getWindow(night.date);
    const overlap = mergedMinutes(
      night.work.map((item) => ({
        start: Math.max(bounds.start, minute(item.start)),
        end: Math.min(bounds.end, minute(item.end)),
      })),
    );
    const breaks = night.work.reduce(
      (sum, item) => sum + Math.max(0, item.grossMinutes - item.netMinutes),
      0,
    );
    const minimum = Math.max(0, overlap - breaks);
    const maximum = Math.min(
      overlap,
      night.work.reduce((sum, item) => sum + item.netMinutes, 0),
    );
    if (minimum > policy.nightThresholdMinutes) qualified.set(night.date, night);
    else if (maximum > policy.nightThresholdMinutes) uncertain.add(night.date);
    if (++prepared % 4 === 0) yield 1;
  }
  return { qualified, uncertain };
}

function unresolvedInRange(shifts: readonly ShiftEntry[], from: string, through: string) {
  return shifts.some((shift) => {
    if (shift.deletedAt !== null || !WORK_TYPES.has(shift.type)) return false;
    if (
      shift.specialDuty?.kind !== "ON_CALL" &&
      shift.allDay !== true &&
      shift.startTime &&
      shift.endTime
    )
      return false;
    const until = Temporal.PlainDate.from(shift.date)
      .add({ days: shift.specialDuty?.endDay ?? 1 })
      .toString();
    if (shift.date > through || until < from) return false;
    return (
      shift.specialDuty?.kind === "ON_CALL" ||
      shift.allDay === true ||
      !shift.startTime ||
      !shift.endTime
    );
  });
}

function hasOverlap(intervals: readonly ComplianceInterval[], from: number, through: number) {
  let end = -Infinity;
  for (const item of intervals) {
    if (minute(item.end) <= from || minute(item.start) >= through) continue;
    if (minute(item.start) < end) return true;
    end = Math.max(end, minute(item.end));
  }
  return false;
}

/** One finding per episode. Missing/free calendar cells never establish recovery. */
export function* checkPlanningNightsSteps(
  intervals: readonly ComplianceInterval[],
  originalShifts: readonly ShiftEntry[],
  timeZone: string,
  options: PlanningOptions,
): Generator<number, ComplianceIssue[], void> {
  const work = deduplicate(intervals);
  const windows = new Map<string, ReturnType<typeof window>>();
  const getWindow = (date: string) => {
    const cached = windows.get(date);
    if (cached) return cached;
    const value = window(date, timeZone);
    windows.set(date, value);
    return value;
  };
  const ambiguous = new Set<ComplianceInterval>();
  const { qualified, uncertain } = yield* nightEvidence(work, getWindow, ambiguous);
  const blocks: Night[][] = [];
  let grouped = 0;
  for (const night of [...qualified.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    const previous = blocks.at(-1);
    if (
      previous &&
      Temporal.PlainDate.from(previous.at(-1)!.date).add({ days: 1 }).toString() === night.date
    )
      previous.push(night);
    else blocks.push([night]);
    if (++grouped % 4 === 0) yield 1;
  }
  const issues: ComplianceIssue[] = [];
  for (const block of blocks) {
    yield 1;
    const count = block.length;
    if (count < policy.minimumSeriesForRecovery) continue;
    const first = block[0]!;
    const last = block.at(-1)!;
    const lastWork = [...last.work].sort((a, b) => minute(b.end) - minute(a.end))[0]!;
    const next = work.find((item) => minute(item.start) >= minute(lastWork.end));
    const followingNight = Temporal.PlainDate.from(last.date).add({ days: 1 }).toString();
    const precedingNight = Temporal.PlainDate.from(first.date).subtract({ days: 1 }).toString();
    let recoveryStatus: PlanningNightSequence["recoveryStatus"] = "open";
    let restMinutes: number | null = null;
    const unknown =
      options.allEmploymentWorkRecorded !== true ||
      uncertain.has(followingNight) ||
      [...ambiguous].some(
        (item) =>
          item.start.toPlainDate().toString() <=
            (next?.end.toPlainDate().toString() ?? followingNight) &&
          item.end.toPlainDate().toString() >= last.date,
      ) ||
      followingNight >= options.coverageEnd ||
      unresolvedInRange(
        originalShifts,
        last.date,
        next?.start.toPlainDate().toString() ?? followingNight,
      ) ||
      hasOverlap(work, getWindow(first.date).start, next ? minute(next.end) : minute(lastWork.end));
    if (unknown) recoveryStatus = "unknown";
    else if (next) {
      restMinutes = Math.round(minute(next.start) - minute(lastWork.end));
      recoveryStatus =
        restMinutes < policy.minimumRecoveryMinutes
          ? "under24"
          : restMinutes < policy.preferredRecoveryMinutes
            ? "under48"
            : "atLeast48";
    }
    const sequence: PlanningNightSequence = {
      policyVersion: policy.version,
      firstNight: first.date,
      lastNight: last.date,
      countIsMinimum:
        precedingNight < options.coverageStart ||
        uncertain.has(precedingNight) ||
        unresolvedInRange(originalShifts, precedingNight, first.date),
      recoveryStatus,
      restMinutes,
      lastShiftId: lastWork.shift.id,
      nextShiftId: next?.shift.id ?? null,
    };
    const longSeries = count >= policy.firstNightHint;
    const shortRecovery = recoveryStatus === "under24" || recoveryStatus === "under48";
    if (!longSeries && !shortRecovery) continue;
    const rule = longSeries ? "PLANNING_NIGHT_SERIES" : "PLANNING_NIGHT_RECOVERY";
    const related = [
      ...new Map(
        [
          ...block.flatMap((night) => night.work.map((item) => item.shift)),
          ...(next ? [next.shift] : []),
        ].map((shift) => [shift.id, shift]),
      ).values(),
    ];
    // The fourth-night anchor prevents duplicate cards in adjacent monthly reports.
    const date = longSeries ? block[policy.firstNightHint - 1]!.date : last.date;
    issues.push(
      createComplianceIssue(
        "warning",
        "PLANNING",
        rule,
        longSeries
          ? `${sequence.countIsMinimum ? "Mindestens " : ""}${count} Nächte in Folge mit Nachtarbeit`
          : `Unter ${recoveryStatus === "under24" ? 24 : 48} Stunden arbeitsfreie Zeit nach der Nachtserie`,
        planningNightExplanation(count, sequence),
        related,
        date,
        { rule, count, nightSequence: sequence },
      ),
    );
  }
  return issues;
}
