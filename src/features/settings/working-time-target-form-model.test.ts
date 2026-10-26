import { describe, expect, it } from "vitest";
import type { ShiftEntry } from "@/domain/types";
import { work } from "@/engine/remuneration-test-fixtures";
import { decemberTargetContext } from "@/domain/working-time-target-test-fixtures";
import {
  targetDayDraftFromCalendar,
  employmentTargetTariff,
  parseTargetMinutes,
  parseTargetWeeklyHours,
  targetWeeklyHoursText,
  targetDateText,
  parseTargetDate,
  putTargetPeriod,
  targetMinutesText,
} from "./working-time-target-form-model";

describe("working time target editor history", () => {
  it("accepts exact integer minutes and rejects ambiguous decimal or malformed input", () => {
    expect(parseTargetMinutes("38:30")).toBe(2310);
    expect(targetMinutesText(462)).toBe("7:42");
    for (const value of ["38,5", "38:60", "-1:00", "7:4", "", "169:00"])
      expect(() => parseTargetMinutes(value)).toThrow();
  });
  it("splits a dated model change without rewriting the preceding period", () => {
    const result = putTargetPeriod(decemberTargetContext, {
      ...decemberTargetContext.periods[0],
      validFrom: "2026-12-15",
      weeklyMinutes: 1920,
    });
    expect(
      result.periods.map((period) => [period.validFrom, period.validTo, period.weeklyMinutes]),
    ).toEqual([
      ["2026-12-01", "2026-12-14", 2310],
      ["2026-12-15", null, 1920],
    ]);
    expect(result.days).toEqual(decemberTargetContext.days);
  });
  it("preserves an already confirmed future change", () => {
    const future = putTargetPeriod(decemberTargetContext, {
      ...decemberTargetContext.periods[0],
      validFrom: "2027-01-01",
      weeklyMinutes: 1800,
    });
    const inserted = putTargetPeriod(future, {
      ...decemberTargetContext.periods[0],
      validFrom: "2026-12-15",
      weeklyMinutes: 1920,
    });
    expect(inserted.periods.map((period) => [period.validFrom, period.validTo])).toEqual([
      ["2026-12-01", "2026-12-14"],
      ["2026-12-15", "2026-12-31"],
      ["2027-01-01", null],
    ]);
    expect(inserted.periods[2].weeklyMinutes).toBe(1800);
  });
  it("retains the previous model after an explicitly temporary change", () => {
    const result = putTargetPeriod(decemberTargetContext, {
      ...decemberTargetContext.periods[0],
      validFrom: "2026-12-15",
      validTo: "2026-12-20",
      weeklyMinutes: 1920,
    });
    expect(
      result.periods.map((period) => [period.validFrom, period.validTo, period.weeklyMinutes]),
    ).toEqual([
      ["2026-12-01", "2026-12-14", 2310],
      ["2026-12-15", "2026-12-20", 1920],
      ["2026-12-21", null, 2310],
    ]);
  });
  it("corrects only an existing start date and rejects overlaps with future history", () => {
    const future = putTargetPeriod(decemberTargetContext, {
      ...decemberTargetContext.periods[0],
      validFrom: "2027-01-01",
    });
    expect(
      putTargetPeriod(future, { ...future.periods[0], weeklyMinutes: 1920 }).periods[1],
    ).toEqual(future.periods[1]);
    expect(() =>
      putTargetPeriod(future, { ...decemberTargetContext.periods[0], validTo: "2027-02-01" }),
    ).toThrow();
  });
});

