import type { UserProfile } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { forecastProfile } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { annualSalaryGrossCents } from "@/domain/annual-salary-payment";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { calculateAutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import { annualSalaryForecast } from "./annual-salary-forecast";
import { salaryMonthInput } from "./salary-month-input";

const context = {
  entries: [],
  tariffDecisions: [],
  workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  resolver: bundledRuleResolver,
};

describe("automatic tariff annual payment", () => {
  it("adds the source-backed November forecast without saving, only in the cash month", () => {
    const result = annualSalaryForecast(2026, forecastProfile, context);
    expect(result.automatic).toBe(true);
    expect(result.payments).toEqual([
      {
        revision: 1,
        payoutMonth: "2026-11",
        grossCents: result.proposal!.grossCents,
        netBasis: { kind: "CONSTANT_PAY" },
      },
    ]);
    expect(annualSalaryGrossCents("2026-11", result.payments)).toBeGreaterThan(0);
    for (const month of ["2026-10", "2026-12", "2027-11"])
      expect(annualSalaryGrossCents(month, result.payments)).toBe(0);
    expect(annualSalaryForecast(2026, forecastProfile, context, result.payments).payments).toEqual(
      result.payments,
    );
  });
  it.each([0, 360_000])(
    "keeps manual amount %i and a moved payout without a second November payment",
    (grossCents) => {
      const saved = [{ revision: 2, payoutMonth: "2026-12", grossCents, netBasis: null }];
      const result = annualSalaryForecast(2026, forecastProfile, context, saved);
      expect(result.automatic).toBe(false);
      expect(result.payments).toBe(saved);
      expect(annualSalaryGrossCents("2026-11", result.payments)).toBe(0);
    },
  );
  it("keeps other years' overrides separate and never mutates saved settings", () => {
    const saved = Object.freeze([
      { revision: 1, payoutMonth: "2025-11", grossCents: 100_000, netBasis: null },
    ]);
    expect(annualSalaryForecast(2026, forecastProfile, context, saved).payments).toHaveLength(2);
    expect(saved).toHaveLength(1);
  });
  it("does not invent a payment for unverified years, own pay or active test lookbacks", () => {
    expect(annualSalaryForecast(2027, forecastProfile, context).payments).toEqual([]);
    expect(
      annualSalaryForecast(
        2026,
        { ...forecastProfile, tariff: null, manualMonthlyGrossCents: 400_000 },
        context,
      ).payments,
    ).toEqual([]);
    expect(
      annualSalaryForecast(2026, forecastProfile, { ...context, testMonths: ["2026-05"] }).payments,
    ).toEqual([]);
  });
  it("uses the separate annual tax and SV path automatically and invalidates the result when the amount changes", () => {
    const month = "2026-11";
    const annual = annualSalaryForecast(2026, forecastProfile, context);
    const settings = automatedSettings("2026-01");
    const input = {
      month,
      profile: forecastProfile,
      settings,
      ...salaryMonthInput(month, forecastProfile, context),
    };
    const normal = calculateAutomaticNetPayForecast(input, bundledRuleResolver);
    const result = calculateAutomaticNetPayForecast(
      {
        ...input,
        settings: {
          ...settings,
          automation: { ...settings.automation!, annualPayments: annual.payments },
        },
      },
      bundledRuleResolver,
    );
    expect(result.annualPayment?.netIncluded).toBe(true);
    expect(result.result.status).toBe("available");
    if (result.result.status !== "available" || normal.result.status !== "available")
      throw Error("Missing forecast");
    expect(result.result.pay.netCents).toBeGreaterThan(normal.result.pay.netCents);
    expect(result.result.pay.netCents - normal.result.pay.netCents).toBeLessThan(
      annual.proposal!.grossCents,
    );
    expect(result.result.pay.amounts.grossCents - normal.result.pay.amounts.grossCents).toBe(
      annual.proposal!.grossCents,
    );
  });
  it.each<readonly [string, UserProfile, number, number]>([
    [
      "TVAöD",
      {
        ...forecastProfile,
        tariff: null,
        nursingTrainingTariff: { trainingYear: 3, sector: "BT_K", tariffRegion: "OTHER" },
      },
      148804,
      9000,
    ],
    [
      "TVA-L",
      {
        ...forecastProfile,
        tariff: null,
        tvalPflegeTariff: {
          trainingYear: 3,
          universityRegion: "WEST",
          employerScope: "SECTION_43",
        },
      },
      153235,
      9500,
    ],
  ])(
    "recalculates %s from its training basis after explicitly clearing the old P8 cash-year override",
    (_, profile, expected, rate) => {
      const saved = [
        {
          revision: 1,
          payoutMonth: "2026-11",
          grossCents: 381816,
          netBasis: { kind: "CONSTANT_PAY" as const },
        },
      ];
      const before = annualSalaryForecast(2026, profile, context, saved);
      expect(before.automatic).toBe(false);
      expect(before.payments).toEqual(saved);
      expect(before.proposal).toMatchObject({ grossCents: expected, rateBasisPoints: rate });
      const after = annualSalaryForecast(2026, profile, context, []);
      expect(after.automatic).toBe(true);
      expect(annualSalaryGrossCents("2026-11", after.payments)).toBe(expected);
      expect(annualSalaryGrossCents("2026-12", after.payments)).toBe(0);
      const initial = automatedSettings("2026-01");
      const calculate = (payments: typeof after.payments) =>
        calculateAutomaticNetPayForecast(
          {
            month: "2026-11",
            profile,
            ...salaryMonthInput("2026-11", profile, context),
            settings: {
              ...initial,
              automation: { ...initial.automation!, annualPayments: payments },
            },
          },
          bundledRuleResolver,
        );
      const oldNet = calculate(before.payments),
        newNet = calculate(after.payments);
      expect(newNet.annualPayment?.netIncluded).toBe(true);
      if (oldNet.result.status !== "available" || newNet.result.status !== "available")
        throw Error("Missing net forecast");
      expect(oldNet.result.pay.amounts.grossCents - newNet.result.pay.amounts.grossCents).toBe(
        381816 - expected,
      );
      expect(newNet.result.pay.netCents).toBeLessThan(oldNet.result.pay.netCents);
      expect(saved[0].grossCents).toBe(381816);
    },
  );
});
