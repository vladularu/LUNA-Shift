import type { PilotCandidate, PilotObligation, PilotRequest, PilotResult } from "./protocol";

// Same numeric algorithm as the Rust pilot. Validation and shared Temporal
// preparation are measured separately. Not used for normal app calculations.
export function calculateNumeric(request: PilotRequest): PilotResult {
  const days = request.days;
  const firstDay = days[0].day;
  const sunday = (day: number) => (((day + 4) % 7) + 7) % 7 === 0;
  const holidays = new Set(request.holidays);
  const work = new Map<number, string[]>();
  for (const interval of request.intervals) {
    let left = 0;
    let right = days.length;
    while (left < right) {
      const mid = (left + right) >>> 1;
      if (days[mid].endMs <= interval.startMs) left = mid + 1;
      else right = mid;
    }
    for (let index = left; index < days.length && days[index].startMs < interval.endMs; index++) {
      const day = days[index].day;
      const ids = work.get(day) ?? [];
      ids.push(interval.shiftId);
      work.set(day, ids);
    }
  }
  const obligations: PilotObligation[] = [];
  for (const [day, shiftIds] of work) {
    const isSunday = sunday(day);
    if (!isSunday && !holidays.has(day)) continue;
    const reach = (isSunday ? request.sundayPeriodDays : request.holidayPeriodDays) - 1;
    obligations.push({
      kind: isSunday ? "SUNDAY" : "WEEKDAY_HOLIDAY",
      day,
      windowStart: day - reach,
      windowEnd: day + reach,
      shiftIds,
    });
  }
  obligations.sort(
    (a, b) =>
      a.windowEnd - b.windowEnd ||
      a.day - b.day ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
  );
  const possible = new Set<number>();
  for (const item of obligations) {
    const end = Math.min(item.windowEnd, request.coverageEnd);
    for (let day = Math.max(item.windowStart, request.coverageStart); day <= end; day++) {
      if (!sunday(day)) possible.add(day);
    }
  }
  const candidateDates = [...possible].sort((a, b) => a - b);
  const entries = new Map<string, typeof request.shifts>();
  for (const shift of request.shifts) {
    if (shift.deletedAt !== null) continue;
    entries.set(shift.date, [...(entries.get(shift.date) ?? []), shift]);
  }
  const candidates: PilotCandidate[] = [];
  for (const day of candidateDates) {
    if (holidays.has(day) || work.has(day)) continue;
    const boundary = days[day - firstDay];
    const evidence = entries.get(boundary.date) ?? [];
    if (
      evidence.some(
        (entry) =>
          entry.type !== request.evidenceShiftType ||
          entry.startTime !== null ||
          entry.endTime !== null,
      )
    )
      continue;
    let previousEnd: number | null = null;
    let nextStart: number | null = null;
    for (const interval of request.intervals) {
      if (interval.endMs <= boundary.startMs) {
        if (previousEnd === null || interval.endMs > previousEnd) previousEnd = interval.endMs;
        continue;
      }
      if (interval.startMs >= boundary.endMs) {
        nextStart = interval.startMs;
        break;
      }
    }
    candidates.push({
      day,
      evidenceShiftIds: evidence.map((item) => item.id),
      observedRestMinutes:
        previousEnd === null || nextStart === null
          ? null
          : Math.round((nextStart - previousEnd) / 60_000),
    });
  }
  const available = candidates.map(() => true);
  const matched: { obligationIndex: number; candidateIndex: number }[] = [];
  const unmatched: number[] = [];
  const quality = (candidate: PilotCandidate) =>
    candidate.observedRestMinutes === null
      ? 2
      : candidate.observedRestMinutes >= request.requiredRestMinutes
        ? 0
        : 1;
  const qualities = candidates.map(quality);
  obligations.forEach((item, obligationIndex) => {
    let best: number | undefined;
    candidates.forEach((candidate, index) => {
      if (!available[index] || candidate.day < item.windowStart || candidate.day > item.windowEnd)
        return;
      if (
        best === undefined ||
        qualities[index] < qualities[best] ||
        (qualities[index] === qualities[best] &&
          (Math.abs(candidate.day - item.day) < Math.abs(candidates[best].day - item.day) ||
            (Math.abs(candidate.day - item.day) === Math.abs(candidates[best].day - item.day) &&
              candidate.day < candidates[best].day)))
      )
        best = index;
    });
    if (best === undefined) unmatched.push(obligationIndex);
    else {
      available[best] = false;
      matched.push({ obligationIndex, candidateIndex: best });
    }
  });
  return {
    workDates: [...work].sort(([a], [b]) => a - b).map(([day, shiftIds]) => ({ day, shiftIds })),
    obligations,
    candidateDates,
    candidates,
    matched,
    unmatched,
  };
}
