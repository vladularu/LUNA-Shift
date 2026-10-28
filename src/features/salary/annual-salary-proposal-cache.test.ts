import { afterEach, describe, expect, it, vi } from "vitest";

import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { unresolvedSalaryProfile } from "@/domain/salary-basis-conflict";
import type { UserProfile } from "@/domain/types";
import { annualSalaryProposal } from "./annual-salary-proposal";
import { annualSalaryForecast } from "./annual-salary-forecast";
import * as salary from "./salary-month-input";
import type { SalaryMonthContext } from "./salary-month-input";

function context(): SalaryMonthContext {
  return {
    entries: [forecastShift()],
    tariffDecisions: [],
    workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
    resolver: { ...bundledRuleResolver },
    testMonths: [],
  };
}
afterEach(() => vi.restoreAllMocks());

describe("shared annual-payment reference calculation", () => {
  it.each<[number, UserProfile, readonly string[]]>([
    [2027, forecastProfile, []],
    [2026, { ...forecastProfile, tariff: null, manualMonthlyGrossCents: 400000 }, []],
    [
      2026,
      {
        ...forecastProfile,
        tariff: null,
        tvhKrTariff: { payGroup: "KR13", payLevel: 4, fullTimeWeeklyMinutes: 2310 },
      },
      [],
    ],
    [2026, unresolvedSalaryProfile(forecastProfile), []],
    [2026, forecastProfile, ["2026-05"]],
  ])(
    "does not read or serialize entries for an unavailable proposal (%i)",
    (year, profile, testMonths) => {
      const input = context();
      let reads = 0;
      const guarded = {
        ...input,
        testMonths,
        get entries() {
          reads++;
          return input.entries;
        },
      };
      expect(annualSalaryProposal(year, profile, guarded)).toBeNull();
      expect(reads).toBe(0);
    },
  );
  it("calculates the three reference months once for overview and net, including fresh SQL objects", () => {
    const input = context();
    const monthly = vi.spyOn(salary, "salaryMonthInputSteps");
    const first = annualSalaryProposal(2026, forecastProfile, input);
    const reloaded = {
      ...structuredClone({ ...input, resolver: undefined }),
      resolver: input.resolver,
    };
    const second = annualSalaryForecast(2026, structuredClone(forecastProfile), reloaded);
    expect(first).not.toBeNull();
    expect(second.proposal).toBe(first);
    expect(monthly).toHaveBeenCalledTimes(3);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first!.referenceMonths)).toBe(true);
    expect(Object.isFrozen(input.entries[0])).toBe(false);
  });

  it("recalculates when a reference shift changes without changing its revision", () => {
    const input = context();
    const first = annualSalaryProposal(2026, forecastProfile, input);
    const changed = { ...input, entries: [{ ...input.entries[0], endTime: "05:00" }] };
    const second = annualSalaryProposal(2026, forecastProfile, changed);
    expect(second).not.toBeNull();
    expect(second!.grossCents).not.toBe(first!.grossCents);
  });

  it("detects changed contents on a reused profile and context object", () => {
    const input = { ...context(), entries: [forecastShift()] };
    const profile = { ...forecastProfile };
    const first = annualSalaryProposal(2026, profile, input);
    input.entries[0] = forecastShift({ endTime: "05:00" });
    const changedShift = annualSalaryProposal(2026, profile, input);
    expect(changedShift!.grossCents).not.toBe(first!.grossCents);
    profile.weeklyMinutes = 1200;
    expect(annualSalaryProposal(2026, profile, input)!.grossCents).not.toBe(
      changedShift!.grossCents,
    );
  });

  it("separates rule catalogs and work-pattern settings", () => {
    const input = context();
    const first = annualSalaryProposal(2026, forecastProfile, input);
    const monthly = vi.spyOn(salary, "salaryMonthInputSteps");
    const other = annualSalaryProposal(2026, forecastProfile, {
      ...input,
      resolver: { ...bundledRuleResolver },
    });
    expect(other).not.toBe(first);
    expect(other).toEqual(first);
    const changed = annualSalaryProposal(2026, forecastProfile, {
      ...input,
      workPatternSettings: {
        workplaceCoverage: "AROUND_THE_CLOCK",
        assignment: "PERMANENT",
        updatedAt: null,
      },
    });
    expect(changed).not.toBe(first);
    expect(monthly).toHaveBeenCalledTimes(6);
  });

  it("does not reuse an eligible proposal during test data, salary conflicts or an unsupported year", () => {
    const input = context();
    expect(annualSalaryProposal(2026, forecastProfile, input)).not.toBeNull();
    expect(
      annualSalaryProposal(2026, forecastProfile, { ...input, testMonths: ["2026-05"] }),
    ).toBeNull();
    expect(annualSalaryProposal(2026, unresolvedSalaryProfile(forecastProfile), input)).toBeNull();
    expect(annualSalaryProposal(2027, forecastProfile, input)).toBeNull();
  });

  it("retries a transient rule failure instead of caching a missing proposal", () => {
    const input = context();
    const monthly = vi.spyOn(salary, "salaryMonthInputSteps").mockImplementationOnce(() => {
      throw new Error("transient");
    });
    expect(annualSalaryProposal(2026, forecastProfile, input)).toBeNull();
    const complete = annualSalaryProposal(2026, forecastProfile, input);
    expect(complete).not.toBeNull();
    expect(annualSalaryProposal(2026, forecastProfile, input)).toBe(complete);
    expect(monthly).toHaveBeenCalledTimes(4);
  });

  it("invalidates a changed monthly allowance decision", () => {
    const input = context();
    const first = annualSalaryProposal(2026, forecastProfile, input);
    const monthly = vi.spyOn(salary, "salaryMonthInputSteps");
    const changed = annualSalaryProposal(2026, forecastProfile, {
      ...input,
      tariffDecisions: [
        {
          month: "2026-07",
          allowanceStatus: "NONE",
          revision: 1,
          confirmedAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    expect(changed).not.toBe(first);
    expect(monthly).toHaveBeenCalledTimes(3);
  });

  it("keeps saved payment overrides effective even while the proposal is reused", () => {
    const input = context();
    const automatic = annualSalaryForecast(2026, forecastProfile, input);
    const saved = [
      {
        revision: 2,
        payoutMonth: "2026-11",
        grossCents: 123400,
        netBasis: { kind: "CONSTANT_PAY" as const },
      },
    ];
    const changed = annualSalaryForecast(2026, forecastProfile, input, saved);
    expect(changed.proposal).toBe(automatic.proposal);
    expect(changed.automatic).toBe(false);
    expect(changed.payments).toBe(saved);
  });

  it("bounds retained profile revisions", () => {
    const input = context();
    const first = annualSalaryProposal(2026, forecastProfile, input);
    for (let revision = 1; revision <= 12; revision++) {
      annualSalaryProposal(2026, { ...forecastProfile, weeklyMinutes: 2000 + revision }, input);
    }
    const repeated = annualSalaryProposal(2026, forecastProfile, input);
    expect(repeated).not.toBe(first);
    expect(repeated).toEqual(first);
  });
});
