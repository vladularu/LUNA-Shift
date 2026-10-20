import { describe, it, expect, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { sharedCalendarDays } from "./shared-calendar-display";
import type { CachedSharedCalendar, SharedCalendarEntry } from "@/domain/calendar-sharing";
const now = Date.parse("2026-10-25T12:00:00Z");
const item: CachedSharedCalendar = {
  accountId: "viewer",
  calendar: {
    id: "cal",
    ownerId: "owner",
    name: "Alex",
    color: "#123456",
    visibility: "DETAILS",
    revision: 1,
    isOwner: false,
    publishedAt: "2026-10-25T10:00:00Z",
  },
  visible: true,
  fetchedAt: "2026-10-25T11:00:00Z",
  entries: [
    {
      id: "entry",
      title: "Nacht",
      color: "#FF0000",
      symbol: "moon",
      startsAt: "2026-10-24T19:00:00Z",
      endsAt: "2026-10-25T06:30:00Z",
      timeZone: "Europe/Berlin",
      allDay: false,
    },
  ],
};
describe("separate read-only shared calendar display", () => {
  it("shows a DST night with correct local start and next-day end", () => {
    const result = sharedCalendarDays([item], "Europe/Berlin", now);
    const row = result.get("2026-10-24")![0];
    expect(row.when).toBe("21:00–07:30 · endet am 25.10.");
    expect(row.calendarName).toBe("Alex");
    expect(row.calendarColor).toBe("#123456");
    expect(row.entry).toBe(item.entries[0]);
  });
  it("hides owner copies, hidden calendars and expired cache without touching local data", () => {
    expect(
      sharedCalendarDays(
        [
          { ...item, visible: false },
          { ...item, calendar: { ...item.calendar, isOwner: true } },
          { ...item, fetchedAt: "2026-10-24T10:00:00Z" },
        ],
        "Europe/Berlin",
        now,
      ).size,
    ).toBe(0);
    expect(item.entries).toHaveLength(1);
  });
  it("uses source dates for all-day entries across viewer time zones", () => {
    const allDay = {
      ...item,
      entries: [
        {
          ...item.entries[0],
          startsAt: "2026-10-24T22:00:00Z",
          endsAt: "2026-10-25T23:00:00Z",
          allDay: true,
        },
      ],
    };
    const map = sharedCalendarDays([allDay], "America/New_York", now);
    expect([...map.keys()]).toEqual(["2026-10-25"]);
    expect(map.get("2026-10-25")![0].when).toBe("Ganztägig");
  });
  it("bounds aggregation to visible months and rejects hostile long intervals", () => {
    expect(
      sharedCalendarDays([item], "Europe/Berlin", now, {
        startDate: "2026-11-01",
        endDate: "2026-12-01",
      }).size,
    ).toBe(0);
    expect(
      sharedCalendarDays(
        [
          {
            ...item,
            entries: [{ ...item.entries[0], allDay: true, endsAt: "2099-10-01T00:00:00Z" }],
          },
        ],
        "Europe/Berlin",
        now,
      ).size,
    ).toBe(0);
  });
  it("fails closed on damaged cached intervals", () => {
    expect(
      sharedCalendarDays(
        [{ ...item, entries: [{ ...item.entries[0], startsAt: "invalid" }] }],
        "Europe/Berlin",
        now,
      ).size,
    ).toBe(0);
    expect(
      sharedCalendarDays(
        [{ ...item, entries: [null as unknown as SharedCalendarEntry] }],
        "Europe/Berlin",
        now,
        { startDate: "2026-10-01", endDate: "2026-11-01" },
      ).size,
    ).toBe(0);
  });
});

it("uses the local calendar marker while retaining the owner's original service", () => {
  const rows = sharedCalendarDays([{ ...item, localColor: "#AA4455" }], "Europe/Berlin", now);
  const row = [...rows.values()][0][0];
  expect(row.calendarColor).toBe("#AA4455");
  expect(row.entry).toBe(item.entries[0]);
  expect(item.calendar.color).toBe("#123456");
});

it("skips old entries before expensive time-zone conversion", () => {
  const convert = vi.spyOn(Temporal.Instant, "from");
  try {
    const entries = Array.from({ length: 3000 }, (_, i) => ({
      ...item.entries[0],
      id: `old-${i}`,
    }));
    expect(
      sharedCalendarDays([{ ...item, entries }], "Europe/Berlin", now, {
        startDate: "2027-01-01",
        endDate: "2027-02-01",
      }).size,
    ).toBe(0);
    expect(convert).not.toHaveBeenCalled();
  } finally {
    convert.mockRestore();
  }
});

it("reuses prepared entry times while keeping fresh metadata and expiry checks", () => {
  const cached = { ...item, entries: [{ ...item.entries[0] }] };
  const convert = vi.spyOn(Temporal.Instant, "from");
  try {
    sharedCalendarDays([cached], "Europe/Berlin", now);
    expect(convert).toHaveBeenCalledTimes(2);
    const refreshed = {
      ...cached,
      fetchedAt: "2026-10-25T11:30:00Z",
      localColor: "#AA4455",
      calendar: { ...cached.calendar, name: "Sam" },
    };
    const row = sharedCalendarDays([refreshed], "Europe/Berlin", now).get("2026-10-24")![0];
    expect(convert).toHaveBeenCalledTimes(2);
    expect(row).toMatchObject({
      calendarName: "Sam",
      calendarColor: "#AA4455",
      fetchedAt: refreshed.fetchedAt,
    });
    expect(sharedCalendarDays([refreshed], "Europe/Berlin", now + 86400000).size).toBe(0);
    sharedCalendarDays([cached], "America/New_York", now);
    expect(convert).toHaveBeenCalledTimes(4);
  } finally {
    convert.mockRestore();
  }
});

it.each(["Europe/Berlin", "Pacific/Kiritimati", "Pacific/Pago_Pago", "America/New_York"])(
  "preserves window boundaries for overnight and all-day entries in %s",
  (timeZone) => {
    const entries = [
      { ...item.entries[0], startsAt: "2026-09-30T22:00:00Z", endsAt: "2026-10-01T06:00:00Z" },
      { ...item.entries[0], startsAt: "2026-10-31T23:30:00Z", endsAt: "2026-11-01T06:00:00Z" },
      {
        ...item.entries[0],
        allDay: true,
        startsAt: "2026-09-30T10:00:00Z",
        endsAt: "2026-10-02T10:00:00Z",
        timeZone: "Pacific/Kiritimati",
      },
      {
        ...item.entries[0],
        allDay: true,
        startsAt: "2026-10-24T22:00:00Z",
        endsAt: "2026-10-25T23:00:00Z",
      },
    ];
    const source = [{ ...item, entries }];
    const full = [...sharedCalendarDays(source, timeZone, now)].filter(
      ([date]) => date >= "2026-10-01" && date < "2026-11-01",
    );
    expect([
      ...sharedCalendarDays(source, timeZone, now, {
        startDate: "2026-10-01",
        endDate: "2026-11-01",
      }),
    ]).toEqual(full);
  },
);
