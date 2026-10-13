import { describe, expect, it } from "vitest";
import type { Appointment, ShiftEntry } from "@/domain/types";
import {
  buildCalendarWidgetTimeline,
  nextWidgetMidnight,
  widgetEntryRange,
} from "./calendar-widget-data";

function shift(input: Partial<ShiftEntry> = {}): ShiftEntry {
  return {
    kind: "SHIFT",
    id: "shift",
    date: "2026-12-31",
    templateId: null,
    title: "Nachtdienst",
    type: "NIGHT",
    startTime: "22:00",
    endTime: "06:00",
    breakMinutes: 30,
    color: "#123456",
    symbol: "moon",
    note: "Private Notiz",
    overtimeMinutes: 0,
    holidayPremiumMode: "WITH_TIME_OFF",
    revision: 1,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    deletedAt: null,
    ...input,
  };
}
const NOW = new Date("2026-12-31T12:00:00Z");
function timeline(entries: readonly ShiftEntry[] = [], now = NOW, hasProfile = true) {
  return buildCalendarWidgetTimeline({
    entries,
    now,
    hasProfile,
    timeZone: "Europe/Berlin",
    scheme: "pflegeshift-internal",
  });
}

describe("calendar widget timeline", () => {
  it("provides six rolling days, aligned four-week rows and complete month data across a year boundary", () => {
    const result = timeline();
    expect(result).toHaveLength(15);
    expect(result[0].props.days).toHaveLength(6);
    expect(result[0].props.days[0]).toMatchObject({
      date: "2026-12-31",
      weekday: "Do",
      shortDate: "31.12.",
      url: "pflegeshift-internal:///?month=2026-12",
    });
    expect(result[0].props.weekDays).toHaveLength(28);
    expect(result[0].props.weekDays[0]).toMatchObject({
      date: "2026-12-28",
      weekdayIndex: 1,
      weekNumber: 53,
    });
    expect(result[0].props.weekDays[27].date).toBe("2027-01-24");
    expect(result[13].props.weekDays[27].date).toBe("2027-02-07");
    expect(result[0].props.monthDays[0].date).toBe("2026-11-30");
    expect(result[0].props.monthDays.at(-1)?.date).toBe("2027-01-03");
    expect(widgetEntryRange(NOW, "Europe/Berlin")).toEqual({
      startDate: "2026-11-30",
      endDate: "2027-02-07",
    });
    for (const entry of result) {
      expect(entry.props.url).not.toContain("widget-day");
      for (const day of [...entry.props.days, ...entry.props.weekDays, ...entry.props.monthDays])
        expect(day.url).toBe(entry.props.url);
    }
  });
  it("keeps the calendar abbreviation, color and overnight times", () => {
    expect(timeline([shift()])[0].props.days[0].shifts[0]).toMatchObject({
      label: "N",
      title: "Nachtdienst",
      start: "22:00",
      end: "06:00",
      nextDay: true,
      color: "#123456",
      textColor: "#FFFFFF",
    });
    expect(
      timeline([shift({ startTime: "06:00", endTime: "14:00" })])[0].props.days[0].shifts[0]
        .nextDay,
    ).toBe(false);
  });
  it("keeps multiple shifts in chronological order, with no note/location payload", () => {
    const result = timeline([
      shift(),
      shift({ id: "early", title: "Früh", startTime: "06:00", endTime: "14:00" }),
    ]);
    expect(result[0].props.days[0].shifts.map((item) => item.label)).toEqual(["F", "N"]);
    expect(JSON.stringify(result)).not.toContain("Private Notiz");
    expect(result[0].props.days[0].shifts[0]).not.toHaveProperty("location");
  });
  it("omits deleted shifts and appointments", () => {
    const appointment: Appointment = {
      kind: "APPOINTMENT",
      id: "appt",
      date: "2026-12-31",
      title: "Private Termin",
      allDay: true,
      startTime: null,
      endTime: null,
      color: "#FFFFFF",
      note: null,
      revision: 1,
      createdAt: "",
      updatedAt: "",
      deletedAt: null,
    };
    const result = buildCalendarWidgetTimeline({
      entries: [appointment, shift({ deletedAt: "2026-12-31" })],
      now: NOW,
      hasProfile: true,
      timeZone: "Europe/Berlin",
      scheme: "pflegeshift",
    });
    expect(result[0].props.days[0].shifts).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("Private Termin");
  });
  it("distinguishes an empty day from an explicit free or vacation entry", () => {
    expect(timeline()[0].props.days[0].shifts).toEqual([]);
    const free = shift({ title: "Frei", type: "FREE", startTime: null, endTime: null });
    expect(timeline([free])[0].props.days[0].shifts[0]).toMatchObject({
      label: "F",
      start: "",
      end: "",
      nextDay: false,
    });
    expect(timeline([shift({ allDay: true })])[0].props.days[0].shifts[0].start).toBe("");
  });
  it.each([
    ["2026-03-28T12:00:00Z", 23],
    ["2026-10-24T12:00:00Z", 25],
  ])("schedules calendar midnights over daylight saving transition %s", (instant, hours) => {
    const result = timeline([], new Date(instant));
    expect(result[2].date.getTime() - result[1].date.getTime()).toBe(hours * 3600000);
  });
  it("uses the profile timezone rather than UTC or the phone timezone", () => {
    const now = new Date("2026-12-31T23:30:00Z");
    expect(timeline([], now)[0].props.todayDate).toBe("2027-01-01");
    expect(nextWidgetMidnight(now, "Europe/Berlin").toISOString()).toBe("2027-01-01T23:00:00.000Z");
  });
  it("expires the data instead of claiming future days are empty", () => {
    expect(timeline()[14].props).toMatchObject({
      days: [],
      weekDays: [],
      monthDays: [],
      state: "expired",
    });
    expect(timeline()[14].date.toISOString()).toBe("2027-01-13T23:00:00.000Z");
  });
  it("clears the previous calendar when there is no profile", () => {
    const result = timeline([shift()], NOW, false);
    expect(result).toHaveLength(1);
    expect(result[0].props).toMatchObject({ state: "setup", days: [] });
  });
  it("replaces edited, removed and restored shifts in the snapshot", () => {
    expect(timeline([shift({ startTime: "21:00" })])[0].props.days[0].shifts[0].start).toBe(
      "21:00",
    );
    expect(timeline([])[0].props.days[0].shifts).toEqual([]);
    expect(timeline([shift()])[0].props.days[0].shifts).toHaveLength(1);
  });
});

