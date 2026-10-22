import { useMemo, useState } from "react";
import { useVisibleSharedCalendars } from "@/application/shared-calendars-context";
import { sharedCalendarDays } from "./shared-calendar-display";
import { addMonths } from "@/engine/calendar";

export function useSharedCalendarDays(timeZone: string, month: string) {
  const liveCalendars = useVisibleSharedCalendars();
  const [retain] = useState(() => {
    let previous: typeof liveCalendars = [];
    return (liveCalendars: typeof previous) => {
      // Runtime owns cache age/revocation. A timestamp-only refresh must not rebuild display rows.
      const old = previous;
      if (
        old.length === liveCalendars.length &&
        old.every((item, index) => {
          const next = liveCalendars[index];
          return (
            item.accountId === next.accountId &&
            item.calendar === next.calendar &&
            item.entries === next.entries &&
            item.visible === next.visible &&
            item.localColor === next.localColor
          );
        })
      )
        return old;
      previous = liveCalendars;
      return liveCalendars;
    };
  });
  const calendars = useMemo(() => retain(liveCalendars), [liveCalendars, retain]);
  // The runtime validates cache age on every foreground tick, including offline.
  const sharedEntriesByDate = useMemo(
    () =>
      sharedCalendarDays(calendars, timeZone, null, {
        // Five prepared pages plus their adjacent grid days. The caller follows
        // the preview month during a gesture, not only the eventual commit.
        startDate: addMonths(month, -3) + "-01",
        endDate: addMonths(month, 4) + "-01",
      }),
    [calendars, timeZone, month],
  );
  return { sharedEntriesByDate };
}
