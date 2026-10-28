import { describe, expect, it } from "vitest";

import { forecastProfile } from "./net-pay-tvoed-forecast-test-fixtures";
import { createWorkingTimeCalculationProfile } from "./working-time-calculation-profile";
import { calculateMonthlyWorkingTimeTarget } from "./working-time-target";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import type { TargetDayFact } from "@/domain/working-time-target";

const profile = () =>
  createWorkingTimeCalculationProfile(forecastProfile, null, [], "ready", [], false);

describe("monthly target snapshot reuse", () => {
  it("shares the full immutable ledger across equivalent current profile snapshots", () => {
    const input = profile();
    const first = calculateMonthlyWorkingTimeTarget("2026-12", input);
    expect(calculateMonthlyWorkingTimeTarget("2026-12", structuredClone(input))).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.days)).toBe(true);
    expect(first.days.every(Object.isFrozen)).toBe(true);
  });

  it("separates months, weekly hours, holiday regions, calculation modes and notices", () => {
    const input = profile();
    const first = calculateMonthlyWorkingTimeTarget("2026-12", input);
    expect(calculateMonthlyWorkingTimeTarget("2026-11", input)).not.toBe(first);
    expect(
      calculateMonthlyWorkingTimeTarget("2026-12", { ...input, weeklyMinutes: 1200 }),
    ).not.toBe(first);
    expect(
      calculateMonthlyWorkingTimeTarget("2026-12", {
        ...input,
        federalState: "BY",
        holidayRegion: "BY_AUGSBURG",
      }),
    ).not.toBe(first);
    const roster = {
      ...input,
      workingTimeTarget: { ...input.workingTimeTarget!, mode: "ROSTER" as const },
    };
    expect(calculateMonthlyWorkingTimeTarget("2026-12", roster)).not.toBe(first);
    const notice = { date: null, code: "audit", message: "Changed basis", affectsTarget: false };
    const changed = {
      ...input,
      workingTimeTarget: { ...input.workingTimeTarget!, notices: [notice] },
    };
    expect(calculateMonthlyWorkingTimeTarget("2026-12", changed).notices).toContainEqual(notice);
  });

  it("invalidates reused context objects after an employment-period change", () => {
    const input = structuredClone(profile());
    const context = input.workingTimeTarget!.context!;
    const first = calculateMonthlyWorkingTimeTarget("2026-12", input);
    const period = context.periods[0] as { weeklyMinutes: number };
    period.weeklyMinutes = 1200;
    const changed = calculateMonthlyWorkingTimeTarget("2026-12", input);
    expect(changed).not.toBe(first);
    expect(changed.targetMinutes).not.toBe(first.targetMinutes);
  });

  it("keeps rule-catalog snapshots separate", () => {
    const input = profile();
    const first = calculateMonthlyWorkingTimeTarget("2026-12", input);
    const otherCatalog = { ...bundledRuleResolver };
    const other = calculateMonthlyWorkingTimeTarget("2026-12", input, otherCatalog);
    expect(other).not.toBe(first);
    expect(other).toEqual(first);
  });

  it("invalidates a reused roster after new confirmed absence facts", () => {
    const base = profile();
    const days: TargetDayFact[] = [];
    const input = {
      ...base,
      workingTimeTarget: {
        ...base.workingTimeTarget!,
        mode: "ROSTER" as const,
        context: {
          ...base.workingTimeTarget!.context!,
          periods: base.workingTimeTarget!.context!.periods.map((period) => ({
            ...period,
            model: {
              kind: "ROTATING_FIVE_IN_SEVEN" as const,
              monthlyReference: "WEEKDAYS_ONE_FIFTH" as const,
              sevenDayShiftPlanConfirmed: true,
            },
            tariff: { kind: "TVOED_K" as const, version: "2026-01-01", scopeConfirmed: true },
          })),
          days,
        },
      },
    };
    const first = calculateMonthlyWorkingTimeTarget("2026-12", input);
    days.push({
      date: "2026-12-24",
      rosterStatus: "FINAL",
      disposition: "RELEASED",
      lostMinutes: 240,
    });
    const changed = calculateMonthlyWorkingTimeTarget("2026-12", input);
    expect(changed).not.toBe(first);
    expect(changed).not.toEqual(first);
  });

  it("bounds retained ledgers instead of accumulating every profile revision", () => {
    const resolver = { ...bundledRuleResolver };
    const input = { federalState: "NW" as const, weeklyMinutes: 2000 };
    const first = calculateMonthlyWorkingTimeTarget("2026-12", input, resolver);
    for (let revision = 1; revision <= 48; revision++) {
      calculateMonthlyWorkingTimeTarget(
        "2026-12",
        { ...input, weeklyMinutes: 2000 + revision },
        resolver,
      );
    }
    const repeated = calculateMonthlyWorkingTimeTarget("2026-12", input, resolver);
    expect(repeated).not.toBe(first);
    expect(repeated).toEqual(first);
  });

  it("still rejects invalid or loading inputs after a matching result was cached", () => {
    const input = profile();
    calculateMonthlyWorkingTimeTarget("2026-12", input);
    expect(() =>
      calculateMonthlyWorkingTimeTarget("2026-12", { ...input, weeklyMinutes: NaN }),
    ).toThrow();
    for (const status of ["loading", "error"] as const) {
      expect(() =>
        calculateMonthlyWorkingTimeTarget("2026-12", {
          ...input,
          workingTimeTarget: { ...input.workingTimeTarget!, status },
        }),
      ).toThrow();
    }
  });
});
