import { Temporal } from "@js-temporal/polyfill";
import type { CachedSharedCalendar, SharedCalendarEntry } from "@/domain/calendar-sharing";
export const SHARED_CALENDAR_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
export interface SharedCalendarDayEntry {
  readonly calendarId: string;
  readonly calendarName: string;
  readonly calendarColor: string;
  readonly entry: SharedCalendarEntry;
  readonly when: string;
  readonly fetchedAt: string;
}
const dayLabel = (date: Temporal.PlainDate) =>
  `${String(date.day).padStart(2, "0")}.${String(date.month).padStart(2, "0")}.`;
const timeLabel = (date: Temporal.ZonedDateTime) =>
  `${String(date.hour).padStart(2, "0")}:${String(date.minute).padStart(2, "0")}`;
/** Read-only view data. Foreign entries never become local CalendarEntry objects. */
export function sharedCalendarDays(
  calendars: readonly CachedSharedCalendar[],
  timeZone: string,
  now: number | null = Date.now(),
  window?: { readonly startDate: string; readonly endDate: string },
): ReadonlyMap<string, readonly SharedCalendarDayEntry[]> {
  const days = new Map<string, SharedCalendarDayEntry[]>();
  for (const cached of calendars) {
    const age = now === null ? 0 : now - Date.parse(cached.fetchedAt);
    if (
      !cached.visible ||
      cached.calendar.isOwner ||
      !Number.isFinite(age) ||
      age < 0 ||
      age >= SHARED_CALENDAR_CACHE_MAX_AGE
    )
      continue;
    for (const entry of cached.entries) {
      try {
        const start = Temporal.Instant.from(entry.startsAt).toZonedDateTimeISO(
          entry.allDay ? entry.timeZone : timeZone,
        );
        const end = Temporal.Instant.from(entry.endsAt).toZonedDateTimeISO(
          entry.allDay ? entry.timeZone : timeZone,
        );
        if (
          Temporal.ZonedDateTime.compare(end, start) <= 0 ||
          end.epochMilliseconds - start.epochMilliseconds > 48 * 60 * 60 * 1000
        )
          continue;
        const date = start.toPlainDate();
        const endDate = end.toPlainDate();
        const when = entry.allDay
          ? "Ganztägig"
          : `${timeLabel(start)}–${timeLabel(end)}${date.equals(endDate) ? "" : ` · endet am ${dayLabel(endDate)}`}`;
        const row = {
          calendarId: cached.calendar.id,
          calendarName: cached.calendar.name,
          calendarColor: cached.calendar.color,
          entry,
          when,
          fetchedAt: cached.fetchedAt,
        };
        let day = date;
        let count = 0;
        do {
          const key = day.toString();
          if (!window || (key >= window.startDate && key < window.endDate)) {
            const rows = days.get(key) ?? [];
            rows.push(row);
            days.set(key, rows);
          }
          day = day.add({ days: 1 });
          count++;
        } while (entry.allDay && Temporal.PlainDate.compare(day, endDate) < 0 && count < 366);
      } catch {
        /* Damaged caches do not crash the local calendar. */
      }
    }
  }
  return days;
}
