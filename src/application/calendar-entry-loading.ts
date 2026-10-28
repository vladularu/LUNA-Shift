import type { CalendarEntryRange } from "@/application/pflegeshift-snapshot";
import type { CalendarEntry } from "@/domain/types";
import { createMonthGrid } from "@/engine/calendar";
import { sortCalendarEntries } from "@/engine/calendar-entry-order";

/** Three completed windows; a loaded current-year window survives distant navigation. */
export function retainCalendarRanges(
  known: readonly CalendarEntryRange[],
  range: CalendarEntryRange,
  currentYear: number,
) {
  const next = [
    ...known.filter((item) => item.startDate !== range.startDate || item.endDate !== range.endDate),
    range,
  ];
  while (next.length > 3) {
    const oldest = next.findIndex(
      (item) =>
        !(
          item.startDate <= `${currentYear - 1}-01-01` && item.endDate >= `${currentYear + 1}-12-31`
        ),
    );
    next.splice(oldest < 0 ? 0 : oldest, 1);
  }
  return next;
}

export function calendarRangeCoversMonth(range: CalendarEntryRange | null, month: string): boolean {
  if (range === null) return false;
  const grid = createMonthGrid(month);
  return range.startDate <= grid[0].date && range.endDate >= grid[grid.length - 1].date;
}

export function calendarRangeCoversYear(range: CalendarEntryRange | null, year: number): boolean {
  if (range === null) return false;
  return range.startDate <= `${year}-01-01` && range.endDate >= `${year}-12-31`;
}

// Preserve saves and deletions completed while the range query was in flight.
export function reconcileCalendarRange(
  loaded: readonly CalendarEntry[],
  before: readonly CalendarEntry[],
  current: readonly CalendarEntry[],
  range: CalendarEntryRange,
  deleted: ReadonlySet<string> = new Set(),
  retainedRanges: readonly CalendarEntryRange[] = [],
): readonly CalendarEntry[] {
  const key = (entry: CalendarEntry) => `${entry.kind}:${entry.id}`;
  const baseline = new Map(before.map((entry) => [key(entry), entry]));
  const live = new Map(current.map((entry) => [key(entry), entry]));
  const result = new Map(loaded.map((entry) => [key(entry), entry]));
  // Other completed windows remain live application data, including edits made there.
  for (const entry of current) {
    if (entry.deletedAt !== null || result.has(key(entry))) continue;
    const outside = entry.date < range.startDate || entry.date > range.endDate;
    if (
      outside &&
      retainedRanges.some((keep) => entry.date >= keep.startDate && entry.date <= keep.endDate)
    )
      result.set(key(entry), entry);
  }
  for (const id of deleted) if (!live.has(id)) result.delete(id);
  for (const id of baseline.keys()) if (!live.has(id)) result.delete(id);
  for (const [id, entry] of live) {
    if (baseline.get(id) === entry) continue;
    result.delete(id);
    if (
      entry.deletedAt === null &&
      ((entry.date <= range.endDate && entry.date >= range.startDate) ||
        retainedRanges.some((keep) => entry.date >= keep.startDate && entry.date <= keep.endDate) ||
        (entry.date <= range.endDate && entry.kind === "APPOINTMENT" && entry.recurrence != null))
    )
      result.set(id, entry);
  }
  return sortCalendarEntries([...result.values()]);
}
