import { useMemo } from "react";
import { useVisibleSharedCalendars } from "@/application/shared-calendars-context";
import { sharedCalendarDays } from "./shared-calendar-display";
import { addMonths } from "@/engine/calendar";

export function useSharedCalendarDays(timeZone: string, month: string) {
  const calendars = useVisibleSharedCalendars();
  // The runtime validates cache age on every foreground tick, including offline.
  const sharedEntriesByDate = useMemo(
    () =>
      sharedCalendarDays(calendars, timeZone, null, {
        startDate: addMonths(month, -1) + "-01",
        endDate: addMonths(month, 2) + "-01",
      }),
    [calendars, timeZone, month],
  );
  return { sharedEntriesByDate };
}
