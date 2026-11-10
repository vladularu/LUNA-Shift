import { afterEach, describe, expect, it, vi } from "vitest";
import { captureEmploymentProfile } from "@/domain/employment-history";
import type { DatedRemunerationProfile } from "@/domain/remuneration-profile";
import type { UserProfile } from "@/domain/types";
import { unresolvedSalaryProfile } from "@/domain/salary-basis-conflict";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { annualSalaryForecast } from "./annual-salary-forecast";
import { annualSalaryIssueLabel, annualSalaryIssueMessage } from "./annual-salary-issue";
import * as salary from "./salary-month-input";

const context = {
  entries: [],
  tariffDecisions: [],
  workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  resolver: bundledRuleResolver,
};
const profiles: readonly [string, UserProfile][] = [
  [
    "TV-L",
    {
      ...forecastProfile,
      tariff: null,
      tvlKrTariff: { payGroup: "KR12", payLevel: 4, universityRegion: "WEST" },
    },
  ],
  [
    "TV-UK",
    { ...forecastProfile, tariff: null, tvUkNursingTariff: { payGroup: "PUK7", payLevel: 4 } },
  ],
  [
    "TV-H",
    {
      ...forecastProfile,
      tariff: null,
      tvhKrTariff: { payGroup: "KR8", payLevel: 4, fullTimeWeeklyMinutes: 2310 },
    },
  ],
];
function row(profile: UserProfile, effectiveFrom: string | null): DatedRemunerationProfile {
  return {
    effectiveFrom,
    employment: captureEmploymentProfile(profile),
    data: { version: 1, weeklyMinutes: profile.weeklyMinutes, selection: { kind: "unconfigured" } },
    revision: 1,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}
afterEach(() => vi.restoreAllMocks());

describe("annual payment availability through the real dated forecast", () => {
  it.each(profiles)(
    "calculates %s and distinguishes a real switch from a whole-period correction",
    (_, profile) => {
      const continuous = annualSalaryForecast(2026, profile, context);
      expect(continuous.automatic).toBe(true);
      expect(continuous.issue).toBeNull();
      expect(continuous.proposal!.grossCents).toBeGreaterThan(0);
      expect(continuous.payments[0].payoutMonth).toBe("2026-11");
      const changed = {
        ...profile,
        employmentTimeline: [row(forecastProfile, null), row(profile, "2026-11-01")],
      };
      const original = JSON.stringify(changed);
      const blocked = annualSalaryForecast(2026, changed, context);
      expect(blocked.issue).toEqual({ code: "TARIFF_CHANGE" });
      expect(blocked.payments).toEqual([]);
      expect(annualSalaryIssueLabel(blocked.issue)).toBe("Tarifwechsel prüfen");
      const corrected = {
        ...profile,
        employmentTimeline: [row(profile, null), row(profile, "2026-11-01")],
      };
      const recovered = annualSalaryForecast(2026, corrected, context);
      expect(recovered.issue).toBeNull();
      expect(recovered.proposal?.grossCents).toBe(continuous.proposal?.grossCents);
      expect(JSON.stringify(changed)).toBe(original);
    },
  );
  it.each([0, 250000])(
    "preserves a saved override of %i cents during a tariff switch",
    (grossCents) => {
      const profile = {
        ...profiles[0][1],
        employmentTimeline: [row(forecastProfile, null), row(profiles[0][1], "2026-11-01")],
      };
      const saved = Object.freeze([
        { revision: 2, payoutMonth: "2026-12", grossCents, netBasis: null },
      ]);
      const result = annualSalaryForecast(2026, profile, context, saved);
      expect(result.issue?.code).toBe("TARIFF_CHANGE");
      expect(result.automatic).toBe(false);
      expect(result.payments).toBe(saved);
    },
  );
  it("names the first incomplete reference month and retries after it is repaired", () => {
    const original = salary.salaryMonthInputSteps;
    const spy = vi
      .spyOn(salary, "salaryMonthInputSteps")
      .mockImplementation(function* (month, profile, input) {
        const value = yield* original(month, profile, input);
        return month === "2026-08" ? { ...value, pay: { ...value.pay, available: false } } : value;
      });
    const isolated = { ...context, resolver: { ...bundledRuleResolver } };
    const result = annualSalaryForecast(2026, profiles[0][1], isolated);
    expect(result.issue).toEqual({ code: "REFERENCE_MONTH_UNAVAILABLE", month: "2026-08" });
    expect(annualSalaryIssueMessage(result.issue!)).toContain("August 2026");
    expect(result.payments).toEqual([]);
    spy.mockRestore();
    expect(annualSalaryForecast(2026, profiles[0][1], isolated).automatic).toBe(true);
  });
  it("reports a failed reference calculation without exposing internal errors or creating money", () => {
    const result = annualSalaryForecast(2026, profiles[1][1], {
      ...context,
      entries: [forecastShift({ startTime: "invalid" })],
    });
    expect(result.issue).toEqual({ code: "REFERENCE_MONTH_FAILED", month: "2026-07" });
    expect(result.payments).toEqual([]);
    expect(annualSalaryIssueMessage(result.issue!)).toContain("Juli 2026");
    expect(annualSalaryIssueMessage(result.issue!)).not.toContain("invalid");
  });
  it("distinguishes unsupported year, high TV-H group, private pay, conflict and test data", () => {
    expect(annualSalaryForecast(2027, forecastProfile, context).issue?.code).toBe(
      "UNSUPPORTED_YEAR",
    );
    expect(
      annualSalaryForecast(
        2026,
        {
          ...profiles[2][1],
          tvhKrTariff: { payGroup: "KR13", payLevel: 4, fullTimeWeeklyMinutes: 2310 },
        },
        context,
      ).issue?.code,
    ).toBe("UNSUPPORTED_GROUP");
    expect(
      annualSalaryForecast(
        2026,
        { ...forecastProfile, tariff: null, manualMonthlyGrossCents: 400000 },
        context,
      ).issue?.code,
    ).toBe("NO_TARIFF");
    expect(
      annualSalaryForecast(2026, unresolvedSalaryProfile(forecastProfile), context).issue?.code,
    ).toBe("SALARY_BASIS_CONFLICT");
    expect(
      annualSalaryForecast(2026, forecastProfile, { ...context, testMonths: ["2026-05"] }).issue
        ?.code,
    ).toBe("TEST_DATA");
  });
});
