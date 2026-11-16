import { Temporal } from "@js-temporal/polyfill";

const DAY_MS = 86_400_000;
const CACHE_LIMIT = 2048;
const dateDays = new WeakMap<Temporal.PlainDate, number>();
const dates = new Map<number, { readonly date: Temporal.PlainDate; readonly value: string }>();
const boundaries = new Map<string, { readonly start: number; readonly end: number }>();
const midnights = new Map<string, number>();

/** Calendar-day distance is independent of elapsed hours and DST. */
export function calendarDayIndex(date: Temporal.PlainDate): number {
  const cached = dateDays.get(date);
  if (cached !== undefined) return cached;
  const value = date.toString({ calendarName: "never" });
  const day = Date.parse(`${value}T00:00:00Z`) / DAY_MS;
  dateDays.set(date, day);
  return day;
}

export function calendarValueDay(value: string): number {
  return Date.parse(`${value}T00:00:00Z`) / DAY_MS;
}

export function calendarDate(day: number): {
  readonly date: Temporal.PlainDate;
  readonly value: string;
} {
  const cached = dates.get(day);
  if (cached) return cached;
  const value = new Date(day * DAY_MS).toISOString().split("T")[0];
  const date = Temporal.PlainDate.from(value);
  const result = { date, value };
  if (dates.size >= CACHE_LIMIT) dates.delete(dates.keys().next().value!);
  dates.set(day, result);
  dateDays.set(date, day);
  return result;
}

export function isSundayDay(day: number): boolean {
  return (((day + 4) % 7) + 7) % 7 === 0;
}

export function calendarDayBounds(
  day: number,
  timeZone: string,
): { readonly start: number; readonly end: number } {
  const key = `${timeZone}:${day}`;
  const cached = boundaries.get(key);
  if (cached) return cached;
  const midnight = (value: number) => {
    const midnightKey = `${timeZone}:${value}`;
    const known = midnights.get(midnightKey);
    if (known !== undefined) return known;
    const date = calendarDate(value).date;
    const result = Temporal.ZonedDateTime.from(
      { timeZone, year: date.year, month: date.month, day: date.day, hour: 0, minute: 0 },
      { disambiguation: "earlier" },
    ).epochMilliseconds;
    if (midnights.size >= CACHE_LIMIT) midnights.delete(midnights.keys().next().value!);
    midnights.set(midnightKey, result);
    return result;
  };
  const result = { start: midnight(day), end: midnight(day + 1) };
  if (boundaries.size >= CACHE_LIMIT) boundaries.delete(boundaries.keys().next().value!);
  boundaries.set(key, result);
  return result;
}
