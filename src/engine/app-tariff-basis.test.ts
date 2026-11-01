import { describe, expect, it } from "vitest";
import {
  loadRuleCatalogRuntime,
  storedRuleCatalogRuntime,
} from "@/application/rule-catalog-runtime";
import { newSpecialDuty } from "@/domain/special-duty";
import { newStandbyAgreement } from "@/domain/standby-agreement";
import type { ShiftEntry } from "@/domain/types";
import { forecastProfile, forecastShift } from "./net-pay-tvoed-forecast-test-fixtures";
import { calculateMonthlyPayEstimate } from "./simple-pay";
import { calculateMonthlySummary } from "./monthly-summary";
import { reviewedCatalogSnapshot } from "@/testing/reviewed-rule-catalog-fixtures";

const month = "2026-07";
const entry = (date: string, startTime: string, endTime: string): ShiftEntry =>
  forecastShift({
    id: date,
    date,
    title: "TEST",
    type: "CUSTOM",
    startTime,
    endTime,
    breakMinutes: 0,
  });
const split: ShiftEntry = {
  ...entry("2026-07-06", "06:00", "10:00"),
  specialDuty: {
    ...newSpecialDuty("SPLIT", "06:00", "10:00", "Europe/Berlin"),
    parts: [{ start: 960, end: 1200, breakMinutes: 0 }],
  },
};
const idle: ShiftEntry = {
  ...entry("2026-07-07", "08:00", "16:00"),
  specialDuty: {
    ...newSpecialDuty("ON_CALL", "08:00", "16:00", "Europe/Berlin"),
    settlement: "PAY",
    calloutsComplete: true,
  },
};
const callout: ShiftEntry = {
  ...entry("2026-07-08", "08:00", "16:00"),
  specialDuty: {
    ...newSpecialDuty("ON_CALL", "08:00", "16:00", "Europe/Berlin"),
    settlement: "PAY",
    calloutsComplete: true,
    callouts: [
      { kind: "ON_SITE", departure: 585, start: 600, end: 660, returned: 675, breakMinutes: 0 },
    ],
  },
};
const standby: ShiftEntry = {
  ...entry("2026-07-09", "08:00", "16:00"),
  breakMinutes: 30,
  specialDuty: {
    ...newSpecialDuty("STANDBY", "08:00", "16:00", "Europe/Berlin"),
    version: 2,
    standbyLevel: "II",
    settlement: "PAY",
    standbyAgreement: { ...newStandbyAgreement("TVOED_K"), rule: "STANDARD" },
  },
};
const entries = [split, idle, callout, standby];

describe("application offline tariff basis", () => {
  it("calculates the accepted July reference without a stored or remote catalog", async () => {
    const { runtime } = await loadRuleCatalogRuntime(async () => null);
    const pay = calculateMonthlyPayEstimate(
      month,
      entries,
      forecastProfile,
      null,
      entries,
      undefined,
      runtime.resolver,
    );
    const time = calculateMonthlySummary(month, entries, forecastProfile, runtime.resolver);

    expect(pay.available).toBe(true);
    expect(Math.round(pay.specialDutyAmount! * 100)).toBe(24226);
    expect(time.actualMinutes).toBe(1020);
    expect(time.timeAccountMinutes).toBe(480);
  });

  it("matches the stored published Preview data for pay, target time and weighted time off", async () => {
    const local = (await loadRuleCatalogRuntime(async () => null)).runtime;
    const published = storedRuleCatalogRuntime(reviewedCatalogSnapshot(7));
    const creditEntries = entries.map((item) =>
      item === standby
        ? {
            ...item,
            specialDuty: {
              ...item.specialDuty!,
              settlement: "TIME_OFF" as const,
              standbyAgreement: {
                ...item.specialDuty!.standbyAgreement!,
                timeOffMode: "WEIGHTED" as const,
              },
            },
          }
        : item,
    );
    const evaluate = (items: readonly ShiftEntry[], resolver: typeof local.resolver) => ({
      pay: calculateMonthlyPayEstimate(
        month,
        items,
        forecastProfile,
        null,
        items,
        undefined,
        resolver,
      ),
      time: calculateMonthlySummary(month, items, forecastProfile, resolver),
    });
    for (const items of [entries, creditEntries]) {
      expect(evaluate(items, local.resolver)).toEqual(evaluate(items, published.resolver));
    }
    const timeOff = evaluate(creditEntries, local.resolver);
    expect(Math.round(timeOff.pay.specialDutyAmount! * 100)).toBe(11125);
    expect(timeOff.time.actualMinutes).toBe(1020);
    expect(timeOff.time.timeAccountMinutes).toBe(817.5);
    expect(timeOff.time.targetMinutes).toBe(10626);
    expect(local.resolver.simpleTariffData).toEqual(published.resolver.simpleTariffData);
  });

  it("keeps the accepted three-entry device case and reverses its time credit without rounding", async () => {
    const { resolver } = (await loadRuleCatalogRuntime(async () => null)).runtime;
    const hundredMinuteCallout = {
      ...callout,
      specialDuty: {
        ...callout.specialDuty!,
        callouts: callout.specialDuty!.callouts.map((call) => ({
          ...call,
          returned: call.returned + 10,
        })),
      },
    };
    const payEntries = [split, hundredMinuteCallout, standby];
    const credit = {
      ...standby,
      specialDuty: {
        ...standby.specialDuty!,
        settlement: "TIME_OFF" as const,
        standbyAgreement: {
          ...standby.specialDuty!.standbyAgreement!,
          timeOffMode: "WEIGHTED" as const,
        },
      },
    };
    for (const [items, amount, account] of [
      [payEntries, 21791, 480],
      [[split, hundredMinuteCallout, credit], 8690, 817.5],
      [payEntries, 21791, 480],
    ] as const) {
      const pay = calculateMonthlyPayEstimate(
        month,
        items,
        forecastProfile,
        null,
        items,
        undefined,
        resolver,
      );
      const time = calculateMonthlySummary(month, items, forecastProfile, resolver);
      expect(Math.round(pay.specialDutyAmount! * 100)).toBe(amount);
      expect(time.actualMinutes).toBe(1030);
      expect(time.timeAccountMinutes).toBe(account);
      expect(Math.round(pay.estimatedGrossAmount! * 100)).toBe(424240 + amount);
    }
  });
});
