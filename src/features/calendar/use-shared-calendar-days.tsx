import { useCallback, useEffect, useMemo, useState } from "react";
import { useVisibleSharedCalendars } from "@/application/shared-calendars-context";
import { sharedCalendarDays } from "./shared-calendar-display";
import { addMonths } from "@/engine/calendar";
import { SharedCalendarDaySheet } from "./shared-calendar-day";
export function useSharedCalendarDays(
  timeZone: string,
  isFocused: boolean,
  closeQuickPopup: () => void,
  month: string,
) {
  const calendars = useVisibleSharedCalendars();
  // The runtime store validates TTL on each foreground tick, even while offline.
  // Joining that verified snapshot stays pure during React rendering.
  const sharedEntriesByDate = useMemo(
    () =>
      sharedCalendarDays(calendars, timeZone, null, {
        startDate: `${addMonths(month, -1)}-01`,
        endDate: `${addMonths(month, 2)}-01`,
      }),
    [calendars, timeZone, month],
  );
  const [date, setDate] = useState<string | null>(null);
  const accountId = calendars[0]?.accountId;
  useEffect(() => {
    setDate(null);
  }, [accountId]);
  useEffect(() => {
    if (date && !sharedEntriesByDate.get(date)?.length) setDate(null);
  }, [date, sharedEntriesByDate]);
  const openSharedDate = useCallback(
    (next: string) => {
      closeQuickPopup();
      setDate(next);
    },
    [closeQuickPopup],
  );
  const close = useCallback(() => setDate(null), []);
  const sharedDaySheet =
    date !== null && isFocused ? (
      <SharedCalendarDaySheet
        date={date}
        entries={sharedEntriesByDate.get(date) ?? []}
        onClose={close}
      />
    ) : null;
  return { sharedEntriesByDate, openSharedDate, sharedDaySheet };
}
