import { calculateMonthlyCompliance } from "./compliance";
import { selectMonthlyAnalysisEntries } from "@/features/analysis/analysis-data";
import {
  projectDutyCalendarDays,
  projectDutyWork,
  projectRegularPayShifts,
  specialDutyOpenItems,
} from "./special-duty";
import { describe, expect, it } from "vitest";
import {
  newSpecialDuty,
  plannedSpecialDuty,
  validateDutyParent,
  validateSpecialDuty,
} from "@/domain/special-duty";
import type { ShiftEntry } from "@/domain/types";
import { calculateTimedShiftMinutes } from "./working-time";
import { calculateTimedDailyWorkCredit } from "./daily-summary";

const base: ShiftEntry = {
  kind: "SHIFT",
  id: "duty",
  date: "2026-10-29",
  templateId: null,
  title: "Dienst",
  type: "CUSTOM",
  startTime: "06:00",
  endTime: "10:00",
  breakMinutes: 0,
  color: "#123456",
  symbol: "D",
  note: null,
  overtimeMinutes: 0,
  holidayPremiumMode: "WITH_TIME_OFF",
  revision: 1,
  createdAt: "2026-10-29T00:00:00Z",
  updatedAt: "2026-10-29T00:00:00Z",
  deletedAt: null,
};
const split = {
  ...base,
  specialDuty: {
    ...newSpecialDuty("SPLIT", "06:00", "10:00", "Europe/Berlin"),
    parts: [{ start: 960, end: 1200, breakMinutes: 0 }],
  },
};

describe("special duty intervals", () => {
  it("keeps on-call uncertainty visible even when no work has been entered", () => {
    const shift = {
      ...base,
      specialDuty: newSpecialDuty("ON_CALL", "06:00", "10:00", "Europe/Berlin"),
    };
    expect(
      calculateMonthlyCompliance("2026-10", [shift], "Europe/Berlin").issues.some(
        (issue) => issue.rule === "SPECIAL_DUTY_REVIEW",
      ),
    ).toBe(true);
  });
  it("allocates a callout across the month boundary without losing its parent", () => {
    const shift = {
      ...base,
      date: "2026-10-31",
      startTime: "18:00",
      endTime: "08:00",
      specialDuty: {
        ...newSpecialDuty("ON_CALL", "18:00", "08:00", "Europe/Berlin"),
        callouts: [
          {
            kind: "REMOTE" as const,
            start: 1430,
            end: 1460,
            departure: 1430,
            returned: 1460,
            breakMinutes: 0,
          },
        ],
      },
    };
    expect(selectMonthlyAnalysisEntries([shift], "2026-11").monthShifts).toEqual([shift]);
    const slices = projectDutyCalendarDays([shift]);
    expect(
      slices.map((part) => [part.date, calculateTimedShiftMinutes(part, "Europe/Berlin")]),
    ).toEqual([
      ["2026-10-31", 10],
      ["2026-11-01", 20],
    ]);
  });

  it("counts two parts as eight hours and leaves the interruption free", () => {
    expect(calculateTimedShiftMinutes(split, "Europe/Berlin")).toBe(480);
    expect(
      calculateTimedDailyWorkCredit(base.date, [split], { timeZone: "Europe/Berlin" })
        .actualMinutes,
    ).toBe(480);
    expect(projectRegularPayShifts([split]).map((part) => [part.startTime, part.endTime])).toEqual([
      ["06:00", "10:00"],
      ["16:00", "20:00"],
    ]);
    const midday = { ...base, id: "other", startTime: "12:00", endTime: "14:00" };
    expect(
      calculateTimedDailyWorkCredit(base.date, [split, midday], { timeZone: "Europe/Berlin" })
        .actualMinutes,
    ).toBe(600);
  });
  it("records zero work for on call without events, without claiming complete payroll", () => {
    const shift = {
      ...base,
      specialDuty: newSpecialDuty("ON_CALL", "06:00", "10:00", "Europe/Berlin"),
    };
    expect(calculateTimedShiftMinutes(shift, "Europe/Berlin")).toBe(0);
    expect(projectRegularPayShifts([shift])).toEqual([]);
    expect(specialDutyOpenItems([shift], "2026-10")).toHaveLength(2);
  });
  it("keeps actual callouts and travel unrounded across midnight", () => {
    const shift = {
      ...base,
      startTime: "18:00",
      endTime: "08:00",
      specialDuty: {
        ...newSpecialDuty("ON_CALL", "18:00", "08:00", "Europe/Berlin"),
        callouts: [
          {
            kind: "ON_SITE" as const,
            departure: 1430,
            start: 1445,
            end: 1470,
            returned: 1480,
            breakMinutes: 0,
          },
        ],
      },
    };
    validateDutyParent(validateSpecialDuty(shift.specialDuty), shift);
    expect(calculateTimedShiftMinutes(shift, "Europe/Berlin")).toBe(50);
    expect(projectDutyWork(shift)[0].startTime).toBe("23:50");
    expect(plannedSpecialDuty(shift.specialDuty)?.callouts).toEqual([]);
  });
  it("counts the entire standby for protection, never normal premiums", () => {
    const shift = {
      ...base,
      startTime: "20:00",
      endTime: "08:00",
      specialDuty: newSpecialDuty("STANDBY", "20:00", "08:00", "Europe/Berlin"),
    };
    expect(calculateTimedShiftMinutes(shift, "Europe/Berlin")).toBe(720);
    expect(projectRegularPayShifts([shift])).toEqual([]);
  });
  it("uses elapsed time over DST and rejects ambiguous timestamps", () => {
    const shift = {
      ...base,
      date: "2026-10-24",
      startTime: "20:00",
      endTime: "08:00",
      specialDuty: newSpecialDuty("STANDBY", "20:00", "08:00", "Europe/Berlin"),
    };
    expect(calculateTimedShiftMinutes(shift, "Europe/Berlin")).toBe(780);
    expect(() => validateDutyParent(shift.specialDuty, { ...shift, endTime: "02:30" })).toThrow();
  });
  it("rejects overlapping parts and calls outside their parent", () => {
    expect(() =>
      validateSpecialDuty({
        ...split.specialDuty,
        parts: [
          { start: 600, end: 700, breakMinutes: 0 },
          { start: 650, end: 750, breakMinutes: 0 },
        ],
      }),
    ).toThrow();
    expect(() =>
      validateDutyParent(
        { ...split.specialDuty, parts: [{ start: 500, end: 700, breakMinutes: 0 }] },
        base,
      ),
    ).toThrow();
    expect(() => validateSpecialDuty({ ...split.specialDuty, extra: true })).toThrow();
  });
});
