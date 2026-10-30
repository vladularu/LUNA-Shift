import { describe, expect, it } from "vitest";
import { newSpecialDuty, type DutyCallout } from "@/domain/special-duty";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { forecastProfile, forecastShift } from "./net-pay-tvoed-forecast-test-fixtures";
import { bundledRuleResolver as resolver } from "@/rules/rule-resolver";
import { calculateSpecialDutyPay } from "./special-duty-pay";
import { calculateMonthlyPayEstimate, calculateShiftPremiumBreakdown } from "./simple-pay";
import { calculateAutomaticNetPayForecast } from "./net-pay-automatic-forecast";
import { specialDutyOvertimeRates } from "./special-duty-overtime-rate";
import { specialDutyWorkMinutes } from "./special-duty";

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
const call = (
  start: number,
  end: number,
  kind: DutyCallout["kind"] = "REMOTE",
  travel = 0,
): DutyCallout => ({
  start,
  end,
  departure: start - travel,
  returned: end + travel,
  breakMinutes: 0,
  kind,
});
const duty = (calls: readonly DutyCallout[], overrides: Partial<ShiftEntry> = {}): ShiftEntry =>
  forecastShift({
    date: "2026-07-07",
    type: "CUSTOM",
    startTime: "06:00",
    endTime: "20:00",
    breakMinutes: 0,
    specialDuty: {
      ...newSpecialDuty("ON_CALL", "06:00", "20:00", "Europe/Berlin"),
      settlement: "PAY",
      callouts: calls,
      calloutsComplete: true,
    },
    ...overrides,
  });

