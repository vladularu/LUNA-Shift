import { useLayoutEffect, useMemo } from "react";
import { calendarPerformance } from "@/application/calendar-performance";
import type { CalendarEntry } from "@/domain/types";
import { createMonthGrid } from "@/engine/calendar";
import { expandCalendarEntries } from "@/engine/recurrence";
import { buildCalendarEntryIndex } from "./calendar-entry-index";

export function useMeasuredCalendarEntries(
  entries: readonly CalendarEntry[],
  months: readonly string[],
  showAppointments: boolean,
  showShifts: boolean,
) {
  const expanded = useMemo(() => {
    const finish = calendarPerformance.span("expand", {
      input: entries.length,
      series: calendarPerformance.getSnapshot()
        ? entries.filter((entry) => entry.kind === "APPOINTMENT" && entry.recurrence != null).length
        : 0,
    });
    const first = createMonthGrid(months[0])[0].date;
    const last = createMonthGrid(months[months.length - 1]).at(-1)!.date;
    const result = expandCalendarEntries(entries, first, last);
    finish({ output: result.length });
    return result;
  }, [entries, months]);
  return useMemo(() => {
    const finish = calendarPerformance.span("index", { input: expanded.length });
    const result = buildCalendarEntryIndex(expanded, { showAppointments, showShifts });
    finish({ output: result.visibleEntries.length });
    return result;
  }, [expanded, showAppointments, showShifts]);
}

/** Page-local commit markers only; the single app-wide probe samples all frames. */
export function useCalendarPerformance(active: boolean, month: string, mode: string) {
  useLayoutEffect(() => {
    calendarPerformance.record("commit", {
      month: Number(month.replace("-", "")),
      mode: mode === "MONTH" ? 1 : 0,
      state: active ? 1 : 0,
    });
  });
}
