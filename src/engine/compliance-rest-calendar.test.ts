import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import {
  calendarDate,
  calendarDayBounds,
  calendarDayIndex,
  calendarValueDay,
  isSundayDay,
} from "@/engine/compliance-rest-calendar";

describe("numeric rest calendar", () => {
  it.each(["1900-01-01", "1969-12-31", "1970-01-01", "2000-02-29", "2026-12-31", "4099-12-31"])(
    "round-trips %s with calendar-day distance",
    (value) => {
      const date = Temporal.PlainDate.from(value);
      const day = date.since("1970-01-01").days;
      expect(calendarDayIndex(date)).toBe(day);
      expect(calendarValueDay(value)).toBe(day);
      expect(calendarDate(day).value).toBe(value);
      expect(calendarDate(day).date.equals(date)).toBe(true);
      expect(isSundayDay(day)).toBe(date.dayOfWeek === 7);
    },
  );

  it("preserves leap days and weekday arithmetic before the epoch", () => {
    const leap = calendarValueDay("2024-02-28");
    expect(calendarDate(leap + 1).value).toBe("2024-02-29");
    expect(calendarDate(leap + 2).value).toBe("2024-03-01");
    expect(isSundayDay(calendarValueDay("1969-12-28"))).toBe(true);
    expect(isSundayDay(calendarValueDay("1970-01-01"))).toBe(false);
  });

  it.each([
    ["2026-03-29", "Europe/Berlin", 23],
    ["2026-10-25", "Europe/Berlin", 25],
    ["2026-03-29", "UTC", 24],
    ["2026-03-08", "America/New_York", 23],
    ["2026-11-01", "America/New_York", 25],
  ] as const)("retains %s in %s as a %i-hour day", (value, timeZone, hours) => {
    const day = calendarValueDay(value);
    const bounds = calendarDayBounds(day, timeZone);
    expect((bounds.end - bounds.start) / 3_600_000).toBe(hours);
    expect(calendarDayBounds(day + 1, timeZone).start).toBe(bounds.end);
    expect(calendarDayBounds(day, timeZone)).toEqual(bounds);
  });

  it("separates timezone caches and preserves the existing earlier midnight policy", () => {
    for (const value of ["2011-12-29", "2011-12-30", "2011-12-31", "2018-11-04"]) {
      for (const timeZone of ["Pacific/Apia", "America/Sao_Paulo", "UTC", "Pacific/Apia"]) {
        const date = Temporal.PlainDate.from(value);
        const expected = (item: Temporal.PlainDate) =>
          Temporal.ZonedDateTime.from(
            { timeZone, year: item.year, month: item.month, day: item.day, hour: 0, minute: 0 },
            { disambiguation: "earlier" },
          ).epochMilliseconds;
        expect(calendarDayBounds(calendarValueDay(value), timeZone)).toEqual({
          start: expected(date),
          end: expected(date.add({ days: 1 })),
        });
      }
    }
  });

  it("keeps values correct after the bounded cache has cycled", () => {
    const first = calendarValueDay("2020-01-01");
    const expected = calendarDayBounds(first, "UTC");
    for (let day = first; day < first + 2050; day++) calendarDayBounds(day, "UTC");
    expect(calendarDate(first).value).toBe("2020-01-01");
    expect(calendarDayBounds(first, "UTC")).toEqual(expected);
  });
});
