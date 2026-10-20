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
type Projection = { readonly dates: readonly string[]; readonly when: string };
const projections = new WeakMap<SharedCalendarEntry, Map<string, Projection | null>>();

function project(entry: SharedCalendarEntry, timeZone: string): Projection | null {
  const zone = entry.allDay ? entry.timeZone : timeZone;
  let cached = projections.get(entry);
  if (cached?.has(zone)) return cached.get(zone)!;
  if (!cached) {
    cached = new Map();
    projections.set(entry, cached);
  }
  // Bound alternate viewer zones; WeakMap releases removed entries with their calendars.
  if (cached.size >= 2) cached.delete(cached.keys().next().value!);
  let result: Projection | null = null;
  try {
    const start = Temporal.Instant.from(entry.startsAt).toZonedDateTimeISO(zone);
    const end = Temporal.Instant.from(entry.endsAt).toZonedDateTimeISO(zone);
    if (
      Temporal.ZonedDateTime.compare(end, start) > 0 &&
      end.epochMilliseconds - start.epochMilliseconds <= 48 * 60 * 60 * 1000
    ) {
      const date = start.toPlainDate();
      const endDate = end.toPlainDate();
      const when = entry.allDay
        ? "Ganztägig"
        : `${timeLabel(start)}–${timeLabel(end)}${date.equals(endDate) ? "" : ` · endet am ${dayLabel(endDate)}`}`;
      const dates: string[] = [];
      let day = date;
      do {
        dates.push(day.toString());
        day = day.add({ days: 1 });
      } while (entry.allDay && Temporal.PlainDate.compare(day, endDate) < 0 && dates.length < 366);
      result = { dates, when };
    }
  } catch {
    /* Damaged caches do not crash the local calendar. */
  }
  cached.set(zone, result);
  return result;
}

/** Read-only view data. Foreign entries never become local CalendarEntry objects. */
export function sharedCalendarDays(
  calendars: readonly CachedSharedCalendar[],
  timeZone: string,
  now: number | null = Date.now(),
  window?: { readonly startDate: string; readonly endDate: string },
): ReadonlyMap<string, readonly SharedCalendarDayEntry[]> {
  const days = new Map<string, SharedCalendarDayEntry[]>();
  // A full day of padding covers source/viewer UTC offsets, including DST.
  // Non-finite dates fall through to Temporal's existing validation.
  const padding = 24 * 60 * 60 * 1000;
  const lower = window ? Date.parse(`${window.startDate}T00:00:00Z`) - padding : -Infinity;
  const upper = window ? Date.parse(`${window.endDate}T00:00:00Z`) + padding : Infinity;
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
      if (!entry || typeof entry !== "object") continue;
      if (window && (Date.parse(entry.endsAt) < lower || Date.parse(entry.startsAt) >= upper))
        continue;
      const projected = project(entry, timeZone);
      if (!projected) continue;
      const dates = window
        ? projected.dates.filter((date) => date >= window.startDate && date < window.endDate)
        : projected.dates;
      if (!dates.length) continue;
      const row: SharedCalendarDayEntry = {
        calendarId: cached.calendar.id,
        calendarName: cached.calendar.name,
        calendarColor: cached.localColor ?? cached.calendar.color,
        entry,
        when: projected.when,
        fetchedAt: cached.fetchedAt,
      };
      for (const date of dates) {
        const rows = days.get(date) ?? [];
        rows.push(row);
        days.set(date, rows);
      }
    }
  }
  return days;
}
