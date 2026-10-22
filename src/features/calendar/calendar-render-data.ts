import type { CalendarEntry } from "@/domain/types";
import { addMonths, createMonthGrid } from "@/engine/calendar";

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** Keep unchanged day arrays and month maps stable across a larger index rebuild. */
export function calendarMonthRows<T>(
  previous: ReadonlyMap<string, readonly T[]>,
  rows: ReadonlyMap<string, readonly T[]>,
  month: string,
): ReadonlyMap<string, readonly T[]> {
  const grid = createMonthGrid(month);
  const first = grid[0].date;
  const last = grid.at(-1)!.date;
  const next = new Map<string, readonly T[]>();
  for (const [date, values] of rows) {
    if (date < first || date > last) continue;
    const old = previous.get(date);
    next.set(
      date,
      old &&
        old.length === values.length &&
        old.every((value, index) => sameValue(value, values[index]))
        ? old
        : values,
    );
  }
  return next.size === previous.size &&
    [...next].every(([date, values]) => values === previous.get(date))
    ? previous
    : next;
}

export function applyCalendarPreview(
  entries: readonly CalendarEntry[],
  days: readonly { date: string; entries: readonly CalendarEntry[] }[],
): readonly CalendarEntry[] {
  if (!days.length) return entries;
  const dates = new Set(days.map((day) => day.date));
  return [
    ...entries.filter((entry) => !dates.has(entry.date)),
    ...days.flatMap((day) => day.entries),
  ];
}

/** Full year plus the two prepared outer months at either end. Grid edges are expanded by the index. */
export function calendarDataMonths(year: string): readonly string[] {
  return Array.from({ length: 16 }, (_, index) => addMonths(year + "-01", index - 2));
}
