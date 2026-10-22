import { describe, expect, it } from "vitest";
import type { CachedSharedCalendar } from "@/domain/calendar-sharing";
import type { ShiftEntry } from "@/domain/types";
import { calendarChipPalette, sharedCalendarChipPalette } from "@/theme/color-contrast";
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
      breakMinutes: 60,
      timeZone: "Europe/Berlin",
    },
  ],
};
const ownShift: ShiftEntry = {
  kind: "SHIFT",
  id: "own",
  date: "2026-11-01",
  templateId: null,
  title: "Eigener Dienst",
  type: "EARLY",
  startTime: "06:00",
  endTime: "14:00",
  breakMinutes: 30,
  color: "#123456",
  symbol: "sun",
  note: "PRIVATE",
  overtimeMinutes: 0,
  holidayPremiumMode: "WITH_TIME_OFF",
  revision: 1,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  deletedAt: null,
};
function timeline(
  sharedCalendars: readonly CachedSharedCalendar[],
  options: Partial<Parameters<typeof buildCalendarWidgetTimeline>[0]> = {},
) {
  return buildCalendarWidgetTimeline({
    entries: [],
    now: new Date("2026-10-31T12:00:00Z"),
    timeZone: "Europe/Berlin",
    scheme: "lunashift",
    hasProfile: true,
    sharedCalendars,
    ...options,
  });
}
describe("geteilte Dienste im Widget", () => {
  it.each([
    [true, false, "21:00"],
    [false, true, "9:00 h"],
    [true, true, "21:00 · 9:00 h"],
    [false, false, null],
  ] as const)(
    "applies time=%s and duration=%s in every grid",
    (showShiftTimes, showShiftDuration, detail) => {
      const props = timeline([cache], {
        display: { labelMode: "FULL", showShifts: true, showShiftTimes, showShiftDuration },
      })[0].props;
      for (const grid of [props.days, props.weekDays, props.monthDays]) {
        expect(grid.find((day) => day.date === "2026-11-01")!.shifts[0]).toMatchObject({
          detail,
          ownerName: "Loni",
          ownerColor: "#0088CC",
        });
      }
    },
  );
  it.each([
    ["FULL", "Nacht", null],
    ["SHORT", "N", null],
    ["SYMBOL", "moon", "moon"],
  ] as const)("uses the viewer's %s label setting", (labelMode, displayLabel, symbol) => {
    const day = timeline([cache], {
      display: { labelMode, showShiftTimes: true, showShiftDuration: false, showShifts: true },
    })[0].props.weekDays.find((item) => item.date === "2026-11-01")!;
    expect(day.shifts[0]).toMatchObject({
      displayLabel,
      symbol,
      detail: "21:00",
      ownerName: "Loni",
    });
  });
  it.each([
    ["sunrise", "sunrise"],
    ["clock", "clock"],
    ["calendar", "calendar"],
    ["unavailable", "xmark.circle"],
  ])("renders the shared %s symbol", (symbol, nativeSymbol) => {
    const shared = { ...cache, entries: [{ ...cache.entries[0], symbol }] };
    const day = timeline([shared], {
      display: {
        labelMode: "SYMBOL",
        showShiftTimes: false,
        showShiftDuration: false,
        showShifts: true,
      },
    })[0].props.weekDays.find((item) => item.date === "2026-11-01")!;
    expect(day.shifts[0].symbol).toBe(nativeSymbol);
  });
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
    expect(day.url).toBe("lunashift:///?month=2026-10");
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

describe("widget priority across all calendar grids", () => {
  const grids = ["days", "weekDays", "monthDays"] as const;
  it.each(grids)("keeps own shifts instead of shared shifts in %s", (grid) => {
    const day = timeline([cache], { entries: [ownShift] })[0].props[grid].find(
      (day) => day.date === ownShift.date,
    )!;
    expect(day.shifts.map((shift) => shift.id)).toEqual(["own"]);
    expect(JSON.stringify(day)).not.toMatch(/Loni|Nacht|PRIVATE/);
  });
  it.each(grids)("uses one shared fallback when there is no own shift in %s", (grid) => {
    const earlier = {
      ...cache.entries[0],
      id: "early",
      title: "Früh",
      startsAt: "2026-11-01T06:00:00Z",
      endsAt: "2026-11-01T14:00:00Z",
    };
    const second = {
      ...cache,
      calendar: { ...cache.calendar, id: "another", name: "Andere Person" },
      entries: [earlier],
    };
    for (const shared of [
      [cache, second],
      [second, cache],
    ]) {
      const day = timeline(shared)[0].props[grid].find((day) => day.date === ownShift.date)!;
      expect(day.shifts).toHaveLength(1);
      expect(day.shifts[0]).toMatchObject({
        id: "shared:another:early",
        title: "Früh",
        ownerName: "Andere Person",
      });
    }
  });
  it("uses stable IDs to select between equally early shared shifts", () => {
    const second = { ...cache, calendar: { ...cache.calendar, id: "aaa" } };
    for (const shared of [
      [cache, second],
      [second, cache],
    ]) {
      expect(
        timeline(shared)[0].props.days.find((day) => day.date === ownShift.date)!.shifts[0].id,
      ).toBe("shared:aaa:night");
    }
  });
  it.each(grids)("allows shared fallback after an own shift is deleted in %s", (grid) => {
    const day = timeline([cache], { entries: [{ ...ownShift, deletedAt: "2026-10-31" }] })[0].props[
      grid
    ].find((day) => day.date === ownShift.date)!;
    expect(day.shifts).toHaveLength(1);
    expect(day.shifts[0].ownerName).toBe("Loni");
  });
  it("does not mistake a hidden own shift for an empty day", () => {
    const props = timeline([cache], {
      entries: [ownShift],
      display: {
        labelMode: "SHORT",
        showShiftTimes: true,
        showShiftDuration: false,
        showShifts: false,
      },
    })[0].props;
    for (const grid of grids) {
      expect(props[grid].find((day) => day.date === ownShift.date)!.shifts).toEqual([]);
    }
  });
  it("treats an explicitly entered free day as an own entry", () => {
    const day = timeline([cache], {
      entries: [{ ...ownShift, type: "FREE", title: "Frei", startTime: null, endTime: null }],
    })[0].props.days.find((day) => day.date === ownShift.date)!;
    expect(day.shifts.map((shift) => shift.title)).toEqual(["Frei"]);
  });
  it("keeps own entries at the exact shared cache expiry", () => {
    const result = timeline([cache], { entries: [ownShift] });
    const expired = result.find(
      (entry) => entry.date.toISOString() === "2026-11-01T11:00:00.000Z",
    )!;
    for (const grid of grids) {
      expect(
        expired.props[grid]
          .find((day) => day.date === ownShift.date)!
          .shifts.map((shift) => shift.id),
      ).toEqual(["own"]);
    }
  });
});

describe("shared widget colors match the app calendar", () => {
  it.each(["days", "weekDays", "monthDays"] as const)(
    "uses muted shared text without changing own shift colors in %s",
    (grid) => {
      const color = "#FF526D";
      const shared = { ...cache, entries: [{ ...cache.entries[0], color }] };
      const sharedShift = timeline([shared])[0].props[grid].find(
        (day) => day.date === ownShift.date,
      )!.shifts[0];
      const own = timeline([shared], { entries: [{ ...ownShift, color }] })[0].props[grid].find(
        (day) => day.date === ownShift.date,
      )!.shifts[0];
      for (const mode of ["light", "dark"] as const) {
        const dark = mode === "dark";
        expect(sharedShift[mode]).toEqual(sharedCalendarChipPalette(color, dark));
        expect(sharedShift[mode].onDetail).not.toBe(calendarChipPalette(color, dark).onDetail);
        expect(own[mode]).toEqual(calendarChipPalette(color, dark));
      }
      expect(sharedShift.ownerColor).toBe(cache.calendar.color);
      expect(sharedShift.color).toBe(color);
    },
  );
});
