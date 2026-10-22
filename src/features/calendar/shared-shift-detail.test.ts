import { describe, expect, it } from "vitest";
import type { ShiftEntry } from "@/domain/types";
import { projectSharingEntries } from "@/engine/sharing-projection";
import { calendarShiftDetail } from "./calendar-display";
import { sharedShiftDetail } from "./shared-shift-detail";

const shift = {
  kind: "SHIFT",
  id: "local",
  date: "2026-10-24",
  type: "NIGHT",
  title: "Nacht",
  allDay: false,
  startTime: "21:00",
  endTime: "07:30",
  breakMinutes: 60,
  color: "#123456",
  symbol: "moon",
  deletedAt: null,
} as ShiftEntry;
const share = (source: ShiftEntry) =>
  projectSharingEntries([source], {
    timeZone: "Europe/Berlin",
    visibility: "DETAILS",
    publicId: () => "10000000-0000-4000-8000-000000000001",
  })[0];

describe("shared and own net duration parity", () => {
  it.each([
    ["2026-10-20", "06:00", "14:12", 30, "7:42 h"],
    ["2026-10-20", "21:00", "07:30", 60, "9:30 h"],
    ["2026-03-28", "21:00", "07:30", 60, "8:30 h"],
    ["2026-10-24", "21:00", "07:30", 60, "10:30 h"],
    ["2026-10-25", "01:30", "02:30", 0, "2:00 h"],
    ["2026-10-25", "02:30", "03:30", 30, "1:30 h"],
    ["2026-10-20", "06:00", "07:00", 90, "0:00 h"],
  ] as const)(
    "matches own shifts on %s %s–%s with %s minutes of pause",
    (date, startTime, endTime, breakMinutes, expected) => {
      const own = { ...shift, date, startTime, endTime, breakMinutes };
      const shared = share(own);
      for (const showShiftTimes of [false, true])
        for (const showShiftDuration of [false, true]) {
          const display = { showShiftTimes, showShiftDuration, timeZone: "Europe/Berlin" };
          expect(sharedShiftDetail(shared, startTime, display)).toBe(
            calendarShiftDetail(own, display),
          );
        }
      expect(
        sharedShiftDetail(shared, startTime, { showShiftTimes: false, showShiftDuration: true }),
      ).toBe(expected);
    },
  );
  it("retains all-day display semantics", () => {
    const own = { ...shift, allDay: true, startTime: null, endTime: null };
    for (const showShiftTimes of [false, true])
      for (const showShiftDuration of [false, true]) {
        const display = { showShiftTimes, showShiftDuration, timeZone: "Europe/Berlin" };
        expect(sharedShiftDetail(share(own), "", display)).toBe(calendarShiftDetail(own, display));
      }
  });
  it.each([undefined, null, -1, 1.5, 2881, Number.NaN])(
    "does not invent an exact net duration when pause is %s",
    (breakMinutes) => {
      expect(
        sharedShiftDetail({ ...share(shift), breakMinutes }, "21:00", {
          showShiftTimes: false,
          showShiftDuration: true,
        }),
      ).toBe("–");
    },
  );
});
