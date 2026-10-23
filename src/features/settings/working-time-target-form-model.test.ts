import { describe, expect, it } from "vitest";
import { decemberTargetContext } from "@/domain/working-time-target-test-fixtures";
import {
  parseTargetMinutes,
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