it("uses the app's chip colors, dimensions and shift detail in both themes", () => {
  const item = timeline([shift({ title: "Nacht", color: "#E74C55" })])[0].props;
  expect(item.chipStyle).toMatchObject({
    radius: 2,
    rowHeight: 17,
    fontSize: 12,
    textColor: "#FFFFFF",
  });
  expect(item.days[0].shifts[0]).toMatchObject({
    displayLabel: "Nacht",
    detail: "22:00",
    symbol: null,
    light: { main: "#E74C55", detail: "#F8CDCF", onDetail: "#171719" },
    dark: { main: "#E74C55", detail: "#5B2F33", onDetail: "#FFFFFF" },
  });
});
it("applies calendar label/time/duration preferences and a local photo reference", () => {
  const item = buildCalendarWidgetTimeline({
    entries: [shift()],
    now: NOW,
    timeZone: "Europe/Berlin",
    scheme: "pflegeshift",
    hasProfile: true,
    display: {
      labelMode: "SYMBOL",
      showShiftTimes: false,
      showShiftDuration: true,
      showShifts: true,
    },
    themeMode: "light",
    backgroundFileName: "luna-widget-calendar-one.jpg",
    backgroundStrength: "strong",
  })[0].props;
  expect(item).toMatchObject({
    themeMode: "light",
    backgroundFileName: "luna-widget-calendar-one.jpg",
    backgroundOpacity: 0.6,
  });
  expect(item.days[0].shifts[0]).toMatchObject({
    symbol: "moon",
    displayLabel: "moon",
    detail: "7:30 h",
    nextDay: true,
  });
  expect(JSON.stringify(item)).not.toMatch(/file:|Private Notiz/);
});
it("hides shifts consistently and clears the photo when no profile remains", () => {
  const options = {
    entries: [shift()],
    now: NOW,
    timeZone: "Europe/Berlin",
    scheme: "pflegeshift",
    display: {
      labelMode: "SHORT" as const,
      showShiftTimes: false,
      showShiftDuration: false,
      showShifts: false,
    },
    backgroundFileName: "luna-widget-calendar-one.jpg",
  };
  expect(
    buildCalendarWidgetTimeline({ ...options, hasProfile: true })[0].props.days[0].shifts,
  ).toEqual([]);
  expect(
    buildCalendarWidgetTimeline({ ...options, hasProfile: false })[0].props.backgroundFileName,
  ).toBeNull();
});
it("preserves custom symbol text and all-day label choices", () => {
  const options = {
    entries: [shift({ allDay: true, symbol: "X" })],
    now: NOW,
    timeZone: "Europe/Berlin",
    scheme: "pflegeshift",
    hasProfile: true,
    display: {
      labelMode: "SYMBOL" as const,
      showShiftTimes: true,
      showShiftDuration: false,
      showShifts: true,
    },
  };
  expect(buildCalendarWidgetTimeline(options)[0].props.days[0].shifts[0]).toMatchObject({
    displayLabel: "X",
    symbol: null,
    detail: "GT",
    start: "",
    end: "",
  });
  expect(
    buildCalendarWidgetTimeline({
      ...options,
      display: { ...options.display, labelMode: "SHORT", showShiftTimes: false },
    })[0].props.days[0].shifts[0],
  ).toMatchObject({ displayLabel: "N", detail: null });
});

it.each([
  ["2027-02-12T12:00:00Z", 28, "2027-02-01", "2027-02-28"],
  ["2028-02-12T12:00:00Z", 35, "2028-01-31", "2028-03-05"],
  ["2026-08-12T12:00:00Z", 42, "2026-07-27", "2026-09-06"],
])(
  "builds a whole month grid, including short, leap and six-row months %s",
  (instant, count, first, last) => {
    const props = timeline([], new Date(instant))[0].props;
    expect(props.monthDays).toHaveLength(count);
    expect(props.monthDays[0].date).toBe(first);
    expect(props.monthDays.at(-1)?.date).toBe(last);
    expect(props.monthDays.filter((day) => day.date.slice(0, 7) === props.month)).toHaveLength(
      instant.startsWith("2027-02") ? 28 : instant.startsWith("2028-02") ? 29 : 31,
    );
  },
);
it("queries all visible dates for each timeline entry, including the previous calendar week", () => {
  for (const instant of ["2026-08-30T22:30:00Z", "2026-12-31T23:30:00Z", "2028-02-28T12:00:00Z"]) {
    const now = new Date(instant),
      range = widgetEntryRange(now, "Europe/Berlin");
    const first = shift({ date: range.startDate }),
      last = shift({ id: "last", date: range.endDate });
    for (const entry of timeline([first, last], now).filter(
      (entry) => entry.props.state === "ready",
    )) {
      for (const day of [...entry.props.days, ...entry.props.weekDays, ...entry.props.monthDays]) {
        expect(day.date >= range.startDate && day.date <= range.endDate).toBe(true);
      }
    }
  }
});
