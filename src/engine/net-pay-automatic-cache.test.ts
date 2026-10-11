import { describe, expect, it, vi } from "vitest";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { calculateMonthlyPayEstimate } from "./simple-pay";
import {
  calculateAutomaticNetPayForecast,
  type AutomaticNetPayForecast,
} from "./net-pay-automatic-forecast";
import { createAutomaticNetPayCache } from "./net-pay-automatic-cache";
import { forecastProfile, forecastShift } from "./net-pay-tvoed-forecast-test-fixtures";
import * as calculationBasis from "./net-pay-calculation-basis";

function fixture() {
  const profile = { ...forecastProfile, tariff: null, manualMonthlyGrossCents: 400000 };
  const month = "2026-07";
  const input = {
    month,
    profile,
    settings: automatedSettings("2026-01"),
    shifts: [forecastShift()],
    pay: calculateMonthlyPayEstimate(month, [], profile, null),
  };
  const result = calculateAutomaticNetPayForecast(input, bundledRuleResolver);
  expect(result.result.status).toBe("available");
  return { input, calculate: vi.fn(() => result) };
}

describe("automatic net forecast reuse between report and detail", () => {
  it("invalidates the cache when the deduction rule revision changes", () => {
    const cache = createAutomaticNetPayCache();
    const { input, calculate } = fixture();
    const original = calculationBasis.resolveNetPayCalculationBasis(input.month, "FORECAST")!;
    cache(input, bundledRuleResolver, calculate);
    const resolve = vi.spyOn(calculationBasis, "resolveNetPayCalculationBasis");
    try {
      resolve.mockReturnValue({ ...original, revision: `${original.revision}-updated` });
      cache(input, bundledRuleResolver, calculate);
      cache(structuredClone(input), bundledRuleResolver, calculate);
      expect(calculate).toHaveBeenCalledTimes(2);
    } finally {
      resolve.mockRestore();
    }
  });
  it("reuses identical fresh SQL objects and protects the shared result from mutation", () => {
    const cache = createAutomaticNetPayCache();
    const { input, calculate } = fixture();
    const first = cache(input, bundledRuleResolver, calculate);
    expect(cache(structuredClone(input), bundledRuleResolver, calculate)).toBe(first);
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.result)).toBe(true);
    if (first.result.status !== "available") throw new Error(first.result.reason);
    expect(Object.isFrozen(first.result.pay.amounts)).toBe(true);
    expect(Object.isFrozen(first.result.classification.shifts)).toBe(true);
  });

  it("recalculates after content edits, including edits without changed revisions", () => {
    const cache = createAutomaticNetPayCache();
    const { input, calculate } = fixture();
    cache(input, bundledRuleResolver, calculate);
    const edits = [
      { ...input, month: "2026-08" },
      { ...input, profile: { ...input.profile, weeklyMinutes: input.profile.weeklyMinutes - 60 } },
      {
        ...input,
        settings: {
          ...input.settings,
          profile: { ...input.settings.profile, taxClass: 3 as const },
        },
      },
      { ...input, shifts: [{ ...input.shifts[0], endTime: "04:00" }] },
      { ...input, pay: { ...input.pay, estimatedGrossAmount: 4001 } },
      { ...input, pay: { ...input.pay, confirmedAllowance: "SHIFT_MONTHLY" as const } },
    ];
    for (const edited of edits) cache(edited, bundledRuleResolver, calculate);
    expect(calculate).toHaveBeenCalledTimes(7);
    cache(input, { ...bundledRuleResolver }, calculate);
    expect(calculate).toHaveBeenCalledTimes(8);
  });

  it("retries an unavailable result immediately", () => {
    const cache = createAutomaticNetPayCache();
    const { input, calculate } = fixture();
    const failed: AutomaticNetPayForecast = {
      sourceMonth: input.settings.month,
      result: { status: "unavailable", stage: "sfn", reason: "Regeln fehlen" },
    };
    calculate.mockReturnValueOnce(failed);
    expect(cache(input, bundledRuleResolver, calculate)).toBe(failed);
    expect(cache(input, bundledRuleResolver, calculate).result.status).toBe("available");
    expect(calculate).toHaveBeenCalledTimes(2);
  });

  it("bounds memory and retains the most recently viewed forecast", () => {
    const cache = createAutomaticNetPayCache();
    const { input, calculate } = fixture();
    cache(input, bundledRuleResolver, calculate);
    const others = Array.from({ length: 11 }, (_, i) => ({
      ...input,
      shifts: [{ ...input.shifts[0], id: `other-${i}` }],
    }));
    for (const other of others) cache(other, bundledRuleResolver, calculate);
    cache(input, bundledRuleResolver, calculate);
    const extra = { ...input, shifts: [{ ...input.shifts[0], id: "extra" }] };
    cache(extra, bundledRuleResolver, calculate);
    cache(input, bundledRuleResolver, calculate);
    expect(calculate).toHaveBeenCalledTimes(13);
    cache(others[0], bundledRuleResolver, calculate);
    expect(calculate).toHaveBeenCalledTimes(14);
  });
});
