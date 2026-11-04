import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCalendarWidgetTimeline } from "../src/features/widgets/calendar-widget-data.ts";

const now = new Date("2026-12-31T12:00:00Z");
function shift(id = "own", extra = {}) {
  return {
    kind: "SHIFT",
    id,
    date: "2026-12-31",
    templateId: null,
    title: "Nachtdienst",
    type: "NIGHT",
    startTime: "22:00",
    endTime: "06:00",
    breakMinutes: 30,
    color: "#123456",
    symbol: "moon",
    note: "PRIVATE_NOTE",
    overtimeMinutes: 0,
    holidayPremiumMode: "WITH_TIME_OFF",
    revision: 1,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    deletedAt: null,
    ...extra,
  };
}
const appointment = {
  kind: "APPOINTMENT",
  id: "appointment",
  date: "2026-12-31",
  title: "Kontrolle",
  allDay: false,
  startTime: "10:00",
  endTime: "11:00",
  color: "#AA3377",
  note: "PRIVATE_NOTE",
  location: "PRIVATE_LOCATION",
  revision: 1,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  deletedAt: null,
};
const display = {
  labelMode: "FULL",
  showShiftTimes: true,
  showShiftDuration: false,
  showShifts: true,
  pastelColors: true,
  showAppointments: true,
  showHolidays: true,
  holidayColor: "ORANGE",
};
function props(extra = {}) {
  return buildCalendarWidgetTimeline({
    entries: [shift(), appointment],
    now,
    timeZone: "Europe/Berlin",
    scheme: "lunashift",
    hasProfile: true,
    display,
    dayLabels: new Map([["2026-12-31", "Silvester"]]),
    ...extra,
  })[0].props;
}
function day(value, grid = "days") {
  return value[grid].find((entry) => entry.date === "2026-12-31");
}
function shared() {
  const entry = (id, kind, from, to) => ({
    id,
    kind,
    title: id === "appointment" ? "Geteilter Termin" : "Geteilter Dienst",
    color: "#CCAA33",
    symbol: "sun",
    startsAt: from,
    endsAt: to,
    allDay: false,
    breakMinutes: 0,
    timeZone: "Europe/Berlin",
  });
  return {
    accountId: "reader",
    visible: true,
    fetchedAt: now.toISOString(),
    calendar: {
      id: "plan",
      ownerId: "other",
      name: "Loni",
      color: "#0088CC",
      visibility: "DETAILS",
      revision: 2,
      isOwner: false,
      publishedAt: now.toISOString(),
    },
    entries: [
      entry("appointment", "APPOINTMENT", "2026-12-31T07:00:00Z", "2026-12-31T08:00:00Z"),
      entry("shift", "SHIFT", "2026-12-31T13:00:00Z", "2026-12-31T21:00:00Z"),
    ],
  };
}
for (const grid of ["days", "weekDays", "monthDays"]) {
  test("accepted widget data survives in " + grid, () => {
    const value = props(),
      current = day(value, grid);
    assert.equal(value.pastelColors, true);
    assert.notEqual(current.shifts[0].light.main, "#123456");
    assert.notEqual(current.shifts[0].dark.main, "#123456");
    assert.equal(current.appointments[0].title, "Kontrolle");
    assert.equal(current.dayLabel, "Silvester");
    assert.ok(current.tint.light);
    assert.ok(current.tint.dark);
    assert.equal(current.shifts[0].nextDay, true);
    assert.equal(JSON.stringify(value).includes("PRIVATE_"), false);
  });
}
test("shared appointments cannot replace the actual shared shift", () => {
  const value = day(props({ entries: [], sharedCalendars: [shared()] }));
  assert.equal(value.shifts[0].title, "Geteilter Dienst");
  assert.equal(value.appointments[0].title, "Geteilter Termin");
  assert.equal(value.appointments[0].ownerName, "Loni");
});
test("hiding appointments removes own and shared appointments without losing the shared shift", () => {
  const value = props({
    entries: [appointment],
    sharedCalendars: [shared()],
    display: { ...display, showAppointments: false },
  });
  for (const grid of ["days", "weekDays", "monthDays"]) {
    const current = day(value, grid);
    assert.deepEqual(current.appointments, []);
    assert.equal(current.shifts[0].title, "Geteilter Dienst");
  }
});
test("own shifts remain preferred over shared shifts and multiple own shifts remain present", () => {
  const value = day(props({ entries: [shift(), shift("second")], sharedCalendars: [shared()] }));
  assert.equal(value.shifts.length, 2);
  assert.ok(value.shifts.every((entry) => !entry.ownerName));
  const hidden = day(
    props({
      entries: [shift()],
      sharedCalendars: [shared()],
      display: { ...display, showShifts: false },
    }),
  );
  assert.equal(hidden.shifts.length, 0);
});
test("original colors, background and theme remain usable", () => {
  const value = props({
    display: { ...display, pastelColors: false },
    themeMode: "dark",
    backgroundFileName: "luna-widget-calendar-one.jpg",
    backgroundStrength: "strong",
  });
  assert.equal(day(value).shifts[0].light.main, "#123456");
  assert.equal(value.themeMode, "dark");
  assert.equal(value.backgroundFileName, "luna-widget-calendar-one.jpg");
  assert.equal(value.backgroundOpacity, 0.6);
});
test("hidden holiday labels stay hidden while weekend tint data remains available", () => {
  const value = props({ display: { ...display, showHolidays: false } });
  assert.equal(day(value).dayLabel, undefined);
  const saturday = value.days.find((entry) => entry.date === "2027-01-02");
  assert.ok(saturday.tint.light);
});