describe("friendly working-time input without changing stored data", () => {
  it.each([
    ["38,5", 2310],
    ["38.5", 2310],
    ["38:30", 2310],
    ["32", 1920],
    ["38,51", 2311],
    ["38,49", 2309],
  ] as const)("reads %s as %i integer minutes", (value, minutes) => {
    expect(parseTargetWeeklyHours(value)).toBe(minutes);
  });
  it("retains every existing minute value when decimal weekly hours are displayed and resaved", () => {
    for (let minutes = 1; minutes <= 10080; minutes++)
      expect(parseTargetWeeklyHours(targetWeeklyHoursText(minutes))).toBe(minutes);
  });
  it.each(["", "-38,5", "38,5,0", "38.501", "169", "NaN"])(
    "rejects invalid weekly input %s",
    (value) => {
      expect(() => parseTargetWeeklyHours(value)).toThrow();
    },
  );
  it.each([
    ["01.01.2026", "2026-01-01"],
    ["1.1.2026", "2026-01-01"],
    ["2026-12-31", "2026-12-31"],
    ["29.02.2028", "2028-02-29"],
  ])("reads %s as ISO %s", (value, iso) => {
    expect(parseTargetDate(value)).toBe(iso);
  });
  it("displays stored dates without a timezone conversion", () => {
    expect(targetDateText("2026-12-31")).toBe("31.12.2026");
    expect(targetDateText(null)).toBe("");
  });
  it.each(["", "29.02.2026", "31.04.2026", "01.01.26", "2026-02-30"])(
    "rejects invalid or ambiguous date %s",
    (value) => {
      expect(() => parseTargetDate(value)).toThrow();
    },
  );
});

describe("employment data reuse without inferred claims", () => {
  it("takes BT-K from the existing profile while leaving eligibility unconfirmed", () => {
    expect(employmentTargetTariff(work)).toEqual({
      kind: "TVOED_K",
      version: "2026-01-01",
      scopeConfirmed: null,
    });
  });
  it("never imports the BT-K rule for BT-B or own salary", () => {
    expect(
      employmentTargetTariff({ ...work, tariff: { ...work.tariff!, sector: "BT_B" } }),
    ).toEqual({ kind: "TVOED_B", version: "2026-01-01", scopeConfirmed: null });
    expect(
      employmentTargetTariff({ ...work, tariff: null, manualMonthlyGrossCents: 400000 }),
    ).toEqual({ kind: "UNVERIFIED", id: "OWN_SALARY" });
  });
  it("keeps a conflicting salary selection unresolved", () => {
    expect(
      employmentTargetTariff({ ...work, salaryBasisConflict: { tariff: work.tariff } }),
    ).toEqual({ kind: "UNVERIFIED", id: "SALARY_CONFLICT" });
  });
});

describe("calendar suggestions for pending working-time questions", () => {
  const duty: ShiftEntry = {
    kind: "SHIFT",
    id: "duty",
    date: "2026-12-24",
    templateId: null,
    title: "Dienst",
    type: "NIGHT",
    startTime: "21:00",
    endTime: "07:00",
    breakMinutes: 30,
    color: "#123456",
    symbol: "N",
    note: null,
    overtimeMinutes: 0,
    holidayPremiumMode: "WITH_TIME_OFF",
    revision: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
  };
  it("leaves a blank calendar date and all entitlement conditions unknown", () => {
    expect(targetDayDraftFromCalendar("2026-12-24", [], work.timeZone)).toEqual({
      date: "2026-12-24",
      rosterStatus: "DRAFT",
      disposition: "UNKNOWN",
      lostMinutes: null,
      mustWorkElsewhere: null,
    });
  });
  it("reuses entered night duty on its start date and the following holiday", () => {
    for (const date of ["2026-12-24", "2026-12-25"])
      expect(targetDayDraftFromCalendar(date, [duty], work.timeZone)).toMatchObject({
        rosterStatus: "DRAFT",
        disposition: "WORK_REQUIRED",
        lostMinutes: null,
        mustWorkElsewhere: null,
      });
  });
  it("distinguishes explicit roster-free entries from an empty date and handles conflicts", () => {
    const free: ShiftEntry = {
      ...duty,
      id: "free",
      type: "FREE",
      startTime: null,
      endTime: null,
      date: "2026-12-25",
    };
    expect(targetDayDraftFromCalendar(free.date, [free], work.timeZone).disposition).toBe(
      "ROSTER_FREE",
    );
    expect(targetDayDraftFromCalendar(free.date, [free, duty], work.timeZone).disposition).toBe(
      "UNKNOWN",
    );
    expect(
      targetDayDraftFromCalendar(free.date, [{ ...free, type: "SICK" }], work.timeZone).disposition,
    ).toBe("UNKNOWN");
    expect(
      targetDayDraftFromCalendar(free.date, [{ ...free, deletedAt: work.updatedAt }], work.timeZone)
        .disposition,
    ).toBe("UNKNOWN");
  });
});
