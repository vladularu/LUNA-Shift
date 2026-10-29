import { describe, expect, it } from "vitest";
import { newSpecialDuty } from "@/domain/special-duty";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { forecastProfile, forecastShift } from "./net-pay-tvoed-forecast-test-fixtures";
import { bundledRuleResolver as resolver } from "@/rules/rule-resolver";
import { calculateSpecialDutyPay } from "./special-duty-pay";
import { calculateMonthlyPayEstimate } from "./simple-pay";
import { calculateAutomaticNetPayForecast } from "./net-pay-automatic-forecast";
import { calculateMonthlySummary } from "./monthly-summary";

const base: UserProfile = { ...forecastProfile, tariff: null };
const models: readonly [string, UserProfile][] = [
  ["TVöD-P", forecastProfile],
  [
    "TVöD-E",
    {
      ...base,
      vkaETariff: { payGroup: "E9b", payLevel: 4, sector: "BT_K", tariffRegion: "OTHER" },
    },
  ],
  ["TV-L", { ...base, tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" } }],
  [
    "TV-H",
    {
      ...base,
      federalState: "HE",
      tvhKrTariff: { payGroup: "KR8", payLevel: 4, fullTimeWeeklyMinutes: 2310 },
    },
  ],
  ["TV-UK", { ...base, federalState: "BW", tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 } }],
  [
    "TVAöD",
    { ...base, nursingTrainingTariff: { trainingYear: 1, sector: "BT_K", tariffRegion: "OTHER" } },
  ],
  [
    "TVA-L",
    {
      ...base,
      tvalPflegeTariff: { trainingYear: 1, universityRegion: "WEST", employerScope: "SECTION_43" },
    },
  ],
];
function duty(overrides: Partial<ShiftEntry> = {}) {
  return forecastShift({
    date: "2026-07-07",
    type: "CUSTOM",
    startTime: "06:00",
    endTime: "18:00",
    breakMinutes: 0,
    specialDuty: {
      ...newSpecialDuty("ON_CALL", "06:00", "18:00", "Europe/Berlin"),
      calloutsComplete: true,
    },
    ...overrides,
  });
}
describe("on-call base remuneration", () => {
  it.each(models)(
    "integrates confirmed no-call duties for %s into fully taxable gross and net",
    (_label, profile) => {
      const shift = duty();
      const pay = calculateMonthlyPayEstimate("2026-07", [shift], profile, null);
      const without = calculateMonthlyPayEstimate("2026-07", [], profile, null);
      expect(pay.available).toBe(true);
      expect(pay.specialDutyBreakdowns?.[0].complete).toBe(true);
      expect(pay.specialDutyAmount).toBeGreaterThan(0);
      expect(Math.round((pay.estimatedGrossAmount! - without.estimatedGrossAmount!) * 100)).toBe(
        Math.round(pay.specialDutyAmount! * 100),
      );
      expect(pay.timePremiumAmount).toBe(0);
      const forecast = calculateAutomaticNetPayForecast(
        { month: "2026-07", profile, settings: automatedSettings(), shifts: [shift], pay },
        resolver,
      );
      expect(forecast.result.status).toBe("available");
      if (forecast.result.status !== "available") throw new Error(forecast.result.reason);
      expect(forecast.result.classification.amounts.taxableGrossCents).toBe(
        Math.round(pay.estimatedGrossAmount! * 100),
      );
      expect(forecast.result.classification.shifts).toHaveLength(0);
      const partTime = calculateSpecialDutyPay(
        "2026-07",
        [shift],
        { ...profile, weeklyMinutes: 1200 },
        resolver,
      )[0];
      expect(partTime.baseAmountCents).toBe(pay.specialDutyBreakdowns![0].baseAmountCents);
    },
  );
  it("uses fixed P8/4 July reference amounts and the start day's weekend rate", () => {
    const weekday = calculateSpecialDutyPay("2026-07", [duty()], forecastProfile, resolver)[0];
    const sunday = calculateSpecialDutyPay(
      "2026-07",
      [duty({ date: "2026-07-05" })],
      forecastProfile,
      resolver,
    )[0];
    expect(weekday.hourlyCents).toBe(2403);
    expect(weekday.baseAmountCents).toBe(4806);
    expect(sunday.baseAmountCents).toBe(9612);
  });
  it("keeps regional holidays and the start of the duty authoritative", () => {
    const shift = duty({
      date: "2026-06-04",
      startTime: "18:00",
      endTime: "06:00",
      specialDuty: { ...duty().specialDuty!, endDay: 1 },
    });
    const nw = calculateSpecialDutyPay("2026-06", [shift], forecastProfile, resolver)[0];
    const hh = calculateSpecialDutyPay(
      "2026-06",
      [shift],
      { ...forecastProfile, federalState: "HH" },
      resolver,
    )[0];
    expect(nw.paidHours).toBe(4);
    expect(hh.paidHours).toBe(2);
  });
  it("uses actual elapsed time across the spring clock change and does not invent a 12-hour duty", () => {
    const shift = duty({
      date: "2026-03-28",
      startTime: "20:00",
      endTime: "08:00",
      specialDuty: { ...duty().specialDuty!, endDay: 1 },
    });
    const result = calculateSpecialDutyPay("2026-03", [shift], forecastProfile, resolver)[0];
    expect(result.durationMinutes).toBe(660);
    expect(result.paidHours).toBe(1.375);
  });
  it("keeps open callouts and recorded callouts out of complete gross", () => {
    for (const specialDuty of [
      { ...duty().specialDuty!, calloutsComplete: false },
      {
        ...duty().specialDuty!,
        callouts: [
          {
            start: 600,
            end: 615,
            departure: 600,
            returned: 615,
            kind: "REMOTE" as const,
            breakMinutes: 0,
          },
        ],
      },
    ]) {
      const pay = calculateMonthlyPayEstimate(
        "2026-07",
        [duty({ specialDuty })],
        forecastProfile,
        null,
      );
      expect(pay.available).toBe(false);
      expect(pay.estimatedGrossAmount).toBeNull();
      expect(pay.specialDutyBreakdowns![0].baseAmountCents).toBeGreaterThan(0);
      expect(pay.specialDutyNotes?.length).toBeGreaterThan(0);
    }
  });
  it("keeps multi-day, month-crossing, time-off and unknown tariff cases explicitly open", () => {
    for (const shift of [
      duty({ specialDuty: { ...duty().specialDuty!, endDay: 2 } }),
      duty({
        date: "2026-07-31",
        startTime: "18:00",
        endTime: "06:00",
        specialDuty: { ...duty().specialDuty!, endDay: 1 },
      }),
      duty({ specialDuty: { ...duty().specialDuty!, settlement: "TIME_OFF" } }),
    ])
      expect(
        calculateSpecialDutyPay("2026-07", [shift], forecastProfile, resolver)[0].complete,
      ).toBe(false);
    expect(
      calculateSpecialDutyPay("2026-07", [duty()], base, resolver)[0].baseAmountCents,
    ).toBeNull();
  });
  it("does not turn the paid flat rate into credited working time", () => {
    const summary = calculateMonthlySummary("2026-07", [duty()], forecastProfile, resolver);
    const empty = calculateMonthlySummary("2026-07", [], forecastProfile, resolver);
    expect(summary.actualMinutes).toBe(0);
    expect(summary.balanceMinutes).toBe(empty.balanceMinutes);
    expect(summary.specialDutyNotes).toBeUndefined();
  });
  it("ignores deleted and duplicate input entries", () => {
    const shift = duty();
    expect(
      calculateSpecialDutyPay(
        "2026-07",
        [shift, shift, { ...shift, id: "deleted", deletedAt: "2026-07-08" }],
        forecastProfile,
        resolver,
      ),
    ).toHaveLength(1);
  });
  it("does not guess a weekday flat rate when the holiday catalog is missing", () => {
    const missing = {
      ...resolver,
      resolveHoliday: () => {
        throw new Error("Holiday catalog unavailable");
      },
    };
    const result = calculateSpecialDutyPay("2026-07", [duty()], forecastProfile, missing)[0];
    expect(result.complete).toBe(false);
    expect(result.baseAmountCents).toBeNull();
    const short = duty({ endTime: "07:30" });
    expect(calculateSpecialDutyPay("2026-07", [short], forecastProfile, missing)[0].complete).toBe(
      true,
    );
  });
  it("keeps future rules and unassigned training employers unavailable", () => {
    expect(
      calculateSpecialDutyPay(
        "2027-07",
        [duty({ date: "2027-07-07" })],
        forecastProfile,
        resolver,
      )[0].complete,
    ).toBe(false);
    const unknownTraining = {
      ...base,
      tvalPflegeTariff: { trainingYear: 1 as const, universityRegion: "WEST" as const },
    };
    expect(
      calculateSpecialDutyPay("2026-07", [duty()], unknownTraining, resolver)[0].complete,
    ).toBe(false);
  });
});
