import { describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { calculateMonthlyPayEstimate } from "@/engine/simple-pay";
import { calculateAutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import {
  salaryServiceDate,
  salaryServiceRows,
  salaryShiftTime,
} from "./salary-service-presentation";

describe("salary service presentation", () => {
  it.each([
    ["2026-10-05", "Mo. 05.10."],
    ["2026-10-06", "Di. 06.10."],
    ["2026-10-07", "Mi. 07.10."],
    ["2026-10-08", "Do. 08.10."],
    ["2026-10-09", "Fr. 09.10."],
    ["2026-10-10", "Sa. 10.10."],
    ["2026-10-11", "So. 11.10."],
    ["2024-02-29", "Do. 29.02."],
    ["2026-12-31", "Do. 31.12."],
    ["2027-01-01", "Fr. 01.01."],
  ])("formats %s independently of runtime localization", (date, expected) => {
    const locale = vi
      .spyOn(Temporal.PlainDate.prototype, "toLocaleString")
      .mockImplementation(() => {
        throw new RangeError("Unsupported runtime localization");
      });
    try {
      expect(salaryServiceDate(date, true)).toBe(expected);
      expect(salaryServiceDate(date)).toBe(expected.slice(4));
      expect(locale).not.toHaveBeenCalled();
    } finally {
      locale.mockRestore();
    }
  });
  it("marks midnight, equal clock times and the year change without altering shift times", () => {
    const night = forecastShift({ date: "2026-12-31", startTime: "21:00", endTime: "07:30" });
    expect(salaryShiftTime(night)).toEqual({
      interval: "21:00–07:30",
      endDate: "2027-01-01",
      nextDay: true,
    });
    expect(salaryShiftTime(forecastShift({ startTime: "08:00", endTime: "16:00" })).nextDay).toBe(
      false,
    );
    expect(salaryShiftTime(forecastShift({ startTime: "08:00", endTime: "08:00" })).nextDay).toBe(
      true,
    );
    expect(night.date).toBe("2026-12-31");
  });
  it("shows all-day and missing shifts safely", () => {
    expect(salaryShiftTime(forecastShift({ startTime: null, endTime: null })).interval).toBe(
      "Ganztägig",
    );
    expect(salaryShiftTime(undefined).endDate).toBeNull();
  });
  it("preserves existing classification amounts and sorts by date without mutating results", () => {
    const shifts = [
      forecastShift({ id: "late", date: "2026-07-12" }),
      forecastShift({ id: "early", date: "2026-07-05" }),
    ];
    const pay = calculateMonthlyPayEstimate("2026-07", shifts, forecastProfile, null, shifts);
    const forecast = calculateAutomaticNetPayForecast(
      {
        month: "2026-07",
        profile: forecastProfile,
        settings: automatedSettings("2026-06"),
        shifts,
        pay,
      },
      bundledRuleResolver,
    );
    if (forecast.result.status !== "available") throw new Error("Fixture unavailable");
    const classification = forecast.result.classification;
    const before = JSON.stringify({ pay, classification });
    const rows = salaryServiceRows(pay, classification, shifts);
    expect(rows.map((row) => row.id)).toEqual(["early", "late"]);
    expect(rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(
      classification.paidPremiumCents,
    );
    expect(rows.every((row) => row.amountCents === row.tax!.paidPremiumCents)).toBe(true);
    expect(JSON.stringify({ pay, classification })).toBe(before);
    expect(salaryServiceRows(pay, null, shifts).every((row) => row.tax === null)).toBe(true);
  });
  it("keeps empty months empty without inventing tax-free shares", () => {
    const pay = calculateMonthlyPayEstimate("2026-07", [], forecastProfile, null, []);
    expect(salaryServiceRows(pay, null, [])).toEqual([]);
  });
});
