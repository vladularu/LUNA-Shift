import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { settings } from "@/domain/net-pay-profile-test-fixtures";
import type { UserProfile } from "@/domain/types";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { calculateMonthlyNetPay } from "./net-pay";
import { calculateTvoedNetPayForecast } from "./net-pay-tvoed-forecast";
import { forecastProfile, forecastShift } from "./net-pay-tvoed-forecast-test-fixtures";
import {
  calculateMonthlyPayEstimate,
  calculateShiftPremiumBreakdown,
  calculateTvoedShiftPremiumTrace,
} from "./simple-pay";

function input() {
  const shifts = [forecastShift()];
  return {
    month: "2026-07",
    profile: forecastProfile,
    settings: { ...settings(), sfnBasicHourlyPayCents: 100 },
    shifts,
    pay: calculateMonthlyPayEstimate("2026-07", shifts, forecastProfile, null),
    regularMonthlySocialInsuranceGrossCents: 400000,
    assumptionsConfirmed: true,
  };
}
function minutes(start: string, end: string) {
  return (
    Number(
      Temporal.Instant.from(end).epochMilliseconds - Temporal.Instant.from(start).epochMilliseconds,
    ) / 60000
  );
}

describe("automatic TVöD-P SFN forecast", () => {
  it("keeps the salary calculation identical and traces the midpoint pause and night minutes", () => {
    const shift = forecastShift();
    const trace = calculateTvoedShiftPremiumTrace(shift, forecastProfile);
    expect(trace.breakdown).toEqual(calculateShiftPremiumBreakdown(shift, forecastProfile));
    expect(trace.unpaidBreaks).toEqual([
      { start: "2026-07-06T01:30+02:00", end: "2026-07-06T02:30+02:00" },
    ]);
    expect(trace.premiums.find((item) => item.premiumType === "NIGHT")!.periods).toEqual([
      { start: "2026-07-05T21:00+02:00", end: "2026-07-06T01:30+02:00" },
      { start: "2026-07-06T02:30+02:00", end: "2026-07-06T06:00+02:00" },
    ]);
  });
  it("applies independent statutory minute caps to paid Sunday and night intervals", () => {
    const result = calculateTvoedNetPayForecast(input(), bundledRuleResolver);
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    // Sunday 21–24: 150c. Night 21–24:75c, 00–04 minus one-hour pause:120c, 04–06:50c.
    expect(result.classification.taxFreeCents).toBe(395);
    expect(result.classification.socialInsuranceFreeCents).toBe(395);
    expect(result.classification.workEvidence).toBe("PLANNED");
    expect(result.pay.amounts.taxableGrossCents).toBe(result.pay.amounts.grossCents - 395);
    const fullyLiable = calculateMonthlyNetPay({
      month: "2026-07",
      profile: settings().profile,
      specialCases: [],
      amounts: {
        ...result.pay.amounts,
        taxableGrossCents: result.pay.amounts.grossCents,
        socialInsuranceGrossCents: result.pay.amounts.grossCents,
      },
    });
    expect(fullyLiable.status).toBe("available");
    if (fullyLiable.status === "available")
      expect(result.pay.netCents).toBeGreaterThan(fullyLiable.netCents);
  });
  it.each(["2026-03-28", "2026-10-24"])(
    "preserves elapsed paid minutes through the offset change on %s",
    (date) => {
      const shift = forecastShift({ date, breakMinutes: 0 });
      const trace = calculateTvoedShiftPremiumTrace(shift, forecastProfile);
      expect(trace.breakdown).toEqual(calculateShiftPremiumBreakdown(shift, forecastProfile));
      for (const item of trace.premiums)
        expect(item.periods.reduce((sum, range) => sum + minutes(range.start, range.end), 0)).toBe(
          item.line.minutes,
        );
      expect(trace.start.slice(-6)).not.toBe(trace.end.slice(-6));
    },
  );
  it.each(["2026-05-01", "2026-12-24", "2026-12-25", "2026-12-31"])(
    "reconciles holiday and pre-holiday rules on %s",
    (date) => {
      const shift = forecastShift({ date, startTime: "13:00", endTime: "21:00", breakMinutes: 0 });
      const month = date.slice(0, 7);
      const pay = calculateMonthlyPayEstimate(month, [shift], forecastProfile, null);
      const result = calculateTvoedNetPayForecast(
        {
          ...input(),
          month,
          shifts: [shift],
          pay,
          settings: { ...settings(month), sfnBasicHourlyPayCents: 100 },
        },
        bundledRuleResolver,
      );
      expect(result.status).toBe("available");
      if (result.status === "available") {
        expect(result.classification.taxFreeCents).toBeGreaterThan(0);
        expect(result.classification.paidPremiumCents).toBe(
          Math.round(pay.timePremiumAmount * 100),
        );
      }
    },
  );
  it("does not exempt Saturday premiums, overtime or monthly allowances", () => {
    const shift = forecastShift({
      date: "2026-07-04",
      startTime: "09:00",
      endTime: "18:00",
      breakMinutes: 60,
      overtimeMinutes: 60,
      tariffOvertimeConfirmed: true,
    });
    const pay = calculateMonthlyPayEstimate("2026-07", [shift], forecastProfile, null);
    const result = calculateTvoedNetPayForecast(
      { ...input(), shifts: [shift], pay },
      bundledRuleResolver,
    );
    expect(pay.timePremiumAmount).toBeGreaterThan(0);
    expect(pay.overtimeAmount).toBeGreaterThan(0);
    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.classification.taxFreeCents).toBe(0);
      expect(result.pay.amounts.taxableGrossCents).toBe(result.pay.amounts.grossCents);
    }
  });
  it("uses separate tax and SV caps above 25 euros basic hourly pay", () => {
    const profile: UserProfile = {
      ...forecastProfile,
      tariff: { ...forecastProfile.tariff!, payGroup: "P16", payLevel: 6 },
    };
    const shifts = [
      forecastShift({
        date: "2026-05-14",
        startTime: "09:00",
        endTime: "18:00",
        holidayPremiumMode: "WITHOUT_TIME_OFF",
      }),
    ];
    const pay = calculateMonthlyPayEstimate("2026-05", shifts, profile, null);
    const result = calculateTvoedNetPayForecast(
      {
        ...input(),
        month: "2026-05",
        profile,
        shifts,
        pay,
        settings: { ...settings("2026-05"), sfnBasicHourlyPayCents: 5000 },
      },
      bundledRuleResolver,
    );
    expect(result.status).toBe("available");
    if (result.status === "available")
      expect(result.classification.taxFreeCents).toBeGreaterThan(
        result.classification.socialInsuranceFreeCents,
      );
  });
  it.each([
    { assumptionsConfirmed: false },
    { settings: { ...settings(), sfnBasicHourlyPayCents: null } },
    { settings: { ...settings("2026-08"), sfnBasicHourlyPayCents: 100 } },
    { regularMonthlySocialInsuranceGrossCents: 190000 },
    { profile: { ...forecastProfile, holidayRegion: "UNKNOWN" as const } },
    { profile: { ...forecastProfile, timeZone: "UTC" } },
    {
      settings: {
        ...settings(),
        sfnBasicHourlyPayCents: 100,
        specialCases: ["ADDITIONAL_DEDUCTIONS" as const],
      },
    },
  ])("fails closed for missing, incompatible or unsupported data %#", (change) => {
    expect(
      calculateTvoedNetPayForecast({ ...input(), ...change }, bundledRuleResolver).status,
    ).toBe("unavailable");
  });
  it.each([
    "tvlKrTariff",
    "tvhKrTariff",
    "tvUkNursingTariff",
    "vkaETariff",
    "nursingTrainingTariff",
    "tvalPflegeTariff",
  ] as const)("blocks another active tariff path %s", (key) => {
    const profile = { ...forecastProfile, [key]: {} } as UserProfile;
    expect(calculateTvoedNetPayForecast({ ...input(), profile }, bundledRuleResolver).status).toBe(
      "unavailable",
    );
  });
  it("rejects a changed gross, premium sum or per-shift breakdown", () => {
    const value = input();
    for (const pay of [
      { ...value.pay, estimatedGrossAmount: value.pay.estimatedGrossAmount! + 1 },
      {
        ...value.pay,
        shiftBreakdowns: value.pay.shiftBreakdowns.map((item) => ({
          ...item,
          netMinutes: item.netMinutes - 1,
        })),
      },
      {
        ...value.pay,
        timePremiumAmount: value.pay.timePremiumAmount + 1,
        estimatedGrossAmount: value.pay.estimatedGrossAmount! + 1,
      },
    ])
      expect(calculateTvoedNetPayForecast({ ...value, pay }, bundledRuleResolver).status).toBe(
        "unavailable",
      );
  });
  it("keeps a cross-month night in its salary month without adding it to the following month", () => {
    const boundary = forecastShift({ date: "2026-07-31" });
    const next = forecastShift({ id: "next-month-night", date: "2026-08-01" });
    for (const [month, monthlyShifts] of [
      ["2026-07", [boundary]],
      ["2026-08", [next]],
    ] as const) {
      const pay = calculateMonthlyPayEstimate(month, monthlyShifts, forecastProfile, null);
      const result = calculateTvoedNetPayForecast(
        {
          ...input(),
          month,
          pay,
          shifts: [boundary, next],
          settings: { ...settings(month), sfnBasicHourlyPayCents: 100 },
        },
        bundledRuleResolver,
      );
      expect(result.status).toBe("available");
      if (result.status !== "available") throw new Error(result.reason);
      expect(result.classification.shifts.map((s) => s.shiftId)).toEqual(
        monthlyShifts.map((s) => s.id),
      );
      expect(result.classification.paidPremiumCents).toBe(Math.round(pay.timePremiumAmount * 100));
      expect(result.pay.amounts.grossCents).toBe(Math.round(pay.estimatedGrossAmount! * 100));
    }
  });
  it.each([{ startTime: null }, { allDay: true }, { breakMinutes: -1 }, { breakMinutes: 600 }])(
    "rejects incomplete work intervals %#",
    (change) => {
      const shifts = [forecastShift(change)];
      const pay = calculateMonthlyPayEstimate("2026-07", shifts, forecastProfile, null);
      expect(
        calculateTvoedNetPayForecast({ ...input(), shifts, pay }, bundledRuleResolver).status,
      ).toBe("unavailable");
    },
  );
});
