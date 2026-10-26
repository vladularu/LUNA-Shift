import { describe, expect, it } from "vitest";

import type { TargetProfilePeriod, WorkingTimeTargetContext } from "@/domain/working-time-target";
import { calculateMonthlyWorkingTimeTarget } from "@/engine/working-time-target";
import { calculateMonthlySummary, calculateMonthlyTargetMinutes } from "@/engine/monthly-summary";

// Independently calculated controls: docs/working-time-target-2027.md.
const profile = { federalState: "HE", weeklyMinutes: 2310, timeZone: "Europe/Berlin" } as const;
const period: TargetProfilePeriod = {
  validFrom: "2026-01-01",
  validTo: null,
  weeklyMinutes: 2310,
  federalState: "HE",
  holidayRegion: "NONE",
  model: {
    kind: "ROTATING_FIVE_IN_SEVEN",
    monthlyReference: "WEEKDAYS_ONE_FIFTH",
    sevenDayShiftPlanConfirmed: true,
  },
  tariff: { kind: "TVOED_K", version: "2026-01-01", scopeConfirmed: true },
};
function forecast(month: string, p = period, days: WorkingTimeTargetContext["days"] = []) {
  const calculationProfile = {
    ...profile,
    workingTimeTarget: {
      status: "ready" as const,
      mode: "FORECAST" as const,
      notices: [],
      context: { periods: [p], days },
    },
  };
  return {
    result: calculateMonthlyWorkingTimeTarget(month, calculationProfile),
    calculationProfile,
  };
}

describe("TVöD-K reviewed 2027 coverage", () => {
  it.each([
    ["2026-12", 10626, 924, 924, 8778],
    ["2027-01", 9702, 462, 0, 9240],
    ["2027-05", 9702, 1848, 0, 7854],
    ["2027-07", 10164, 0, 0, 10164],
    ["2027-12", 10626, 462, 924, 9240],
  ])("preserves the existing profile in %s", (month, base, statutory, special, target) => {
    const { result } = forecast(month);
    expect(result).toMatchObject({
      baseMinutes: base,
      statutoryReductionMinutes: statutory,
      tariffReductionMinutes: special,
      targetMinutes: target,
      status: "PROVISIONAL",
    });
    expect(result.notices.some((n) => n.code === "TARIFF_VERSION_UNREVIEWED")).toBe(false);
    expect(result.adjustments.every((a) => a.status === "PROFILE_ESTIMATE")).toBe(true);
    expect(new Set(result.adjustments.map((a) => a.date)).size).toBe(result.adjustments.length);
  });

  it.each([
    ["2027-05", 8316],
    ["2027-07", 10164],
    ["2027-12", 9702],
  ])("keeps a fixed weekday distribution distinct in %s", (month, target) => {
    const fixed: TargetProfilePeriod = {
      ...period,
      model: { kind: "FIXED_WEEK", weekdayMinutes: [462, 462, 462, 462, 462, 0, 0] },
    };
    expect(forecast(month, fixed).result.targetMinutes).toBe(target);
  });

  it("uses 2027 references without changing 2026 rule identities", () => {
    const before = forecast("2026-12").result;
    const after = forecast("2027-12").result;
    expect(before.adjustments.every((a) => a.ruleId.startsWith("tvoed-k-2026-"))).toBe(true);
    expect(after.adjustments.map((a) => a.date)).toEqual([
      "2027-12-24",
      "2027-12-25",
      "2027-12-31",
    ]);
    expect(after.adjustments.every((a) => a.ruleId.startsWith("tvoed-k-2027-"))).toBe(true);
    expect(after.adjustments.find((a) => a.kind === "TARIFF_SPECIAL_DAY")?.sourceUrl).toContain(
      "1-1-27.pdf",
    );
  });

  it("accepts an explicitly recorded 2027 version only from its reviewed start", () => {
    const p: TargetProfilePeriod = {
      ...period,
      tariff: { kind: "TVOED_K", version: "2027-01-01", scopeConfirmed: true },
    };
    expect(forecast("2027-12", p).result.targetMinutes).toBe(9240);
    expect(
      forecast("2026-12", p).result.notices.some((n) => n.code === "TARIFF_VERSION_UNREVIEWED"),
    ).toBe(true);
  });

  it.each(["2028-01-01", "unknown"])("does not grant rules for version %s", (version) => {
    const p: TargetProfilePeriod = {
      ...period,
      tariff: { kind: "TVOED_K", version, scopeConfirmed: true },
    };
    const { result } = forecast("2027-12", p);
    expect(result.tariffReductionMinutes).toBe(0);
    expect(result.statutoryReductionMinutes).toBe(0);
    expect(result.notices.some((n) => n.code === "TARIFF_VERSION_UNREVIEWED")).toBe(true);
  });

  it("keeps the next unreviewed year provisional", () => {
    expect(
      forecast("2028-01").result.notices.some((n) => n.code === "TARIFF_VERSION_UNREVIEWED"),
    ).toBe(true);
  });

  it("scales the contractual reference for part-time work", () => {
    expect(forecast("2027-12", { ...period, weeklyMinutes: 1155 }).result.targetMinutes).toBe(4620);
  });

  it("keeps forecast, monthly summary and target API consistent without actual work", () => {
    const { result, calculationProfile } = forecast("2027-12");
    expect(calculateMonthlyTargetMinutes("2027-12", calculationProfile)).toBe(result.targetMinutes);
    expect(calculateMonthlySummary("2027-12", [], calculationProfile)).toMatchObject({
      targetMinutes: 9240,
      actualMinutes: 0,
    });
    const days: WorkingTimeTargetContext["days"] = [24, 31].map((day) => ({
      date: `2027-12-${day}`,
      rosterStatus: "FINAL",
      disposition: "WORK_REQUIRED",
    }));
    expect(forecast("2027-12", period, days).result).toEqual(result);
  });

  it("supports explicitly qualified 2027 claims separately from forecasts", () => {
    const days: WorkingTimeTargetContext["days"] = [24, 25, 31].map((day) => ({
      date: `2027-12-${day}`,
      rosterStatus: "FINAL",
      disposition: "ROSTER_FREE",
      lostMinutes: 462,
      mustWorkElsewhere: true,
    }));
    expect(
      calculateMonthlyWorkingTimeTarget("2027-12", profile, undefined, { periods: [period], days }),
    ).toMatchObject({ targetMinutes: 9240, status: "FINAL" });
    const worked = days.map((day) => ({ ...day, disposition: "WORK_REQUIRED" as const }));
    const result = calculateMonthlyWorkingTimeTarget("2027-12", profile, undefined, {
      periods: [period],
      days: worked,
    });
    expect(result).toMatchObject({ targetMinutes: 10164, tariffReductionMinutes: 0 });
    expect(result.notices.filter((n) => n.code === "COMPENSATORY_LEAVE_SEPARATE")).toHaveLength(2);
  });

  it("does not transfer BT-K rules to other tariffs", () => {
    const p: TargetProfilePeriod = { ...period, tariff: { kind: "UNVERIFIED", id: "TV-L" } };
    const { result } = forecast("2027-12", p);
    expect(result.tariffReductionMinutes).toBe(0);
    expect(result.notices.some((n) => n.code === "TARIFF_UNSUPPORTED")).toBe(true);
  });
});
