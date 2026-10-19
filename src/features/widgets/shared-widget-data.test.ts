import { describe, expect, it } from "vitest";
import type { CachedSharedCalendar } from "@/domain/calendar-sharing";
import { buildCalendarWidgetTimeline } from "./calendar-widget-data";
const cache: CachedSharedCalendar = {
  accountId: "reader",
  visible: true,
  fetchedAt: "2026-10-31T11:00:00Z",
  calendar: {
    id: "plan",
    ownerId: "other",
    name: "Loni",
    color: "#0088CC",
    visibility: "DETAILS",
    revision: 2,
    isOwner: false,
    publishedAt: "2026-10-31T11:00:00Z",
  },
  entries: [
    {
      id: "night",
      title: "Nacht",
      color: "#CCAA33",
      symbol: "moon",
      startsAt: "2026-11-01T20:00:00Z",
      endsAt: "2026-11-02T06:00:00Z",
      allDay: false,
      timeZone: "Europe/Berlin",
    },
  ],
};
function timeline(sharedCalendars: readonly CachedSharedCalendar[]) {
  return buildCalendarWidgetTimeline({
    entries: [],
    now: new Date("2026-10-31T12:00:00Z"),
    timeZone: "Europe/Berlin",
    scheme: "lunashift",
    hasProfile: true,
    sharedCalendars,
  });
}
describe("geteilte Dienste im Widget", () => {
  it("preserves the shift color and a separate person marker across months", () => {
    const day = timeline([cache])[0].props.days.find((item) => item.date === "2026-11-01")!;
    expect(day.shifts[0]).toMatchObject({
      title: "Nacht",
      color: "#CCAA33",
      ownerName: "Loni",
      ownerColor: "#0088CC",
      start: "21:00",
      end: "07:00",
      nextDay: true,
    });
    expect(day.url).toBe("lunashift://widget-day?date=2026-11-01");
  });
  it("removes hidden, revoked/removed and owner caches", () => {
    for (const caches of [
      [],
      [{ ...cache, visible: false }],
      [{ ...cache, calendar: { ...cache.calendar, isOwner: true } }],
    ])
      expect(timeline(caches)[0].props.days.flatMap((day) => day.shifts)).toEqual([]);
  });
  it("expires shared entries at the exact cache deadline while keeping the local timeline usable", () => {
    const entries = timeline([cache]);
    const expiry = entries.find(
      (entry) => entry.date.toISOString() === "2026-11-01T11:00:00.000Z",
    )!;
    expect(expiry.props.state).toBe("ready");
    expect(expiry.props.days.flatMap((day) => day.shifts)).toEqual([]);
    expect(entries[1].props.days.flatMap((day) => day.shifts)).toHaveLength(1);
  });
  it("projects only explicit public fields, including availability-only entries", () => {
    const publicCache = {
      ...cache,
      calendar: { ...cache.calendar, visibility: "AVAILABILITY" as const },
      entries: [
        {
          ...cache.entries[0],
          title: "Nicht verfügbar",
          color: "#777777",
          symbol: "unavailable",
          note: "SECRET",
          salary: 12345,
        },
      ],
    };
    const result = JSON.stringify(timeline([publicCache]));
    expect(result).toContain("Nicht verfügbar");
    expect(result).not.toMatch(/SECRET|salary|Nacht/);
  });
});
