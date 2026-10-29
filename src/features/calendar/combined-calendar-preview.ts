import type { CalendarEntry } from "@/domain/types";
import { CALENDAR_METRICS } from "@/theme/tokens";
import type { SharedCalendarDayEntry } from "./shared-calendar-display";

export type CombinedCalendarRow =
  | { readonly kind: "own"; readonly entry: CalendarEntry }
  | { readonly kind: "shared"; readonly row: SharedCalendarDayEntry };

function isAppointment(item: CombinedCalendarRow): boolean {
  return (item.kind === "own" ? item.entry.kind : item.row.entry.kind) === "APPOINTMENT";
}

/** Two service heights shared by both calendars; appointments need only one line. */
export function combinedCalendarPreview(
  own: readonly CalendarEntry[],
  shared: readonly SharedCalendarDayEntry[],
  weekHeight: number,
  detailed: boolean,
) {
  const headerHeight = 31;
  const available = Math.max(0, weekHeight - headerHeight - 2);
  const lines = detailed ? 2 : 1;
  const capacity = Math.min(2, Math.floor((available + 1) / (lines * 11 + 1)));
  const ranked: CombinedCalendarRow[] = [
    ...own.slice(0, 1).map((entry) => ({ kind: "own" as const, entry })),
    ...shared.slice(0, 1).map((row) => ({ kind: "shared" as const, row })),
    ...own.slice(1).map((entry) => ({ kind: "own" as const, entry })),
    ...shared.slice(1).map((row) => ({ kind: "shared" as const, row })),
  ];
  // Keep appointments together below services so two lines always share a tile height.
  const ordered = [...ranked.filter((row) => !isAppointment(row)), ...ranked.filter(isAppointment)];
  // Keep geometry stable when a calendar is hidden or a day gains another entry.
  const gap = Math.max(1, Math.min(4, available - capacity * lines * 11));
  const lineHeight = Math.min(
    CALENDAR_METRICS.entryRowHeight,
    capacity === 0
      ? CALENDAR_METRICS.entryRowHeight
      : Math.floor((available - Math.max(0, capacity - 1) * gap) / (capacity * lines)),
  );
  const rows: CombinedCalendarRow[] = [];
  const heights: number[] = [];
  const gaps: number[] = [];
  let usedLines = 0;
  let usedHeight = 0;
  for (const item of ordered) {
    const rowLines = isAppointment(item) ? 1 : lines;
    const previous = rows.at(-1);
    const gapBefore = previous && !(isAppointment(previous) && isAppointment(item)) ? gap : 0;
    const height = rowLines * lineHeight;
    if (usedLines + rowLines > capacity * lines || usedHeight + gapBefore + height > available)
      break;
    rows.push(item);
    heights.push(height);
    gaps.push(gapBefore);
    usedLines += rowLines;
    usedHeight += gapBefore + height;
  }
  const hiddenRows = ordered.slice(rows.length);
  return {
    rows,
    heights,
    gaps,
    usedHeight,
    hiddenRows,
    lineHeight,
    headerHeight,
    overflowCount: hiddenRows.length,
  };
}