describe("on-call employment remuneration", () => {
  it.each(models)(
    "uses the established overtime bases and taxable gross for %s",
    (_name, profile) => {
      const shift = duty([call(600, 660)]);
      const regular = {
        ...shift,
        specialDuty: null,
        startTime: "10:00",
        endTime: "11:00",
        overtimeMinutes: 60,
        tariffOvertimeConfirmed: true,
      };
      const reference = calculateShiftPremiumBreakdown(regular, profile, resolver);
      const line = calculateSpecialDutyPay("2026-07", [shift], profile, resolver)[0];
      expect(line.complete).toBe(true);
      expect(line.calloutPay?.baseAmountCents).toBe(Math.round(reference.overtimeBaseAmount * 100));
      expect(line.calloutPay?.overtimePremiumCents).toBe(
        Math.round(reference.overtimePremiumAmount * 100),
      );
      expect(line.calloutPay?.baseAmountCents).toBeGreaterThan(0);
      const pay = calculateMonthlyPayEstimate("2026-07", [shift], profile, null);
      const without = calculateMonthlyPayEstimate("2026-07", [], profile, null);
      expect(pay.available).toBe(true);
      expect(Math.round((pay.estimatedGrossAmount! - without.estimatedGrossAmount!) * 100)).toBe(
        line.baseAmountCents! +
          line.calloutPay!.baseAmountCents! +
          line.calloutPay!.overtimePremiumCents!,
      );
      const forecast = calculateAutomaticNetPayForecast(
        { month: "2026-07", profile, settings: automatedSettings(), shifts: [shift], pay },
        resolver,
      );
      expect(forecast.result.status).toBe("available");
      if (forecast.result.status !== "available") throw Error(forecast.result.reason);
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
      expect(partTime.calloutPay).toEqual(line.calloutPay);
    },
  );
  it("rounds each on-site call with travel but combines remote calls once", () => {
    const shift = duty([
      call(600, 615, "ON_SITE", 10),
      call(720, 735, "ON_SITE", 10),
      call(840, 850),
      call(900, 915),
    ]);
    const line = calculateSpecialDutyPay("2026-07", [shift], forecastProfile, resolver)[0];
    expect(line.calloutPay?.actualMinutes).toBe(95);
    expect(line.calloutPay?.paidMinutes).toBe(180);
    expect(specialDutyWorkMinutes(shift)).toBe(95);
    expect(shift.specialDuty!.callouts[0].end).toBe(615);
  });
  it.each([models[2], models[3], models[6]])(
    "rounds combined remote work to half hours for %s",
    (_name, profile) => {
      expect(
        calculateSpecialDutyPay(
          "2026-07",
          [duty([call(600, 610), call(660, 675)])],
          profile,
          resolver,
        )[0].calloutPay?.paidMinutes,
      ).toBe(30);
      expect(
        calculateSpecialDutyPay(
          "2026-07",
          [duty([call(600, 616), call(660, 676)])],
          profile,
          resolver,
        )[0].calloutPay?.paidMinutes,
      ).toBe(60);
    },
  );
  it("applies the TV-UK guarantee only to the shortest on-site call", () => {
    const shift = duty([call(420, 445, "ON_SITE"), call(720, 810, "ON_SITE"), call(900, 920)]);
    const line = calculateSpecialDutyPay("2026-07", [shift], models[4][1], resolver)[0];
    expect(line.complete).toBe(true);
    expect(line.calloutPay?.actualMinutes).toBe(135);
    expect(line.calloutPay?.paidMinutes).toBe(290);
    expect(
      calculateSpecialDutyPay("2026-07", [duty([call(600, 615)])], models[4][1], resolver)[0]
        .calloutPay?.paidMinutes,
    ).toBe(15);
  });
  it("caps the TVöD overtime base at step four while preserving the separate step-three premium", () => {
    const stepSix = {
      ...forecastProfile,
      tariff: { ...forecastProfile.tariff!, payLevel: 6 as const },
    };
    const four = specialDutyOvertimeRates("2026-07-07", forecastProfile, duty([]), resolver)!;
    const six = specialDutyOvertimeRates("2026-07-07", stepSix, duty([]), resolver)!;
    expect(six).toEqual(four);
    expect(six.baseHourlyCents).toBe(2403);
    expect(six.premiumHourlyCents).not.toBe(six.baseHourlyCents);
    expect(six.premiumBasisPoints).toBe(3000);
  });
  it("adds actual night and holiday premiums without changing the known overtime base", () => {
    for (const shift of [
      duty([call(300, 330)], { startTime: "00:00" }),
      duty([call(600, 615)], { date: "2026-07-05" }),
      duty([call(600, 615)], { date: "2026-06-04" }),
      duty([call(1320, 1440)], {
        startTime: "18:00",
        endTime: "06:00",
        specialDuty: { ...duty([call(1320, 1440)]).specialDuty!, endDay: 1 },
      }),
    ]) {
      const pay = calculateMonthlyPayEstimate(
        shift.date.slice(0, 7),
        [shift],
        forecastProfile,
        null,
      );
      expect(pay.available).toBe(true);
      expect(pay.estimatedGrossAmount).not.toBeNull();
      expect(pay.specialDutyBreakdowns?.[0].calloutPay?.baseAmountCents).toBeGreaterThan(0);
      expect(pay.specialDutyBreakdowns?.[0].calloutPay?.timePremiumCents).toBeGreaterThan(0);
    }
  });
  it("does not invent missing or conflicting overtime rates", () => {
    expect(specialDutyOvertimeRates("2026-07-07", base, duty([]), resolver)).toBeNull();
    expect(
      specialDutyOvertimeRates(
        "2026-07-07",
        { ...forecastProfile, manualMonthlyGrossCents: 400000 },
        duty([]),
        resolver,
      ),
    ).toBeNull();
    expect(
      specialDutyOvertimeRates(
        "2026-07-07",
        { ...forecastProfile, tvlKrTariff: models[2][1].tvlKrTariff },
        duty([]),
        resolver,
      ),
    ).toBeNull();
  });
  it("uses tariff night boundaries, and elapsed minutes across autumn DST", () => {
    const evening = duty([call(1200, 1260)], { endTime: "22:00" });
    expect(calculateSpecialDutyPay("2026-07", [evening], models[2][1], resolver)[0].complete).toBe(
      true,
    );
    expect(calculateSpecialDutyPay("2026-07", [evening], models[4][1], resolver)[0].complete).toBe(
      true,
    );
    const autumn = duty([call(90, 210, "ON_SITE")], {
      date: "2026-10-25",
      startTime: "00:00",
      endTime: "12:00",
    });
    const line = calculateSpecialDutyPay("2026-10", [autumn], forecastProfile, resolver)[0];
    expect(line.calloutPay?.actualMinutes).toBe(180);
    expect(line.calloutPay?.paidMinutes).toBe(180);
    expect(line.complete).toBe(true);
  });
  it("does not assume a normal working day without reviewed holiday data", () => {
    const missing = {
      ...resolver,
      resolveHoliday: () => {
        throw Error("Missing calendar");
      },
    };
    const line = calculateSpecialDutyPay(
      "2026-07",
      [duty([call(600, 610)], { endTime: "14:00" })],
      forecastProfile,
      missing,
    )[0];
    expect(line.baseAmountCents).toBeGreaterThan(0);
    expect(line.complete).toBe(false);
    expect(line.calloutPay?.timePremiumCents).toBeNull();
    expect(line.calloutPay?.notes.length).toBeGreaterThan(0);
  });
  it("leaves unlocated callout pauses and unconfirmed callouts open", () => {
    for (const specialDuty of [
      { ...duty([call(600, 660)]).specialDuty!, calloutsComplete: false },
      { ...duty([{ ...call(600, 660), breakMinutes: 15 }]).specialDuty! },
    ]) {
      const pay = calculateMonthlyPayEstimate(
        "2026-07",
        [duty([], { specialDuty })],
        forecastProfile,
        null,
      );
      expect(pay.available).toBe(false);
      expect(pay.estimatedGrossAmount).toBeNull();
      expect(pay.specialDutyNotes?.length).toBeGreaterThan(0);
    }
  });
});
