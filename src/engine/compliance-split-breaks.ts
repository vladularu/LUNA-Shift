import { Temporal } from "@js-temporal/polyfill";

import { clockMinute, dutyInstant } from "@/domain/special-duty";
import type { ShiftEntry } from "@/domain/types";
import type { ComplianceInterval } from "./compliance-sequences";

export type SplitDutyBreakCheck = (
  before: ComplianceInterval,
  after: ComplianceInterval,
) => boolean;

export function workGroupsByRecordedDate(
  intervals: readonly ComplianceInterval[],
): ComplianceInterval[][] {
  const groups = new Map<string, ComplianceInterval[]>();
  for (const item of intervals) {
    const entries = groups.get(item.shift.date) ?? [];
    entries.push(item);
    groups.set(item.shift.date, entries);
  }
  return [...groups.values()];
}

export function interruptionMinutes(
  items: readonly ComplianceInterval[],
  minimumSegmentMinutes: number,
  isPlannedSplitBreak: SplitDutyBreakCheck,
  allIntervals: readonly ComplianceInterval[],
): { planned: number; unconfirmed: number } {
  let planned = 0;
  let unconfirmed = 0;
  let latest = items[0];
  for (const item of items.slice(1)) {
    if (!latest) break;
    const gap = Math.round(
      Number(item.start.epochMilliseconds - latest.end.epochMilliseconds) / 60_000,
    );
    if (
      gap >= minimumSegmentMinutes &&
      !allIntervals.some(
        (other) =>
          other.start.epochMilliseconds < item.start.epochMilliseconds &&
          other.end.epochMilliseconds > latest.end.epochMilliseconds,
      )
    ) {
      if (isPlannedSplitBreak(latest, item)) planned += gap;
      else unconfirmed += gap;
    }
    if (Temporal.ZonedDateTime.compare(item.end, latest.end) > 0) latest = item;
  }
  return { planned, unconfirmed };
}

/** Keep original duty provenance local to compliance; projections also serve pay and sharing. */
export function createSplitDutyBreakCheck(shifts: readonly ShiftEntry[]): SplitDutyBreakCheck {
  const splitIds = new Set(
    shifts
      .filter((shift) => shift.deletedAt === null && shift.specialDuty?.kind === "SPLIT")
      .map((shift) => shift.id),
  );
  if (splitIds.size === 0) return () => false;

  // Even without callouts, an on-call obligation does not establish a freely available pause.
  const onCallPeriods = shifts.flatMap((shift) => {
    const duty = shift.specialDuty;
    if (shift.deletedAt !== null || duty?.kind !== "ON_CALL" || !shift.startTime || !shift.endTime)
      return [];
    return [
      {
        start: dutyInstant(shift.date, clockMinute(shift.startTime), duty.timeZone),
        end: dutyInstant(
          shift.date,
          duty.endDay * 1440 + clockMinute(shift.endTime),
          duty.timeZone,
        ),
      },
    ];
  });

  return (before, after) =>
    before.shift.id === after.shift.id &&
    splitIds.has(before.shift.id) &&
    !onCallPeriods.some(
      (period) =>
        Temporal.ZonedDateTime.compare(period.start, after.start) < 0 &&
        Temporal.ZonedDateTime.compare(period.end, before.end) > 0,
    );
}
