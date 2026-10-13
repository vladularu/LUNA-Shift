import type { CalendarEntry } from "@/domain/types";
import { CALENDAR_METRICS } from "@/theme/tokens";
import type { SharedCalendarDayEntry } from "./shared-calendar-display";

export type CombinedCalendarRow =
  | { readonly kind: "own"; readonly entry: CalendarEntry }
  | { readonly kind: "shared"; readonly row: SharedCalendarDayEntry };

/** Use one height budget for both layers; overflow lives beside the date. */
export function combinedCalendarPreview(
  own: readonly CalendarEntry[],
  shared: readonly SharedCalendarDayEntry[],
  weekHeight: number,
  detailed: boolean,
) {
  const headerHeight = 30;
  const available = Math.max(0, weekHeight - headerHeight - 2);
  const lines = detailed ? 2 : 1;
  const capacity = Math.min(2, Math.floor((available + 1) / (lines * 11 + 1)));
  const ordered: CombinedCalendarRow[] = [
    ...own.slice(0, 1).map((entry) => ({ kind: "own" as const, entry })),
    ...shared.slice(0, 1).map((row) => ({ kind: "shared" as const, row })),
    ...own.slice(1).map((entry) => ({ kind: "own" as const, entry })),
    ...shared.slice(1).map((row) => ({ kind: "shared" as const, row })),
  ];
  const rows = ordered.slice(0, Math.max(0, capacity));
  const lineHeight = Math.min(
    CALENDAR_METRICS.entryRowHeight,
    capacity === 0
      ? CALENDAR_METRICS.entryRowHeight
      : Math.floor((available - Math.max(0, capacity - 1)) / (capacity * lines)),
  );
  return { rows, lineHeight, headerHeight, overflowCount: ordered.length - rows.length };
}
